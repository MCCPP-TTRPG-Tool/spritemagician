/**
 * Style Transfer — re-render a character in HoMM3 sprite style
 */

import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import fs from 'fs';
import path from 'path';

let cachedStyleImages = null;

function loadStyleImages() {
	if (cachedStyleImages) return cachedStyleImages;
	const styleDir = path.resolve('static/Example images');
	const files = fs.readdirSync(styleDir).filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f)).sort();
	cachedStyleImages = files.map(file => {
		const buffer = fs.readFileSync(path.join(styleDir, file));
		const ext = path.extname(file).toLowerCase();
		const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
		return { filename: file, base64: buffer.toString('base64'), mime };
	});
	console.log(`[Style] Loaded ${cachedStyleImages.length} style refs`);
	return cachedStyleImages;
}

function stripBase64(dataUrl) {
	if (!dataUrl) return null;
	if (dataUrl.startsWith('data:')) {
		const i = dataUrl.indexOf(',');
		return i !== -1 ? dataUrl.substring(i + 1) : dataUrl;
	}
	return dataUrl;
}

export async function POST({ request, locals }) {
	try {
		if (!locals.user) {
			return json({ error: 'Authentication required' }, { status: 401 });
		}

		const { referenceImage, characterSheet, characterName, spriteSize, characterPixels, canvasPixels, animationPadding } = await request.json();

		if (!characterSheet && !referenceImage) {
			return json({ error: 'Need at least one reference image' }, { status: 400 });
		}
		if (!env.GEMINI_API_KEY) {
			return json({ error: 'Gemini API key not configured' }, { status: 500 });
		}

		const styleImages = loadStyleImages();
		if (!styleImages.length) {
			return json({ error: 'No style images in static/Example images/' }, { status: 500 });
		}

		const charPx = characterPixels || 160;
		const canvasPx = canvasPixels || 224;

		const refB64 = stripBase64(referenceImage);
		const sheetB64 = stripBase64(characterSheet);

		// ── Build prompt: images first, short instruction last ──
		const parts = [];

		// 1. Style references — "draw like THESE"
		parts.push({ text: 'TARGET STYLE — draw in this exact style:' });
		for (const img of styleImages) {
			parts.push({ inline_data: { mime_type: img.mime, data: img.base64 } });
		}

		// 2. Character references — "draw THIS character"
		parts.push({ text: 'CHARACTER TO DRAW — copy this exactly:' });
		if (refB64) {
			parts.push({ inline_data: { mime_type: 'image/png', data: refB64 } });
		}
		if (sheetB64) {
			parts.push({ inline_data: { mime_type: 'image/png', data: sheetB64 } });
		}

		// 3. Short, direct instruction
		parts.push({
			text: `Draw this exact character in the style of the reference sprites above.

Same creature. Same anatomy. Same colors. Same features. Nothing added, nothing removed.
Only the art style changes — match the style references exactly.

Output: single ${charPx}×${charPx}px sprite, 3/4 view facing right, idle stance, grey background (#808080), centered in ${canvasPx}×${canvasPx}px canvas.`
		});

		console.log(`[Style] "${characterName}" | ${charPx}px in ${canvasPx}px | ${styleImages.length} style refs`);

		// ── Call Gemini — try best model first ──
		const models = [
			'gemini-3-pro-image-preview',
			'gemini-2.0-flash-exp-image-generation',
			'gemini-2.5-flash-image',
		];

		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 5 * 60 * 1000);
		let response = null;

		try {
			for (const model of models) {
				console.log(`[Style] Trying ${model}...`);
				try {
					response = await fetch(
						`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`,
						{
							method: 'POST',
							headers: { 'Content-Type': 'application/json' },
							signal: controller.signal,
							body: JSON.stringify({
								contents: [{ parts }],
								generationConfig: {
									responseModalities: ['TEXT', 'IMAGE'],
								}
							})
						}
					);
					if (response.ok) {
						console.log(`[Style] ✓ ${model}`);
						break;
					}
					console.warn(`[Style] ${model} → ${response.status}`);
					response = null;
				} catch (e) {
					if (e.name === 'AbortError') throw e;
					console.warn(`[Style] ${model} error: ${e.message}`);
					response = null;
				}
			}
		} finally {
			clearTimeout(timeout);
		}

		if (!response?.ok) {
			return json({ error: 'All models failed' }, { status: 500 });
		}

		const result = await response.json();

		let image = null;
		for (const part of result.candidates?.[0]?.content?.parts || []) {
			const d = part.inlineData?.data || part.inline_data?.data;
			if (d) { image = `data:image/png;base64,${d}`; break; }
		}

		if (!image) {
			return json({ error: 'No image generated' }, { status: 500 });
		}

		console.log(`[Style] ✓ Done "${characterName}"`);
		return json({ image });

	} catch (error) {
		console.error('[Style] Error:', error);
		if (error.name === 'AbortError') {
			return json({ error: 'Timed out after 5 minutes' }, { status: 504 });
		}
		return json({ error: error.message }, { status: 500 });
	}
}
