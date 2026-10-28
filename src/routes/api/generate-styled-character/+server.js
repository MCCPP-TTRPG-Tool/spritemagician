/**
 * Style Transfer — re-render a character in HoMM3 pixel-art style
 *
 * Uses the @google/genai SDK with a Master Style Anchor image.
 * The anchor image is loaded once (cached) and attached to every request
 * so the model treats it as latent-space "style DNA."
 */

import { json } from '@sveltejs/kit';
import { inlineLocalInputs } from '$lib/server/localFiles.js';
import {
	generateWithCascade,
	extractImage,
	stripDataUrl,
	STYLE_KEYWORDS,
} from '$lib/server/gemini.js';
import { getMasterStyle } from '$lib/server/styleAnchor.js';
import { CHROMA_KEY_HEX } from '$lib/constants/chromaKey.js';
import { approxJsonBytes, enforceRateLimit } from '$lib/server/security.js';
import { isDataUrl, normalizeBoundedInt } from '$lib/server/validation.js';
import {
	beginIdempotentRequest,
	completeIdempotentRequest,
	failIdempotentRequest,
	makeRequestHash,
	recordUsageEvent
} from '$lib/server/requestTracking.js';

export async function POST({ request, locals }) {
	let payloadBytes = 0;
	let idempotencyKey = null;
	let requestHash = null;
	try {
		// ── Auth ──────────────────────────────────────────
		if (!locals.user) {
			return json({ error: 'Authentication required' }, { status: 401 });
		}

		const {
			referenceImage,
			characterSheet,
			characterName,
			characterPixels,
			canvasPixels,
		} = inlineLocalInputs(await request.json());
		const safeName = String(characterName || '').trim().slice(0, 120);
		const charPx = normalizeBoundedInt(characterPixels, 160, 32, 512);
		const canvasPx = normalizeBoundedInt(canvasPixels, 224, 64, 1024);
		const payload = {
			referenceImage,
			characterSheet,
			characterName: safeName,
			characterPixels: charPx,
			canvasPixels: canvasPx
		};
		payloadBytes = approxJsonBytes(payload);
		idempotencyKey = request.headers.get('Idempotency-Key')?.trim() || null;
		requestHash = makeRequestHash(payload);
		if (payloadBytes > 12 * 1024 * 1024) {
			return json({ error: 'Request payload too large' }, { status: 413 });
		}
		const rate = enforceRateLimit({
			uid: locals.user.uid,
			routeKey: 'generate-styled-character',
			maxRequests: 20,
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
				routeKey: 'generate-styled-character',
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

		if (!characterSheet && !referenceImage) {
			return json({ error: 'Need at least one reference image' }, { status: 400 });
		}

		// ── Load Master Style ────────────────────────────
		const masterStyle = await getMasterStyle();
		if (!masterStyle) {
			return json(
				{ error: 'No master style image configured. Upload one via Style Anchor settings.' },
				{ status: 500 },
			);
		}

		// ── Build multimodal parts ───────────────────────
		/** @type {import('@google/genai').Part[]} */
		const parts = [];

		// Part 1 — Style Anchor (the "lock")
		parts.push({ text: 'STYLE REFERENCE — match this exact visual style:' });
		parts.push({
			inlineData: {
				mimeType: masterStyle.mimeType,
				data: masterStyle.base64,
			},
		});

		// Part 2 — Character reference(s)
		parts.push({ text: 'CHARACTER TO DRAW — reproduce this character exactly:' });

		// Helper: resolve an image value to { mimeType, data } for Gemini
		async function resolveImage(img) {
			if (!img) return null;
			// If it's a URL, fetch and convert to base64
			if (typeof img === 'string' && (img.startsWith('http://') || img.startsWith('https://'))) {
				const res = await fetch(img);
				if (!res.ok) throw new Error(`Failed to fetch image: ${res.status}`);
				const buf = Buffer.from(await res.arrayBuffer());
				const mime = res.headers.get('content-type') || 'image/png';
				return { mimeType: mime, data: buf.toString('base64') };
			}
			// Otherwise treat as base64 / data-url
			if (!isDataUrl(img)) {
				throw new Error('Reference image must be a base64 data URL or an allowed image URL');
			}
			return { mimeType: 'image/png', data: stripDataUrl(img) };
		}

		const refPart = await resolveImage(referenceImage);
		const sheetPart = await resolveImage(characterSheet);

		if (refPart) {
			parts.push({ inlineData: refPart });
		}
		if (sheetPart) {
			parts.push({ inlineData: sheetPart });
		}

		// Part 3 — Text instruction with style keywords
		parts.push({
			text: [
				`Draw this exact character as a ${charPx}×${charPx}px sprite.`,
				'',
				`Style: ${STYLE_KEYWORDS}.`,
				'',
				'Same creature. Same anatomy. Same colors. Same features.',
				'Nothing added, nothing removed. Only the art style changes.',
				'',
				`Output: single sprite, 3/4 isometric view facing right, idle stance,`,
				`solid chroma key background (${CHROMA_KEY_HEX}), centered in a ${canvasPx}×${canvasPx}px canvas.`,
				'',
				'CRITICAL REQUIREMENTS - MUST FOLLOW:',
				'- Absolutely NO black borders, NO black outlines, NO black edges, NO black lines, NO black strokes, NO black rims',
				'- NO dark borders or dark outlines of any kind',
				'- The character must blend seamlessly with the grey background - no visible separation',
				'- All edges should be soft and blend naturally - no hard black lines',
				'- If you see any black pixels around the character, remove them completely',
				'- The character should appear to emerge naturally from the background without any border',
				`- Reserve ${CHROMA_KEY_HEX} for background only; do not use that exact color on the character`,
			].join('\n'),
		});

		console.log(
			`[Style] "${safeName || 'unnamed'}" | ${charPx}px in ${canvasPx}px | anchor=${masterStyle.source}`,
		);

		// ── Generate with model cascade ──────────────────
		const { response, model } = await generateWithCascade(parts, {
			temperature: 0.4,
		});

		const image = extractImage(response);
		if (!image) {
			return json({ error: 'No image generated' }, { status: 500 });
		}

		console.log(`[Style] ✓ Done "${safeName || 'unnamed'}" via ${model}`);
		const responseBody = { image };
		if (idempotencyKey) {
			await completeIdempotentRequest({
				uid: locals.user.uid,
				routeKey: 'generate-styled-character',
				idempotencyKey,
				requestHash,
				responseStatus: 200,
				responseBody
			});
		}
		await recordUsageEvent({
			uid: locals.user.uid,
			routeKey: 'generate-styled-character',
			provider: 'gemini',
			statusCode: 200,
			requestBytes: payloadBytes,
			metadata: { model: model || 'unknown' }
		});
		return json(responseBody);

	} catch (error) {
		console.error('[Style] Error:', error);
		if (idempotencyKey && requestHash && locals.user?.uid) {
			try {
				await failIdempotentRequest({
					uid: locals.user.uid,
					routeKey: 'generate-styled-character',
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
				routeKey: 'generate-styled-character',
				provider: 'gemini',
				success: false,
				statusCode: 500,
				requestBytes: payloadBytes,
				metadata: { error: String(error.message || 'unknown').slice(0, 200) }
			});
		}
		if (error.name === 'AbortError') {
			return json({ error: 'Timed out after 5 minutes' }, { status: 504 });
		}
		return json({ error: error.message }, { status: 500 });
	}
}
