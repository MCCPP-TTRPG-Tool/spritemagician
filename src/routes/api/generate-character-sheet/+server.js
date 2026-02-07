/**
 * Character Sheet Generation — Single-pass using Google Gemini
 * 
 * Generates a basic turnaround (front, right side, back, left side)
 */

import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent';

/** Extract base64 payload from a data URL */
function stripDataUrl(dataUrl) {
	if (dataUrl.startsWith('data:')) {
		const idx = dataUrl.indexOf(',');
		return idx !== -1 ? dataUrl.substring(idx + 1) : dataUrl;
	}
	return dataUrl;
}

/** Extract first generated image from a Gemini response */
function extractImage(result) {
	if (result.candidates?.[0]?.content?.parts) {
		for (const part of result.candidates[0].content.parts) {
			const data = part.inlineData?.data || part.inline_data?.data;
			if (data) return `data:image/png;base64,${data}`;
		}
	}
	return null;
}

/** Call Gemini with images + text, return raw JSON */
async function callGemini(apiKey, imageParts, textPrompt, aspectRatio = '1:1', timeoutMs = 5 * 60 * 1000) {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), timeoutMs);

	const parts = [];
	for (const img of imageParts) {
		parts.push({ text: img.label });
		parts.push({ inline_data: { mime_type: 'image/png', data: img.base64 } });
	}
	parts.push({ text: textPrompt });

	try {
		const response = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			signal: controller.signal,
			body: JSON.stringify({
				contents: [{ parts }],
				generationConfig: {
					responseModalities: ['TEXT', 'IMAGE'],
					imageConfig: { aspectRatio }
				}
			})
		});

		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(`Gemini API error ${response.status}: ${errorText}`);
		}

		return await response.json();
	} finally {
		clearTimeout(timeout);
	}
}

export async function POST({ request, locals }) {
	try {
		if (!locals.user) {
			return json({ error: 'Authentication required' }, { status: 401 });
		}

		const { referenceImage, characterName } = await request.json();

		if (!referenceImage) {
			return json({ error: 'Reference image is required' }, { status: 400 });
		}
		if (!env.GEMINI_API_KEY) {
			return json({ error: 'Gemini API key not configured' }, { status: 500 });
		}

		const refBase64 = stripDataUrl(referenceImage);
		const name = characterName || 'Character';

		// ═════════════════════════════════════════════════
		// Generate basic cardinal turnaround
		// ═════════════════════════════════════════════════
		console.log(`[Sheet] Generating turnaround for: ${name}`);

		const prompt = `TASK: Create a BASIC TURNAROUND REFERENCE SHEET for this character/creature.

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

BODY PROPORTIONS — MATCH THE REFERENCE EXACTLY:
- Study the head-to-body ratio in the reference image CAREFULLY
- If the character has a realistically proportioned body (head is ~1/7 to 1/8 of total height), draw it that way — do NOT enlarge the head
- If the character is intentionally chibi/stylized with a large head, keep that stylization
- Measure the reference: how many "heads tall" is the figure? Replicate that EXACT ratio
- Common mistake: making the head too large on normally-proportioned characters. AVOID THIS
- Shoulders, torso length, arm length, leg length — all must match the reference proportions
- If the character is muscular, lean, stocky, tall, short — match that body type exactly
- Do NOT default to cartoon proportions unless the reference IS a cartoon

Accuracy and consistency are the top priority.`;

		const result = await callGemini(
			env.GEMINI_API_KEY,
			[{ label: 'ORIGINAL REFERENCE — replicate this subject exactly:', base64: refBase64 }],
			prompt,
			'16:9'
		);

		const sheetImage = extractImage(result);
		if (!sheetImage) {
			console.error('[Sheet] No image in response:', result);
			return json({ error: 'Character sheet generation failed — no image generated', details: JSON.stringify(result) }, { status: 500 });
		}

		console.log('[Sheet] ✓ Turnaround generated');

		return json({ sheet: sheetImage });

	} catch (error) {
		console.error('[Character Sheet] Error:', error);
		return json({ error: error.message }, { status: 500 });
	}
}
