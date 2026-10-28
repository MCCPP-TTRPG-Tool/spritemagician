import { json } from '@sveltejs/kit';
import { approxJsonBytes, enforceRateLimit } from '$lib/server/security.js';
import { env } from '$lib/server/env.js';
import { extractFirstImageDataUrl, extractFirstImageUrl } from '$lib/server/runpod.js';
import { isHttpUrl } from '$lib/server/validation.js';
import { getClient } from '$lib/server/gemini.js';
import {
	beginIdempotentRequest,
	completeIdempotentRequest,
	failIdempotentRequest,
	makeRequestHash,
	recordUsageEvent
} from '$lib/server/requestTracking.js';

const activeNanoEditUsers = globalThis.__spritemagicianActiveNanoEditUsers || new Set();
globalThis.__spritemagicianActiveNanoEditUsers = activeNanoEditUsers;

function getRunpodImageEditConfig(model = 'qwen') {
	const apiKey = env.RUNPOD_API_KEY || process.env.RUNPOD_API_KEY || '';
	const DEFAULT_KONTEXT_ENDPOINT_ID = '07t9vff9f2ek8u';
	const endpointIdByModel = {
		qwen:
			env.RUNPOD_QWEN_IMAGE_ENDPOINT_ID ||
			process.env.RUNPOD_QWEN_IMAGE_ENDPOINT_ID ||
			env.RUNPOD_IMAGE_EDIT_ENDPOINT_ID ||
			process.env.RUNPOD_IMAGE_EDIT_ENDPOINT_ID ||
			'',
		kontext:
			env.RUNPOD_KONTEXT_IMAGE_ENDPOINT_ID ||
			process.env.RUNPOD_KONTEXT_IMAGE_ENDPOINT_ID ||
			DEFAULT_KONTEXT_ENDPOINT_ID
	};
	const normalizedModel = normalizeEditModel(model);
	const endpointId = endpointIdByModel[normalizedModel] || endpointIdByModel.qwen;
	return { apiKey: String(apiKey).trim(), endpointId: String(endpointId).trim(), model: normalizedModel };
}

function normalizeEditModel(model) {
	const value = String(model || 'nano_banana').trim().toLowerCase();
	if (value === 'nano_banana' || value === 'nano-banana' || value === 'nano banana') return 'nano_banana';
	return 'nano_banana';
}

function stripDataUrl(dataUrl) {
	const value = String(dataUrl || '');
	const commaIdx = value.indexOf(',');
	return commaIdx >= 0 ? value.slice(commaIdx + 1) : value;
}

function buildRunpodInput({
	image,
	prompt,
	mode,
	base64Data,
	mimeType,
	model = 'qwen',
	width = 1024,
	height = 1024,
	preferDetailFidelity = false
}) {
	const seed = Math.floor(Math.random() * 2_147_483_647);
	const normalizedModel = normalizeEditModel(model);
	const isKontext = normalizedModel === 'kontext';
	const normalizedBase64 = stripDataUrl(String(base64Data || '')).replace(/\s+/g, '');
	let safeWidth = Number.isFinite(width) ? Math.max(64, Math.min(2048, Math.round(width))) : 1024;
	let safeHeight = Number.isFinite(height) ? Math.max(64, Math.min(2048, Math.round(height))) : 1024;
	if (isKontext && safeWidth > 0 && safeHeight > 0 && (safeWidth < 256 || safeHeight < 256)) {
		// Guard against accidental thumbnail inputs (e.g. 64x64) producing unusably tiny outputs.
		const minEdge = 768;
		const scale = Math.max(minEdge / safeWidth, minEdge / safeHeight, 1);
		safeWidth = Math.min(2048, Math.max(256, Math.round((safeWidth * scale) / 64) * 64));
		safeHeight = Math.min(2048, Math.max(256, Math.round((safeHeight * scale) / 64) * 64));
	}
	const defaultStrength = isKontext
		? (preferDetailFidelity ? 0.15 : 0.22)
		: (preferDetailFidelity ? 0.35 : 0.45);
	const input = {
		prompt,
		instruction: prompt,
		mode: mode || 'edit',
		seed,
		// Common image-edit tuning defaults; some RunPod handlers require these keys.
		guidance: 3.5,
		guidance_scale: 3.5,
		steps: 30,
		num_inference_steps: 30,
		strength: defaultStrength,
		width: safeWidth,
		height: safeHeight
	};

	if (isHttpUrl(image)) {
		input.image = image;
		input.image_url = image;
		input.image_path = image;
		input.images = [{ name: 'source.png', image }];
		return input;
	}

	const dataUrl = image.startsWith('data:') ? image : `data:${mimeType};base64,${base64Data}`;
	if (isKontext) {
		// Kontext worker logs indicate `image_path` may be treated as raw base64 input.
		input.image = normalizedBase64;
		input.image_path = normalizedBase64;
		input.source_image = normalizedBase64;
		input.input_image = normalizedBase64;
		input.image_base64 = normalizedBase64;
		input.image_data_url = dataUrl;
		input.images = [{ name: 'source.jpg', image: normalizedBase64 }];
		return input;
	}
	input.image = dataUrl;
	input.image_path = dataUrl;
	input.source_image = dataUrl;
	input.image_base64 = normalizedBase64;
	input.images = [{ name: 'source.png', image: dataUrl }];
	return input;
}

