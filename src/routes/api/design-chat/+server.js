import { json } from '@sveltejs/kit';
import { getClient } from '$lib/server/gemini.js';
import { approxJsonBytes, enforceRateLimit } from '$lib/server/security.js';
import {
	beginIdempotentRequest,
	completeIdempotentRequest,
	failIdempotentRequest,
	makeRequestHash,
	recordUsageEvent
} from '$lib/server/requestTracking.js';

function extractText(response) {
	if (typeof response?.text === 'string' && response.text.trim()) return response.text;
	const parts = response?.candidates?.[0]?.content?.parts ?? [];
	for (const part of parts) {
		if (part?.text) return part.text;
	}
	return '';
}

function parseJsonPayload(text) {
	if (!text) return null;
	try {
		return JSON.parse(text);
	} catch {
		const match = text.match(/\{[\s\S]*\}/);
		if (!match) return null;
		try {
			return JSON.parse(match[0]);
		} catch {
			return null;
		}
	}
}

function fallbackPrompt(userMessage, finalPrompt, contentPreset, stylePreset) {
	const base = (finalPrompt || userMessage || '').trim();
	const style = stylePreset === 'diablo2'
		? 'dark gothic fantasy Diablo II atmosphere, moody lighting, gritty textures'
		: '';
	const type = contentPreset ? `${contentPreset} concept, game-ready` : '';
	return [base, type, style].filter(Boolean).join(', ');
}

function parseReferenceImageData(dataUrl) {
	if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) return null;
	const comma = dataUrl.indexOf(',');
	if (comma === -1) return null;
	const header = dataUrl.slice(0, comma);
	const base64Data = dataUrl.slice(comma + 1);
	if (!base64Data) return null;
	const match = header.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64$/);
	if (!match) return null;
	return {
		mimeType: match[1],
		data: base64Data
	};
}

