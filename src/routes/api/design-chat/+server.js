import { json } from '@sveltejs/kit';
import { getClient } from '$lib/server/gemini.js';

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

		const transcriptMessages = userMessage?.trim()
			? [...messages, { role: 'user', content: userMessage }]
			: messages;
		const transcript = transcriptMessages
			.slice(-12)
			.map((m) => `${m.role === 'assistant' ? 'Assistant' : 'User'}: ${m.content}`)
			.join('\n');
		const parsedReferenceImage = parseReferenceImageData(referenceImage);
		const hasReferenceImage = !!parsedReferenceImage;

		const isPromptDraftMode = mode === 'draft_prompt';
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

		const input = `Conversation:\n${transcript}\n\nCurrent prompt draft:\n${finalPrompt}\n\nSelected category preset: ${contentPreset}\nSelected style preset: ${stylePreset}\nReference image attached: ${hasReferenceImage ? 'yes' : 'no'}`;
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
			return json({
				assistantMessage: 'I refined your draft. You can tweak details and generate when ready.',
				finalPrompt: fallbackPrompt(userMessage, finalPrompt, contentPreset, stylePreset)
			});
		}

		if (!parsed && !isPromptDraftMode) {
			return json({
				assistantMessage:
					'Strong direction so far. Share one key detail on mood, camera angle, or costume accents and I can refine it further.'
			});
		}

		if (!isPromptDraftMode) {
			return json({
				assistantMessage: parsed.assistantMessage || 'Good direction. Share one more detail and I can sharpen the concept.'
			});
		}

		return json({
			assistantMessage: parsed.assistantMessage || 'Prompt refined.',
			finalPrompt:
				typeof parsed.finalPrompt === 'string' && parsed.finalPrompt.trim()
					? parsed.finalPrompt.trim()
					: fallbackPrompt(userMessage, finalPrompt, contentPreset, stylePreset)
		});
	} catch (error) {
		console.error('[Design Chat] Error:', error);
		return json({ error: error.message || 'Design chat failed' }, { status: 500 });
	}
}