function buildRunpodPrompt(prompt, mode) {
	const base = String(prompt || '').trim();
	if (!base) return base;
	const isEdit = (mode || 'edit') === 'edit';
	const looksLikeIsolationTask = /isolat|background|chroma|cutout|transparent/i.test(base);
	if (!isEdit || !looksLikeIsolationTask) return base;
	return [
		'STRICT EDIT RULES:',
		'- Preserve the original subject identity, silhouette, and micro-details exactly.',
		'- Do not repaint, simplify, smooth, blur, stylize, or redesign the subject.',
		'- Only adjust background separation and leave foreground detail unchanged.',
		'',
		`TASK: ${base}`
	].join('\n');
}

function parseJsonPayload(text) {
	if (!text) return null;
	try {
		return JSON.parse(text);
	} catch {
		const match = String(text).match(/\{[\s\S]*\}/);
		if (!match) return null;
		try {
			return JSON.parse(match[0]);
		} catch {
			return null;
		}
	}
}

function sanitizePromptSpec(rawSpec) {
	const spec = rawSpec && typeof rawSpec === 'object' ? rawSpec : {};
	return {
		mode: String(spec.mode || 'edit').slice(0, 32),
		contextId: String(spec.contextId || 'character').slice(0, 64),
		editStrategy: String(spec.editStrategy || 'consistency').slice(0, 64),
		quickDirectionLabel: String(spec.quickDirectionLabel || '').slice(0, 160),
		quickDirectionPrompt: String(spec.quickDirectionPrompt || '').slice(0, 400),
		directionId: String(spec.directionId || '').slice(0, 64),
		directionLabel: String(spec.directionLabel || '').slice(0, 120),
		directionDescription: String(spec.directionDescription || '').slice(0, 1200),
		userPrompt: String(spec.userPrompt || '').slice(0, 2000),
		compiledPrompt: String(spec.compiledPrompt || '').slice(0, 8000),
		enforceUncropped: !!spec.enforceUncropped,
		enforceFlatBackground: !!spec.enforceFlatBackground,
		removeBackground: !!spec.removeBackground,
		chromaHex: String(spec.chromaHex || '#00FF00').slice(0, 32),
		negativePrompt: String(spec.negativePrompt || '').slice(0, 1200)
	};
}

function computeAspectRatio(width, height) {
	const w = Number(width);
	const h = Number(height);
	if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return '1:1';
	const ratio = w / h;
	const allowed = [
		['16:9', 16 / 9],
		['9:16', 9 / 16],
		['1:1', 1],
		['4:3', 4 / 3],
		['3:4', 3 / 4],
		['21:9', 21 / 9],
		['3:2', 3 / 2],
		['2:3', 2 / 3],
		['5:4', 5 / 4],
		['4:5', 4 / 5]
	];
	let best = allowed[2];
	let bestDiff = Math.abs(ratio - best[1]);
	for (const entry of allowed) {
		const diff = Math.abs(ratio - entry[1]);
		if (diff < bestDiff) {
			best = entry;
			bestDiff = diff;
		}
	}
	return best[0];
}