export async function POST({ request, locals }) {
	let payloadBytes = 0;
	let idempotencyKey = null;
	let requestHash = null;
	try {
		if (!locals.user) {
			return json({ error: 'Authentication required' }, { status: 401 });
		}

		const {
			mode = 'chat',
			messages = [],
			userMessage = '',
			referenceImage = null,
			finalPrompt = '',
			contentPreset = 'character',
			stylePreset = 'default'
		} = await request.json();
		const safeMode = mode === 'draft_prompt' ? 'draft_prompt' : 'chat';
		const safeMessages = Array.isArray(messages) ? messages.slice(-50) : [];
		const safeUserMessage = String(userMessage || '').slice(0, 4000);
		const safeFinalPrompt = String(finalPrompt || '').slice(0, 8000);
		const payload = {
			mode: safeMode,
			messages: safeMessages,
			userMessage: safeUserMessage,
			referenceImage,
			finalPrompt: safeFinalPrompt,
			contentPreset,
			stylePreset
		};
		payloadBytes = approxJsonBytes(payload);
		idempotencyKey = request.headers.get('Idempotency-Key')?.trim() || null;
		requestHash = makeRequestHash(payload);
		if (payloadBytes > 2 * 1024 * 1024) {
			return json({ error: 'Request payload too large' }, { status: 413 });
		}
		const rate = enforceRateLimit({
			uid: locals.user.uid,
			routeKey: 'design-chat',
			maxRequests: 30,
			windowMs: 60_000
		});
		if (!rate.allowed) {
			return json(
				{ error: 'Rate limit exceeded. Please try again shortly.' },
				{ status: 429, headers: { 'Retry-After': String(rate.retryAfterSec) } }
			);
		}
		if (idempotencyKey) {
			const idempotency = await beginIdempotentRequest({
				uid: locals.user.uid,
				routeKey: 'design-chat',
				idempotencyKey,
				requestHash
			});
			if (idempotency.status === 'replay') {
				return json(idempotency.responseBody, { status: idempotency.responseStatus });
			}
			if (idempotency.status === 'processing') {
				return json(
					{ error: 'A request with this Idempotency-Key is already processing.' },
					{ status: 409 }
				);
			}
			if (idempotency.status === 'conflict') {
				return json(
					{ error: 'Idempotency-Key already used with different payload.' },
					{ status: 409 }
				);
			}
		}
		if (!['chat', 'draft_prompt'].includes(safeMode)) {
			return json({ error: 'Invalid mode' }, { status: 400 });
		}

		const transcriptMessages = safeUserMessage?.trim()
			? [...safeMessages, { role: 'user', content: safeUserMessage }]
			: safeMessages;
		const transcript = transcriptMessages
			.slice(-12)
			.map((m) => `${m.role === 'assistant' ? 'Assistant' : 'User'}: ${m.content}`)
			.join('\n');
		const parsedReferenceImage = parseReferenceImageData(referenceImage);
		const hasReferenceImage = !!parsedReferenceImage;

		const isPromptDraftMode = safeMode === 'draft_prompt';
		const instruction = isPromptDraftMode
			? `You are a concise game art prompt assistant.
Return ONLY valid JSON with exact shape:
{
  "assistantMessage": "string",
  "finalPrompt": "string"
}
Rules:
- Keep assistantMessage short, useful, and friendly.
- finalPrompt must be production-ready for image generation.
- Include selected category and style context when relevant.
- Do not wrap JSON in markdown.`
			: `You are a concise game art ideation assistant.
Return ONLY valid JSON with exact shape:
{
  "assistantMessage": "string"
}
Rules:
- Focus on concept refinement and clarifying details.
- Keep assistantMessage short, useful, and friendly.
- Ask at most one targeted follow-up question when needed.
- Do not write or revise a final production prompt in chat mode.
- If a reference image is provided, use it as a visual target and ground your advice in visible traits.
- Do not wrap JSON in markdown.`;

		const input = `Conversation:\n${transcript}\n\nCurrent prompt draft:\n${safeFinalPrompt}\n\nSelected category preset: ${contentPreset}\nSelected style preset: ${stylePreset}\nReference image attached: ${hasReferenceImage ? 'yes' : 'no'}`;
		const parts = [{ text: instruction }, { text: input }];
		if (parsedReferenceImage) {
			parts.push({ inlineData: parsedReferenceImage });
		}

		const ai = getClient();
		const response = await ai.models.generateContent({
			model: 'gemini-2.5-flash',
			contents: [{ role: 'user', parts }],
			config: {
				temperature: 0.45,
				candidateCount: 1,
				responseModalities: ['TEXT']
			}
		});

		const text = extractText(response);
		const parsed = parseJsonPayload(text);

		if (!parsed && isPromptDraftMode) {
			const responseBody = {
				assistantMessage: 'I refined your draft. You can tweak details and generate when ready.',
				finalPrompt: fallbackPrompt(safeUserMessage, safeFinalPrompt, contentPreset, stylePreset)
			};
			if (idempotencyKey) {
				await completeIdempotentRequest({
					uid: locals.user.uid,
					routeKey: 'design-chat',
					idempotencyKey,
					requestHash,
					responseStatus: 200,
					responseBody
				});
			}
			await recordUsageEvent({
				uid: locals.user.uid,
				routeKey: 'design-chat',
				provider: 'gemini',
				statusCode: 200,
				requestBytes: payloadBytes,
				metadata: { mode: safeMode, fallback: true }
			});
			return json(responseBody);
		}

		if (!parsed && !isPromptDraftMode) {
			const responseBody = {
				assistantMessage:
					'Strong direction so far. Share one key detail on mood, camera angle, or costume accents and I can refine it further.'
			};
			if (idempotencyKey) {
				await completeIdempotentRequest({
					uid: locals.user.uid,
					routeKey: 'design-chat',
					idempotencyKey,
					requestHash,
					responseStatus: 200,
					responseBody
				});
			}
			await recordUsageEvent({
				uid: locals.user.uid,
				routeKey: 'design-chat',
				provider: 'gemini',
				statusCode: 200,
				requestBytes: payloadBytes,
				metadata: { mode: safeMode, fallback: true }
			});
			return json(responseBody);
		}

		if (!isPromptDraftMode) {
			const responseBody = {
				assistantMessage: parsed.assistantMessage || 'Good direction. Share one more detail and I can sharpen the concept.'
			};
			if (idempotencyKey) {
				await completeIdempotentRequest({
					uid: locals.user.uid,
					routeKey: 'design-chat',
					idempotencyKey,
					requestHash,
					responseStatus: 200,
					responseBody
				});
			}
			await recordUsageEvent({
				uid: locals.user.uid,
				routeKey: 'design-chat',
				provider: 'gemini',
				statusCode: 200,
				requestBytes: payloadBytes,
				metadata: { mode: safeMode }
			});
			return json(responseBody);
		}

		const responseBody = {
			assistantMessage: parsed.assistantMessage || 'Prompt refined.',
			finalPrompt:
				typeof parsed.finalPrompt === 'string' && parsed.finalPrompt.trim()
					? parsed.finalPrompt.trim()
					: fallbackPrompt(safeUserMessage, safeFinalPrompt, contentPreset, stylePreset)
		};
		if (idempotencyKey) {
			await completeIdempotentRequest({
				uid: locals.user.uid,
				routeKey: 'design-chat',
				idempotencyKey,
				requestHash,
				responseStatus: 200,
				responseBody
			});
		}
		await recordUsageEvent({
			uid: locals.user.uid,
			routeKey: 'design-chat',
			provider: 'gemini',
			statusCode: 200,
			requestBytes: payloadBytes,
			metadata: { mode: safeMode }
		});
		return json(responseBody);
	} catch (error) {
		console.error('[Design Chat] Error:', error);
		if (idempotencyKey && requestHash && locals.user?.uid) {
			try {
				await failIdempotentRequest({
					uid: locals.user.uid,
					routeKey: 'design-chat',
					idempotencyKey,
					requestHash,
					errorMessage: error.message
				});
			} catch {
				// best effort
			}
		}
		if (locals.user?.uid) {
			await recordUsageEvent({
				uid: locals.user.uid,
				routeKey: 'design-chat',
				provider: 'gemini',
				success: false,
				statusCode: 500,
				requestBytes: payloadBytes,
				metadata: { error: String(error.message || 'unknown').slice(0, 200) }
			});
		}
		return json({ error: error.message || 'Design chat failed' }, { status: 500 });
	}
}
