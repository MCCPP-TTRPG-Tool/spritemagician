import { json } from '@sveltejs/kit';
import { env } from '$lib/server/env.js';
import { getMasterStyle } from '$lib/server/styleAnchor.js';
import { CHROMA_KEY_PROMPT_RULES } from '$lib/constants/chromaKey.js';
import { approxJsonBytes, enforceRateLimit } from '$lib/server/security.js';
import {
	beginIdempotentRequest,
	completeIdempotentRequest,
	failIdempotentRequest,
	makeRequestHash,
	recordUsageEvent
} from '$lib/server/requestTracking.js';

const OPENAI_GPT_IMAGE_SIZE = '1024x1024';
const OPENAI_PROMPT_REFINER_MODEL = 'gpt-4.1-mini';

export async function POST({ request, locals }) {
	let payloadBytes = 0;
	let idempotencyKey = null;
	let requestHash = null;
	try {
		if (!locals.user) {
			return json({ error: 'Authentication required' }, { status: 401 });
		}

		const {
			prompt,
			referenceImage,
			useMasterStyleAnchor = false,
			generationNonce = null,
			generationModel = 'nano_banana'
		} = await request.json();
		const selectedModel =
			generationModel === 'gpt4' || generationModel === 'dalle' ? generationModel : 'nano_banana';
		const payload = {
			prompt,
			referenceImage,
			useMasterStyleAnchor,
			generationNonce,
			generationModel: selectedModel
		};
		payloadBytes = approxJsonBytes(payload);
		idempotencyKey = request.headers.get('Idempotency-Key')?.trim() || null;
		requestHash = makeRequestHash(payload);
		if (payloadBytes > 5 * 1024 * 1024) {
			return json({ error: 'Request payload too large' }, { status: 413 });
		}
		const rate = enforceRateLimit({
			uid: locals.user.uid,
			routeKey: 'generate-sprite',
			maxRequests: 15,
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
				routeKey: 'generate-sprite',
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

		if (!prompt && !referenceImage) {
			return json({ error: 'Prompt or reference image is required' }, { status: 400 });
		}

		// Keep OpenAI prompt clean; nonce-based variation is only used on Nano Banana path.
		const finalPrompt =
			selectedModel === 'nano_banana' && generationNonce
				? `${prompt}\n\nVariation nonce: ${generationNonce}`
				: prompt;

		const generatedImage = await generateImageByModel({
			selectedModel,
			finalPrompt,
			referenceImage,
			useMasterStyleAnchor
		});
		if (!generatedImage) {
			await recordUsageEvent({
				uid: locals.user.uid,
				routeKey: 'generate-sprite',
				provider: selectedModel === 'nano_banana' ? 'gemini' : 'openai',
				success: false,
				statusCode: 500,
				requestBytes: payloadBytes,
				metadata: { error: 'No image generated in response' }
			});
			return json({ error: 'No image generated' }, { status: 500 });
		}

		console.log('[Sprite Generator] Successfully generated sprite:', selectedModel);
		await recordUsageEvent({
			uid: locals.user.uid,
			routeKey: 'generate-sprite',
			provider: selectedModel === 'nano_banana' ? 'gemini' : 'openai',
			statusCode: 200,
			requestBytes: payloadBytes,
			metadata: {
				usedStyleAnchor: !!useMasterStyleAnchor,
				model: selectedModel
			}
		});
		const responseBody = { image: generatedImage };
		if (idempotencyKey) {
			await completeIdempotentRequest({
				uid: locals.user.uid,
				routeKey: 'generate-sprite',
				idempotencyKey,
				requestHash,
				responseStatus: 200,
				responseBody
			});
		}
		return json(responseBody, { headers: noCacheHeaders() });

	} catch (error) {
		console.error('[Sprite Generator] Error:', error);
		const message = String(error.message || error || 'Unknown error');
		if (idempotencyKey && requestHash && locals.user?.uid) {
			try {
				await failIdempotentRequest({
					uid: locals.user.uid,
					routeKey: 'generate-sprite',
					idempotencyKey,
					requestHash,
					errorMessage: message
				});
			} catch {
				// best effort
			}
		}
		if (locals.user?.uid) {
			await recordUsageEvent({
				uid: locals.user.uid,
				routeKey: 'generate-sprite',
				provider: message.toLowerCase().includes('openai') ? 'openai' : 'gemini',
				success: false,
				statusCode: 500,
				requestBytes: payloadBytes,
				metadata: { error: message.slice(0, 200) }
			});
		}
		return json({ error: message }, { status: 500 });
	}
}

function noCacheHeaders() {
	return {
		'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
		Pragma: 'no-cache',
		Expires: '0',
		'Surrogate-Control': 'no-store'
	};
}

function extractGeneratedImage(result) {
	let generatedImage = null;
	
	if (result.candidates && result.candidates[0] && result.candidates[0].content) {
		const parts = result.candidates[0].content.parts;
		for (const part of parts) {
			if (part.inlineData && part.inlineData.data) {
				generatedImage = `data:image/png;base64,${part.inlineData.data}`;
				break;
			} else if (part.inline_data && part.inline_data.data) {
				generatedImage = `data:image/png;base64,${part.inline_data.data}`;
				break;
			}
		}
	}
	return generatedImage;
}

async function generateImageByModel({ selectedModel, finalPrompt, referenceImage, useMasterStyleAnchor }) {
	if (selectedModel === 'nano_banana') {
		if (!env.GEMINI_API_KEY) {
			throw new Error('Gemini API key not configured. Set GEMINI_API_KEY in .env');
		}
		return generateWithGeminiNanoBanana({ finalPrompt, referenceImage, useMasterStyleAnchor });
	}
	if (!env.OPENAI_API_KEY) {
		throw new Error('OpenAI API key not configured. Set OPENAI_API_KEY in .env');
	}
	if (selectedModel === 'gpt4') {
		const refinedPrompt = await refineOpenAIPrompt(finalPrompt);
		const firstPassImage = await generateWithOpenAI({
			model: 'gpt-image-1.5',
			prompt: refinedPrompt,
			quality: 'high',
			referenceImage
		});
		if (!firstPassImage) return firstPassImage;
		const polishPrompt = buildOpenAIPolishPrompt(refinedPrompt);
		try {
			const polishedImage = await generateWithOpenAI({
				model: 'gpt-image-1.5',
				prompt: polishPrompt,
				quality: 'high',
				referenceImage: firstPassImage
			});
			return polishedImage || firstPassImage;
		} catch (error) {
			console.warn('[Sprite Generator] OpenAI polish pass failed, returning first pass image:', error);
			return firstPassImage;
		}
	}
	if (selectedModel === 'dalle') {
		if (referenceImage) {
			throw new Error('Reference image is currently supported only with GPT-4 Image and Nano Banana.');
		}
		return generateWithOpenAI({ model: 'dall-e-3', prompt: finalPrompt });
	}
	return generateWithGeminiNanoBanana({ finalPrompt, referenceImage, useMasterStyleAnchor });
}

async function refineOpenAIPrompt(inputPrompt) {
	const sourcePrompt = String(inputPrompt || '').trim();
	if (!sourcePrompt) return sourcePrompt;
	try {
		const response = await fetch('https://api.openai.com/v1/chat/completions', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${env.OPENAI_API_KEY}`,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				model: OPENAI_PROMPT_REFINER_MODEL,
				temperature: 0.2,
				messages: [
					{
						role: 'system',
						content:
							'Rewrite image prompts for maximum visual fidelity. Preserve subject intent exactly. Output a single final prompt only, no markdown, no explanations.'
					},
					{
						role: 'user',
						content:
							`Refine this image-generation prompt to improve detail density, material realism, atmospheric depth, and composition clarity while keeping subject, style, and intent unchanged:\n\n${sourcePrompt}`
					}
				]
			})
		});
		if (!response.ok) {
			const errorText = await response.text();
			console.warn('[Sprite Generator] OpenAI prompt refinement failed:', response.status, errorText);
			return sourcePrompt;
		}
		const result = await response.json();
		const refined = result?.choices?.[0]?.message?.content;
		const cleaned = typeof refined === 'string' ? refined.trim() : '';
		return cleaned || sourcePrompt;
	} catch (error) {
		console.warn('[Sprite Generator] OpenAI prompt refinement error:', error);
		return sourcePrompt;
	}
}

function buildOpenAIPolishPrompt(basePrompt) {
	return (
		`${basePrompt}\n\n` +
		'Second pass clean polish (mandatory): preserve composition, pose, silhouette, and color story exactly. Keep forms clean with smooth surface transitions, polished materials, controlled detail density, and low-noise rendering. Use restrained weathering only at contact edges. Improve focal clarity without adding heavy grit. Do not simplify forms, do not change framing, and do not introduce new subjects. AVOID: excessive grit, crusty texture noise, heavy rust pitting, dirty patina, rough painterly speckle.'
	);
}

async function generateWithGeminiNanoBanana({ finalPrompt, referenceImage, useMasterStyleAnchor }) {
	let masterStyle = null;
	if (useMasterStyleAnchor) {
		masterStyle = await getMasterStyle();
		if (!masterStyle?.base64) {
			throw new Error('Style lock requested, but no master style anchor found. Upload one via /api/style-anchor.');
		}
	}

	const parts = [];
	if (useMasterStyleAnchor && masterStyle) {
		parts.push({
			text:
				'MASTER STYLE ANCHOR (MANDATORY): Match this exact rendering style, color language, texture treatment, and overall aesthetic.'
		});
		parts.push({
			inline_data: {
				mime_type: masterStyle.mimeType || 'image/png',
				data: masterStyle.base64
			}
		});
	}

	if (referenceImage) {
		parts.push({
			text:
				'REFERENCE IMAGE (MANDATORY): Match this image as the primary visual target. Preserve composition intent, subject silhouette, material treatment, and painting texture. Do not drift into generic AI rendering.'
		});
		let mimeType = 'image/png';
		let base64Data;
		if (referenceImage.startsWith('http://') || referenceImage.startsWith('https://')) {
			const imgRes = await fetch(referenceImage);
			if (!imgRes.ok) throw new Error(`Failed to fetch reference image: ${imgRes.status}`);
			const buf = Buffer.from(await imgRes.arrayBuffer());
			mimeType = imgRes.headers.get('content-type') || 'image/png';
			base64Data = buf.toString('base64');
		} else if (referenceImage.startsWith('data:')) {
			const base64Index = referenceImage.indexOf(',');
			if (base64Index !== -1) {
				const header = referenceImage.substring(0, base64Index);
				const mimeMatch = header.match(/data:(.*?);/);
				if (mimeMatch) mimeType = mimeMatch[1];
				base64Data = referenceImage.substring(base64Index + 1);
			}
		} else {
			base64Data = referenceImage;
		}
		parts.push({
			inline_data: {
				mime_type: mimeType,
				data: base64Data
			}
		});
	}

	parts.push({
		text:
			`${finalPrompt}\n\n` +
			(useMasterStyleAnchor
				? `STYLE LOCK REQUIREMENTS (MANDATORY):\n` +
				  `- Keep output in the same visual style as MASTER STYLE ANCHOR.\n` +
				  `- Preserve style consistency over subject changes.\n` +
				  `- Do not drift to photoreal or unrelated art styles.\n\n`
				: '') +
			`${CHROMA_KEY_PROMPT_RULES}`
	});

	const response = await fetch(
		`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${env.GEMINI_API_KEY}`,
		{
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				contents: [{ parts }],
				generationConfig: {
					responseModalities: ['TEXT', 'IMAGE'],
					imageConfig: { aspectRatio: '1:1' }
				}
			})
		}
	);
	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(`Gemini API error: ${response.status} ${errorText}`);
	}
	const result = await response.json();
	return extractGeneratedImage(result);
}

function dataUrlToImageParts(dataUrl) {
	const commaIndex = dataUrl.indexOf(',');
	if (commaIndex === -1) return null;
	const header = dataUrl.slice(0, commaIndex);
	const base64Data = dataUrl.slice(commaIndex + 1);
	const mimeMatch = header.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64$/);
	if (!mimeMatch || !base64Data) return null;
	return {
		mimeType: mimeMatch[1],
		buffer: Buffer.from(base64Data, 'base64')
	};
}

function mimeToExtension(mimeType) {
	if (mimeType === 'image/jpeg') return 'jpg';
	if (mimeType === 'image/webp') return 'webp';
	if (mimeType === 'image/gif') return 'gif';
	return 'png';
}

async function normalizeReferenceImage(referenceImage) {
	if (!referenceImage || typeof referenceImage !== 'string') return null;
	if (referenceImage.startsWith('data:image/')) {
		const parsed = dataUrlToImageParts(referenceImage);
		if (!parsed) return null;
		return parsed;
	}
	if (referenceImage.startsWith('http://') || referenceImage.startsWith('https://')) {
		const imageResponse = await fetch(referenceImage);
		if (!imageResponse.ok) {
			throw new Error(`Failed to fetch reference image: ${imageResponse.status}`);
		}
		const mimeType = imageResponse.headers.get('content-type') || 'image/png';
		const buffer = Buffer.from(await imageResponse.arrayBuffer());
		return { mimeType, buffer };
	}
	return {
		mimeType: 'image/png',
		buffer: Buffer.from(referenceImage, 'base64')
	};
}

async function generateWithOpenAI({ model, prompt, quality, referenceImage }) {
	const hasReference = !!referenceImage;
	let response;
	if (hasReference) {
		const parsedReference = await normalizeReferenceImage(referenceImage);
		if (!parsedReference?.buffer?.length) {
			throw new Error('Failed to parse reference image for OpenAI request.');
		}
		const formData = new FormData();
		formData.set('model', model);
		formData.set('prompt', prompt);
		formData.set('size', OPENAI_GPT_IMAGE_SIZE);
		if (quality) formData.set('quality', quality);
		const ext = mimeToExtension(parsedReference.mimeType);
		const filename = `reference.${ext}`;
		formData.set('image', new Blob([parsedReference.buffer], { type: parsedReference.mimeType }), filename);
		response = await fetch('https://api.openai.com/v1/images/edits', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${env.OPENAI_API_KEY}`
			},
			body: formData
		});
	} else {
		response = await fetch('https://api.openai.com/v1/images/generations', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${env.OPENAI_API_KEY}`,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				model,
				prompt,
				size: OPENAI_GPT_IMAGE_SIZE,
				...(quality ? { quality } : {})
			})
		});
	}
	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(`OpenAI image API error: ${response.status} ${errorText}`);
	}
	const result = await response.json();
	const b64 = result?.data?.[0]?.b64_json;
	if (typeof b64 === 'string' && b64.length > 0) {
		return `data:image/png;base64,${b64}`;
	}
	const url = result?.data?.[0]?.url;
	if (typeof url === 'string' && url.startsWith('http')) {
		const imgRes = await fetch(url);
		if (!imgRes.ok) {
			throw new Error(`OpenAI returned URL but fetch failed: ${imgRes.status}`);
		}
		const contentType = imgRes.headers.get('content-type') || 'image/png';
		const buf = Buffer.from(await imgRes.arrayBuffer());
		return `data:${contentType};base64,${buf.toString('base64')}`;
	}
	return null;
}