function buildDeterministicNanoPromptJson({
	prompt,
	promptSpec,
	mode = 'edit',
	imgWidth,
	imgHeight
}) {
	const safeSpec = sanitizePromptSpec(promptSpec);
	const safePrompt = String(prompt || '').trim();
	const safeMode = String(mode || 'edit').trim().toLowerCase();
	const directionRule = safeSpec.directionDescription || '';
	const directionLabel = safeSpec.directionLabel || safeSpec.directionId || '';
	const contextToType = {
		character: 'person',
		building: 'object',
		item: 'object',
		asset: 'object',
		scenery: 'object',
		effects: 'object'
	};
	const subjectType = contextToType[safeSpec.contextId] || 'object';
	const hasQuickDirection = !!safeSpec.quickDirectionPrompt;
	const avoidList = [
		'camera angle change',
		'focal length change',
		'subject scale change',
		'composition drift',
		'style drift',
		'identity drift',
		'anatomy distortion',
		'cropping',
		'blur',
		'watermark',
		'extra limbs'
	];
	if (safeSpec.negativePrompt) {
		for (const term of safeSpec.negativePrompt.split(',').map((v) => v.trim()).filter(Boolean)) {
			avoidList.push(term);
		}
	}

	return {
		$schema: 'http://json-schema.org/draft-07/schema#',
		title: 'Nano Banana Edit Lock JSON',
		user_intent:
			safePrompt ||
			safeSpec.userPrompt ||
			'Apply requested edit while preserving camera angle, scale, style, and identity.',
		meta: {
			aspect_ratio: computeAspectRatio(imgWidth, imgHeight),
			quality: 'standard',
			safety_filter: 'block_some'
		},
		subject: [
			{
				id: 'primary_subject',
				type: subjectType,
				description:
					'Use the attached source image as identity reference. Preserve silhouette, proportions, anatomy, clothing/materials, and micro-details.',
				input_image: {
					path: 'attached_source_image',
					usage_type: 'identity_reference'
				}
			}
		],
		scene: {
			description:
				'Preserve original camera angle, framing, perspective, depth, subject scale, lighting direction, palette behavior, and overall art style exactly.',
			composition: {
				camera_angle: 'locked_to_reference',
				camera_direction: directionRule
					? {
							id: safeSpec.directionId || null,
							label: directionLabel || null,
							description: directionRule
						}
					: null,
				subject_scale: 'locked_to_reference',
				framing: safeSpec.enforceUncropped ? 'full_subject_uncropped' : 'locked_to_reference',
				style_lock: 'strict'
			}
		},
		style_modifiers: {
			medium: 'digital_illustration',
			aesthetic: ['locked_to_reference_style']
		},
		advanced: {
			negative_prompt: avoidList,
			magic_prompt_enhancer: false
		},
		edit_controls: {
			mode: safeMode,
			context: safeSpec.contextId,
			edit_strategy: safeSpec.editStrategy,
			quick_direction_label: safeSpec.quickDirectionLabel || null,
			quick_direction_prompt: safeSpec.quickDirectionPrompt || null,
			direction_label: directionLabel || null,
			direction_description: directionRule || null,
			pose_transform_required: hasQuickDirection,
			remove_background: safeSpec.removeBackground,
			flat_background: safeSpec.enforceFlatBackground ? safeSpec.chromaHex : null,
			task: safePrompt || safeSpec.compiledPrompt || safeSpec.userPrompt
		}
	};
}

