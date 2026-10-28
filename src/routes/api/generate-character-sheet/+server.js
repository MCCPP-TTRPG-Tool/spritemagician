/**
 * Character Sheet Generation — turnaround reference using @google/genai SDK
 *
 * Generates a basic turnaround (front, right side, back, left side)
 * using the Gemini model cascade from gemini.js.
 */

import { json } from '@sveltejs/kit';
import { inlineLocalInputs } from '$lib/server/localFiles.js';
import {
	generateWithCascade,
	extractImage,
	stripDataUrl,
} from '$lib/server/gemini.js';
import { CHROMA_KEY_HEX } from '$lib/constants/chromaKey.js';
import { approxJsonBytes, enforceRateLimit } from '$lib/server/security.js';
import { isDataUrl } from '$lib/server/validation.js';
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
		if (!locals.user) {
			return json({ error: 'Authentication required' }, { status: 401 });
		}

		const { referenceImage, characterName } = inlineLocalInputs(await request.json());
		const safeCharacterName = String(characterName || '').trim().slice(0, 120);
		const payload = {
			referenceImage,
			characterName: safeCharacterName
		};
		payloadBytes = approxJsonBytes(payload);
		idempotencyKey = request.headers.get('Idempotency-Key')?.trim() || null;
		requestHash = makeRequestHash(payload);
		if (payloadBytes > 8 * 1024 * 1024) {
			return json({ error: 'Request payload too large' }, { status: 413 });
		}
		const rate = enforceRateLimit({
			uid: locals.user.uid,
			routeKey: 'generate-character-sheet',
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
				routeKey: 'generate-character-sheet',
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

		if (!referenceImage) {
			return json({ error: 'Reference image is required' }, { status: 400 });
		}
		if (!isDataUrl(referenceImage)) {
			return json({ error: 'referenceImage must be a base64 data URL' }, { status: 400 });
		}

		const refBase64 = stripDataUrl(referenceImage);
		const name = safeCharacterName || 'Character';

		// ── Build multimodal parts ───────────────────────
		/** @type {import('@google/genai').Part[]} */
		const parts = [];

		parts.push({ text: 'ORIGINAL REFERENCE — replicate this subject exactly:' });
		parts.push({ inlineData: { mimeType: 'image/png', data: refBase64 } });

		parts.push({
			text: `TASK: Create a BASIC TURNAROUND REFERENCE SHEET for this character/creature.

CHARACTER NAME: ${name}

Generate a single image showing this EXACT subject from 4 cardinal angles arranged in a horizontal row, evenly spaced:

LEFT TO RIGHT:
1. FRONT VIEW — subject facing directly toward the camera
2. RIGHT SIDE VIEW — pure side profile, subject facing right
3. BACK VIEW — subject facing directly away from the camera
4. LEFT SIDE VIEW — pure side profile, subject facing left

CRITICAL RULES:
- Reproduce the EXACT subject from the reference — same design, colors, proportions, anatomy, markings, outfit, accessories, textures
- Count every limb, horn, tail, wing, claw, and feature — ALL must be present in EVERY view
- All 4 views must be the SAME SCALE and vertically aligned at the feet/base
- Neutral standing/resting pose — all limbs visible and unoccluded
- Clean solid CHROMA KEY background (${CHROMA_KEY_HEX})
- Professional model-sheet quality: clean lines, even lighting, no dramatic shadows
- Label each view underneath: "FRONT", "RIGHT SIDE", "BACK", "LEFT SIDE"
- NO 3/4 angles in this sheet — strict cardinal directions only
- Do not use ${CHROMA_KEY_HEX} on the subject itself; reserve it for background only

PROPORTIONS — THIS IS THE MOST IMPORTANT RULE:
- All 4 views must have IDENTICAL proportions — same height, same width, same limb lengths, same head size
- Match the reference image's proportions exactly. Count how many "heads tall" the figure is and keep that ratio
- Do NOT enlarge the head. Do NOT widen the body in the back view. Do NOT change muscle mass between views
- The silhouette width/height should be consistent across all 4 views (only depth changes)
- If the character is lean, keep it lean in every view. If muscular, keep the same muscle mass in every view

Accuracy and consistency across all 4 views are the top priority.`,
		});

		console.log(`[Sheet] Generating turnaround for: ${name}`);

		// ── Generate with model cascade ──────────────────
		const { response, model } = await generateWithCascade(parts, {
			temperature: 0.3, // stricter adherence for reference sheets
		});

		const sheetImage = extractImage(response);
		if (!sheetImage) {
			console.error('[Sheet] No image in response');
			return json(
				{ error: 'Character sheet generation failed — no image generated' },
				{ status: 500 },
			);
		}

		console.log(`[Sheet] ✓ Turnaround generated via ${model}`);
		const responseBody = { sheet: sheetImage };
		if (idempotencyKey) {
			await completeIdempotentRequest({
				uid: locals.user.uid,
				routeKey: 'generate-character-sheet',
				idempotencyKey,
				requestHash,
				responseStatus: 200,
				responseBody
			});
		}
		await recordUsageEvent({
			uid: locals.user.uid,
			routeKey: 'generate-character-sheet',
			provider: 'gemini',
			statusCode: 200,
			requestBytes: payloadBytes,
			metadata: { model: model || 'unknown' }
		});
		return json(responseBody);

	} catch (error) {
		console.error('[Sheet] Error:', error);
		if (idempotencyKey && requestHash && locals.user?.uid) {
			try {
				await failIdempotentRequest({
					uid: locals.user.uid,
					routeKey: 'generate-character-sheet',
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
				routeKey: 'generate-character-sheet',
				provider: 'gemini',
				success: false,
				statusCode: 500,
				requestBytes: payloadBytes,
				metadata: { error: String(error.message || 'unknown').slice(0, 200) }
			});
		}
		return json({ error: error.message }, { status: 500 });
	}
}
