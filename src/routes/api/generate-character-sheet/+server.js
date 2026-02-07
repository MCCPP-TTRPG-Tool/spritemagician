/**
 * Character Sheet Generation — Single-pass using Google Gemini
 * 
 * Generates a basic turnaround (front, right side, back, left side)
 */

import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

// Best model first, fallback to weaker ones
const GEMINI_MODELS = [
	'gemini-3-pro-image-preview',
	'gemini-2.0-flash-exp-image-generation',
	'gemini-2.5-flash-image',
];

function stripDataUrl(dataUrl) {
	if (dataUrl.startsWith('data:')) {
		const idx = dataUrl.indexOf(',');
		return idx !== -1 ? dataUrl.substring(idx + 1) : dataUrl;
	}
	return dataUrl;
}

function extractImage(result) {
	for (const part of result.candidates?.[0]?.content?.parts || []) {
		const data = part.inlineData?.data || part.inline_data?.data;
		if (data) return `data:image/png;base64,${data}`;
	}
	return null;
}

async function callGemini(apiKey, imageParts, textPrompt, aspectRatio = '1:1', timeoutMs = 5 * 60 * 1000) {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), timeoutMs);

	const parts = [];
	for (const img of imageParts) {
		parts.push({ text: img.label });
		parts.push({ inline_data: { mime_type: 'image/png', data: img.base64 } });
	}
	parts.push({ text: textPrompt });

	const body = JSON.stringify({
		contents: [{ parts }],
		generationConfig: {
			responseModalities: ['TEXT', 'IMAGE'],
		}
	});

	try {
		for (const model of GEMINI_MODELS) {
			console.log(`[Sheet] Trying ${model}...`);
			try {
				const response = await fetch(
					`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
					{
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						signal: controller.signal,
						body,
					}
				);
				if (response.ok) {
					console.log(`[Sheet] ✓ ${model}`);
					return await response.json();
				}
				console.warn(`[Sheet] ${model} → ${response.status}`);
			} catch (e) {
				if (e.name === 'AbortError') throw e;
				console.warn(`[Sheet] ${model} error: ${e.message}`);
			}
		}
		throw new Error('All Gemini models failed');
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

PROPORTIONS — THIS IS THE MOST IMPORTANT RULE:
- All 4 views must have IDENTICAL proportions — same height, same width, same limb lengths, same head size
- Match the reference image's proportions exactly. Count how many "heads tall" the figure is and keep that ratio
- Do NOT enlarge the head. Do NOT widen the body in the back view. Do NOT change muscle mass between views
- The silhouette width/height should be consistent across all 4 views (only depth changes)
- If the character is lean, keep it lean in every view. If muscular, keep the same muscle mass in every view

Accuracy and consistency across all 4 views are the top priority.`;

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