async function buildNanoPromptJsonWithModel(input) {
	const deterministic = buildDeterministicNanoPromptJson(input);
	const llmInstruction = `Return ONLY a valid JSON object that follows this shape:
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "string",
  "user_intent": "string",
  "meta": { "aspect_ratio": "string", "quality": "string", "safety_filter": "string" },
  "subject": [ { "id": "string", "type": "string", "description": "string", "input_image": { "path": "string", "usage_type": "string" } } ],
  "scene": { "description": "string", "composition": { "camera_angle": "string", "camera_direction": "object|null", "subject_scale": "string", "framing": "string", "style_lock": "string" } },
  "style_modifiers": { "medium": "string", "aesthetic": ["string"] },
  "advanced": { "negative_prompt": ["string"], "magic_prompt_enhancer": false },
  "edit_controls": {
    "mode": "string",
    "context": "string",
    "edit_strategy": "string",
    "quick_direction_label": "string|null",
    "quick_direction_prompt": "string|null",
    "direction_label": "string|null",
    "direction_description": "string|null",
    "pose_transform_required": "boolean",
    "remove_background": "boolean",
    "flat_background": "string|null",
    "task": "string"
  }
}
Critical rules:
- Preserve camera angle, framing, perspective, subject scale, style, and identity exactly from reference image.
- If quick_direction_prompt is present, perform that pose/action change clearly as a major visible transformation (not minor micro-adjustment).
- If direction_description is present, follow it as a strict camera-facing direction requirement.
- Do not introduce fields not in the provided shape.
- Do not wrap in markdown.`;

	const llmPayload = {
		source: 'spritemagician_edit_panel',
		request: input,
		fallback_json: deterministic
	};

	try {
		if (env.OPENAI_API_KEY) {
			const openAiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${env.OPENAI_API_KEY}`,
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					model: 'gpt-4.1-mini',
					temperature: 0.1,
					response_format: { type: 'json_object' },
					messages: [
						{ role: 'system', content: llmInstruction },
						{ role: 'user', content: JSON.stringify(llmPayload) }
					]
				})
			});
			if (openAiResponse.ok) {
				const openAiJson = await openAiResponse.json().catch(() => null);
				const content = openAiJson?.choices?.[0]?.message?.content || '';
				const parsed = parseJsonPayload(content);
				if (parsed?.meta && parsed?.subject && parsed?.scene) return parsed;
			}
		}
	} catch (error) {
		console.warn('[Edit Image] OpenAI prompt compiler fallback:', error?.message || error);
	}

	try {
		const ai = getClient();
		const response = await ai.models.generateContent({
			model: 'gemini-2.5-flash',
			contents: [
				{
					role: 'user',
					parts: [{ text: llmInstruction }, { text: JSON.stringify(llmPayload) }]
				}
			],
			config: {
				temperature: 0.1,
				candidateCount: 1,
				responseModalities: ['TEXT']
			}
		});
		const text = String(response?.text || response?.candidates?.[0]?.content?.parts?.[0]?.text || '');
		const parsed = parseJsonPayload(text);
		if (parsed?.meta && parsed?.subject && parsed?.scene) return parsed;
	} catch (error) {
		console.warn('[Edit Image] Gemini prompt compiler fallback:', error?.message || error);
	}

	return deterministic;
}

async function submitRunpodJob({ apiKey, endpointId, input }) {
	const response = await fetch(`https://api.runpod.ai/v2/${endpointId}/run`, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${apiKey}`,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({ input })
	});

	const data = await response.json().catch(() => ({}));
	if (!response.ok) {
		throw new Error(data?.error || data?.message || `RunPod request failed (${response.status})`);
	}
	return data;
}

async function getRunpodJobStatus({ apiKey, endpointId, jobId }) {
	const response = await fetch(`https://api.runpod.ai/v2/${endpointId}/status/${encodeURIComponent(jobId)}`, {
		headers: {
			Authorization: `Bearer ${apiKey}`
		}
	});
	const data = await response.json().catch(() => ({}));
	if (!response.ok) {
		throw new Error(data?.error || data?.message || `RunPod status failed (${response.status})`);
	}
	return data;
}

function isRunpodTerminalStatus(status) {
	const s = String(status || '').toUpperCase();
	return s === 'COMPLETED' || s === 'FAILED' || s === 'CANCELLED' || s === 'TIMED_OUT';
}

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForRunpodCompletion({ apiKey, endpointId, initialResponse, timeoutMs = 540_000 }) {
	if (initialResponse?.output) return initialResponse;
	const jobId = String(initialResponse?.id || '').trim();
	if (!jobId) return initialResponse;

	const startedAt = Date.now();
	let latest = initialResponse;

	while (Date.now() - startedAt < timeoutMs) {
		latest = await getRunpodJobStatus({ apiKey, endpointId, jobId });
		const status = String(latest?.status || '').toUpperCase();
		if (status === 'COMPLETED') return latest;
		if (isRunpodTerminalStatus(status)) {
			const errorMessage =
				latest?.error ||
				latest?.message ||
				`RunPod job ended with status ${status || 'UNKNOWN'}`;
			throw new Error(errorMessage);
		}
		await sleep(1500);
	}

	throw new Error('RunPod job timed out while waiting for completion');
}

function extractRunpodImageValue(payload) {
	const output = payload?.output ?? payload;
	if (typeof output === 'string' && output.trim()) return output;
	if (typeof output?.image === 'string' && output.image.trim()) return output.image;
	if (typeof output?.edited_image === 'string' && output.edited_image.trim()) return output.edited_image;
	if (typeof output?.image_url === 'string' && output.image_url.trim()) return output.image_url;
	if (typeof output?.url === 'string' && output.url.trim()) return output.url;
	return extractFirstImageDataUrl(output) || extractFirstImageUrl(output) || '';
}

