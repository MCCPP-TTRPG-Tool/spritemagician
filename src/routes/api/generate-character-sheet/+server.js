/**
 * Character Sheet Generation — turnaround reference using @google/genai SDK
 *
 * Generates a basic turnaround (front, right side, back, left side)
 * using the Gemini model cascade from gemini.js.
 */

import { json } from '@sveltejs/kit';
import {
	generateWithCascade,
	extractImage,
	stripDataUrl,
} from '$lib/server/gemini.js';

export async function POST({ request, locals }) {
	try {
		if (!locals.user) {
			return json({ error: 'Authentication required' }, { status: 401 });
		}

		const { referenceImage, characterName } = await request.json();

		if (!referenceImage) {
			return json({ error: 'Reference image is required' }, { status: 400 });
		}

		const refBase64 = stripDataUrl(referenceImage);
		const name = characterName || 'Character';

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
- Clean solid LIGHT GREY background (#E8E8E8)
- Professional model-sheet quality: clean lines, even lighting, no dramatic shadows
- Label each view underneath: "FRONT", "RIGHT SIDE", "BACK", "LEFT SIDE"
- NO 3/4 angles in this sheet — strict cardinal directions only

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
		return json({ sheet: sheetImage });

	} catch (error) {
		console.error('[Sheet] Error:', error);
		return json({ error: error.message }, { status: 500 });
	}
}
