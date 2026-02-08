/**
 * Style Transfer — re-render a character in HoMM3 pixel-art style
 *
 * Uses the @google/genai SDK with a Master Style Anchor image.
 * The anchor image is loaded once (cached) and attached to every request
 * so the model treats it as latent-space "style DNA."
 */

import { json } from '@sveltejs/kit';
import {
	generateWithCascade,
	extractImage,
	stripDataUrl,
	STYLE_KEYWORDS,
} from '$lib/server/gemini.js';
import { getMasterStyle } from '$lib/server/styleAnchor.js';

export async function POST({ request, locals }) {
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
		} = await request.json();

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

		const charPx = characterPixels || 160;
		const canvasPx = canvasPixels || 224;

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
				`grey background (#808080), centered in a ${canvasPx}×${canvasPx}px canvas.`,
			].join('\n'),
		});

		console.log(
			`[Style] "${characterName || 'unnamed'}" | ${charPx}px in ${canvasPx}px | anchor=${masterStyle.source}`,
		);

		// ── Generate with model cascade ──────────────────
		const { response, model } = await generateWithCascade(parts, {
			temperature: 0.4,
		});

		const image = extractImage(response);
		if (!image) {
			return json({ error: 'No image generated' }, { status: 500 });
		}

		console.log(`[Style] ✓ Done "${characterName || 'unnamed'}" via ${model}`);
		return json({ image });

	} catch (error) {
		console.error('[Style] Error:', error);
		if (error.name === 'AbortError') {
			return json({ error: 'Timed out after 5 minutes' }, { status: 504 });
		}
		return json({ error: error.message }, { status: 500 });
	}
}