function normalizeRunpodImageToDataUrl(value) {
	const raw = String(value || '').trim();
	if (!raw) return '';
	if (raw.startsWith('data:')) return raw;
	if (/^[A-Za-z0-9+/=\r\n]+$/.test(raw) && raw.length > 128) {
		const compact = raw.replace(/\s+/g, '');
		return `data:image/png;base64,${compact}`;
	}
	return raw;
}

async function fetchImageAsDataUrl(url) {
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`Failed to download generated image: ${response.status} ${response.statusText}`);
	}
	const contentType = response.headers.get('content-type') || 'image/png';
	const mimeType = String(contentType).split(';')[0] || 'image/png';
	const buffer = await response.arrayBuffer();
	const base64 = Buffer.from(buffer).toString('base64');
	return `data:${mimeType};base64,${base64}`;
}

function extractGeneratedImage(result) {
	let generatedImage = '';
	const parts = result?.candidates?.[0]?.content?.parts || [];
	for (const part of parts) {
		if (part?.inlineData?.data) return `data:image/png;base64,${part.inlineData.data}`;
		if (part?.inline_data?.data) return `data:image/png;base64,${part.inline_data.data}`;
	}
	return generatedImage;
}

async function generateWithNanoBananaEdit({
	image,
	prompt,
	mode = 'edit',
	preferDetailFidelity = false,
	promptSpec = null,
	imgWidth = 0,
	imgHeight = 0
}) {
	if (!env.GEMINI_API_KEY) {
		throw new Error('Gemini API key not configured. Set GEMINI_API_KEY in .env');
	}
	let mimeType = 'image/png';
	let base64Data = '';
	if (String(image || '').startsWith('http://') || String(image || '').startsWith('https://')) {
		const fetched = await fetchImageAsDataUrl(image);
		const match = fetched.match(/^data:([^;]+);base64,(.*)$/);
		if (match) {
			mimeType = match[1] || 'image/png';
			base64Data = match[2] || '';
		}
	} else if (String(image || '').startsWith('data:')) {
		const base64Index = image.indexOf(',');
		if (base64Index >= 0) {
			const header = image.slice(0, base64Index);
			const mimeMatch = header.match(/data:(.*?);/);
			if (mimeMatch?.[1]) mimeType = mimeMatch[1];
			base64Data = image.slice(base64Index + 1);
		}
	} else {
		base64Data = String(image || '');
	}
	if (!base64Data) {
		throw new Error('Invalid source image for Nano Banana edit');
	}

	const structuredPromptJson = await buildNanoPromptJsonWithModel({
		prompt: String(prompt || '').trim(),
		mode,
		promptSpec,
		imgWidth,
		imgHeight
	});
	const cheapEditInstruction = [
		'NANO BANANA EDIT JSON MODE (STRICT LOCK):',
		'- Treat attached source image as immutable visual reference.',
		'- Preserve camera angle, framing, perspective, subject scale, style, lighting, and identity unless task explicitly changes a target detail.',
		'- If quick direction is provided, apply it as a clear full-body pose/action change (not subtle).',
		'- Return exactly one edited image.',
		preferDetailFidelity ? '- Preserve micro-details and silhouette fidelity.' : '',
		'JSON_TASK:',
		JSON.stringify(structuredPromptJson, null, 2)
	]
		.filter(Boolean)
		.join('\n\n');
	const outputAspectRatio = computeAspectRatio(imgWidth, imgHeight);

	const response = await fetch(
		`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${env.GEMINI_API_KEY}`,
		{
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				contents: [
					{
						parts: [
							{
								inline_data: {
									mime_type: mimeType,
									data: base64Data
								}
							},
							{ text: cheapEditInstruction }
						]
					}
				],
				generationConfig: {
					responseModalities: ['IMAGE'],
					imageConfig: { aspectRatio: outputAspectRatio }
				}
			})
		}
	);
	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(`Gemini API error: ${response.status} ${errorText}`);
	}
	const result = await response.json();
	const generated = extractGeneratedImage(result);
	if (!generated) throw new Error('Nano Banana edit returned no image');
	return { image: generated, promptJson: structuredPromptJson };
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
			image,
			prompt,
			mode,
			preferDetailFidelity = false,
			editModel = 'nano_banana',
			promptSpec = null,
			imgWidth,
			imgHeight
		} = await request.json();
		const selectedEditModel = normalizeEditModel(editModel);
		const payload = {
			image,
			prompt,
			mode,
			editModel: selectedEditModel,
			preferDetailFidelity: !!preferDetailFidelity,
			promptSpec: promptSpec && typeof promptSpec === 'object' ? sanitizePromptSpec(promptSpec) : null
		};
		payloadBytes = approxJsonBytes(payload);
		idempotencyKey = request.headers.get('Idempotency-Key')?.trim() || null;
		requestHash = makeRequestHash(payload);
		if (payloadBytes > 6 * 1024 * 1024) {
			return json({ error: 'Request payload too large' }, { status: 413 });
		}
		const rate = enforceRateLimit({
			uid: locals.user.uid,
			routeKey: 'edit-image',
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
				routeKey: 'edit-image',
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

		if (!image || !prompt) {
			return json({ error: 'Image and prompt are required' }, { status: 400 });
		}

		console.log(
			`[Edit Image] Model: nano_banana, mode: ${mode}, prompt: ${String(prompt || '').slice(0, 80)}...`
		);
		if (activeNanoEditUsers.has(locals.user.uid)) {
			return json({ error: 'Only one edit generation can run at a time.' }, { status: 429 });
		}
		activeNanoEditUsers.add(locals.user.uid);
		try {
			const edited = await generateWithNanoBananaEdit({
				image,
				prompt,
				mode,
				preferDetailFidelity,
				promptSpec,
				imgWidth,
				imgHeight
			});
			const responseBody = { image: edited.image, promptJson: edited.promptJson || null };
			if (idempotencyKey) {
				await completeIdempotentRequest({
					uid: locals.user.uid,
					routeKey: 'edit-image',
					idempotencyKey,
					requestHash,
					responseStatus: 200,
					responseBody
				});
			}
			await recordUsageEvent({
				uid: locals.user.uid,
				routeKey: 'edit-image',
				provider: 'gemini',
				statusCode: 200,
				requestBytes: payloadBytes,
				metadata: {
					mode: mode || 'edit',
					model: selectedEditModel,
					cheapOutput: true,
					outputMaxEdge: 640
				}
			});
			return json(responseBody);
		} catch (nanoError) {
			console.error('[Edit Image] Nano Banana path failed:', nanoError);
			await recordUsageEvent({
				uid: locals.user.uid,
				routeKey: 'edit-image',
				provider: 'gemini',
				success: false,
				statusCode: 500,
				requestBytes: payloadBytes,
				metadata: { error: String(nanoError.message || 'Nano Banana failed').slice(0, 200) }
			});
			return json(
				{
					error: 'Nano Banana image edit failed',
					details: nanoError.message
				},
				{ status: 500 }
			);
		} finally {
			activeNanoEditUsers.delete(locals.user.uid);
		}

	} catch (error) {
		console.error('[Edit Image] Error:', error);
		console.error('[Edit Image] Stack:', error.stack);
		if (idempotencyKey && requestHash && locals.user?.uid) {
			try {
				await failIdempotentRequest({
					uid: locals.user.uid,
					routeKey: 'edit-image',
					idempotencyKey,
					requestHash,
					errorMessage: error.message
				});
			} catch {
				// best effort
			}
		}
		if (error.name === 'AbortError') {
			if (locals.user?.uid) {
				await recordUsageEvent({
					uid: locals.user.uid,
					routeKey: 'edit-image',
					provider: 'runpod',
					success: false,
					statusCode: 504,
					requestBytes: payloadBytes,
					metadata: { error: 'Request timed out' }
				});
			}
			return json({ error: 'Request timed out after 5 minutes' }, { status: 504 });
		}
		// Ensure error message is serializable
		const errorMessage = error.message || 'Unknown error occurred';
		if (locals.user?.uid) {
			await recordUsageEvent({
				uid: locals.user.uid,
				routeKey: 'edit-image',
				provider: 'runpod',
				success: false,
				statusCode: 500,
				requestBytes: payloadBytes,
				metadata: { error: String(errorMessage).slice(0, 200) }
			});
		}
		return json({ error: errorMessage }, { status: 500 });
	}
}
