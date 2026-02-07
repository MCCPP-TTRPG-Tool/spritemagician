/**
 * Style Transfer: Generate character in HoMM3 pixel art style
 * 
 * Takes a character sheet + loads style DNA images from static/Example images/
 * Outputs a single 3/4 idle pose facing right in the target art style
 */

import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import fs from 'fs';
import path from 'path';

// Cache style images in memory after first load
let cachedStyleImages = null;

function loadStyleImages() {
	if (cachedStyleImages) return cachedStyleImages;

	const styleDir = path.resolve('static/Example images');
	const files = fs.readdirSync(styleDir).filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f)).sort();

	cachedStyleImages = files.map(file => {
		const filePath = path.join(styleDir, file);
		const buffer = fs.readFileSync(filePath);
		const base64 = buffer.toString('base64');
		const ext = path.extname(file).toLowerCase();
		const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
		return { filename: file, base64, mime };
	});

	console.log(`[Style Transfer] Loaded ${cachedStyleImages.length} style DNA images from ${styleDir}`);
	return cachedStyleImages;
}

export async function POST({ request, locals }) {
	try {
		if (!locals.user) {
			return json({ error: 'Authentication required' }, { status: 401 });
		}

		const { referenceImage, characterSheet, characterName, spriteSize, characterPixels, canvasPixels, animationPadding } = await request.json();

		if (!characterSheet && !referenceImage) {
			return json({ error: 'At least one reference image is required' }, { status: 400 });
		}

		// Size & padding config
		const sizeLabel = spriteSize || 'medium';
		const charPx = characterPixels || 160;
		const canvasPx = canvasPixels || 224;
		const padPct = animationPadding || 20;
		// What % of the output image the character should fill
		const fillPct = Math.round((charPx / canvasPx) * 100);

		if (!env.GEMINI_API_KEY) {
			return json({ error: 'Gemini API key not configured' }, { status: 500 });
		}

		// Load style DNA images from static folder
		const styleImages = loadStyleImages();
		if (styleImages.length === 0) {
			return json({ error: 'No style reference images found in static/Example images/' }, { status: 500 });
		}

		// Extract base64 helpers
		function extractBase64(dataUrl) {
			if (!dataUrl) return null;
			if (dataUrl.startsWith('data:')) {
				const idx = dataUrl.indexOf(',');
				if (idx !== -1) return dataUrl.substring(idx + 1);
			}
			return dataUrl;
		}

		const refBase64 = extractBase64(referenceImage);
		const sheetBase64 = extractBase64(characterSheet);

		// ══════════════════════════════════════════════════════════════
		// PROMPT ARCHITECTURE (order is critical for Gemini attention):
		//
		//   1. Style DNA images FIRST — learn the rendering technique
		//   2. Anti-hallucination rules — read before seeing character
		//   3. Character references LAST — closest to instruction = strongest weight
		//   4. Character sheet REPEATED as final image — maximum recency
		//   5. Draw instruction — immediately after the character images
		//
		// This "sandwich" ensures the character identity dominates the output
		// while the style DNA sets the rendering technique early on.
		// ══════════════════════════════════════════════════════════════

		const parts = [];

		// ── PHASE 1: Learn the art style ──────────────────
		parts.push({
			text: `PHASE 1 — LEARN THE ART STYLE

You are about to re-render a character in a specific art style. First, study these ${styleImages.length} example sprites carefully. Every detail of their rendering technique is what you must replicate in your output.

Pay close attention to:
- How pixels are individually placed (this is PIXEL ART, not smooth digital painting)
- How dithering is used for color transitions
- How lighting comes from the upper-left with dramatic shadows
- How outlines are thin, dark, and crisp (1-2 pixels)
- How materials are rendered (metal = bright pixel highlights, fur = individual pixel strands, etc.)
- The saturated, bold color palette with deep blacks
- The overall "pre-rendered 3D miniature" aesthetic — volumetric, detailed, isometric game sprites

These are your ONLY reference for the rendering style:`
		});

		for (const img of styleImages) {
			parts.push({ text: `STYLE SAMPLE — ${img.filename}:` });
			parts.push({ inline_data: { mime_type: img.mime, data: img.base64 } });
		}

		// ── PHASE 2: Anti-hallucination rules ─────────────
		parts.push({
			text: `PHASE 2 — CRITICAL RULES (read before looking at the character)

═══════════════════════════════════════════════════
⚠️  ANTI-HALLUCINATION PROTOCOL  ⚠️
═══════════════════════════════════════════════════

You are a COPYING MACHINE that changes ONLY the rendering style.
You do NOT design characters. You do NOT choose species. You do NOT add or remove features.

The NEXT images you see are the CHARACTER you must re-render. Before drawing, you MUST:

CHECKLIST (complete mentally before generating):
□ What SPECIES is it? (human, boar, horse, spider, robot, etc.)
□ How many LEGS? Count them in the image.
□ How many ARMS / WINGS / HORNS / TAILS / HEADS? Count them.
□ What COLORS are its body, markings, armor, clothing?
□ What EQUIPMENT does it carry? Weapons? Shields? Saddle? Rider?
□ What is its BODY SHAPE? Stocky? Lean? Round? Serpentine? Humanoid?
□ Any UNIQUE FEATURES? Glowing parts? Spines? Tentacles? Extra eyes?

YOUR OUTPUT MUST MATCH EVERY SINGLE ANSWER ABOVE.

Examples of FAILURE:
- Reference shows a boar → you draw a dragon = FAIL
- Reference shows 4 legs → you draw 2 legs = FAIL  
- Reference shows red armor → you draw blue armor = FAIL
- Reference shows no wings → you add wings = FAIL

The name "${characterName || 'Character'}" is just a label. If the image shows a mechanical spider, draw a mechanical spider — even if the name says "Dragon Knight."

IMAGES ARE THE ONLY TRUTH. Now study the character:`
		});

		// ── PHASE 3: Character references (LAST = strongest attention) ──
		if (refBase64) {
			parts.push({ text: `CHARACTER — ORIGINAL SOURCE IMAGE (this is what the subject ACTUALLY looks like):` });
			parts.push({ inline_data: { mime_type: 'image/png', data: refBase64 } });
		}

		if (sheetBase64) {
			parts.push({ text: `CHARACTER — TURNAROUND SHEET (front, side, back views — study every angle):` });
			parts.push({ inline_data: { mime_type: 'image/png', data: sheetBase64 } });
		}

		// ── PHASE 4: Repeat character sheet as FINAL image ──
		// Gemini weights the last-seen image most heavily in generation
		if (sheetBase64) {
			parts.push({ text: `⚠️ FINAL LOOK — THIS IS THE CHARACTER YOU MUST DRAW. Study it one more time. Count every feature. Match every detail:` });
			parts.push({ inline_data: { mime_type: 'image/png', data: sheetBase64 } });
		} else if (refBase64) {
			parts.push({ text: `⚠️ FINAL LOOK — THIS IS THE CHARACTER YOU MUST DRAW. Study it one more time:` });
			parts.push({ inline_data: { mime_type: 'image/png', data: refBase64 } });
		}

		// ── PHASE 5: Draw instruction (immediately after character) ──
		parts.push({
			text: `═══════════════════════════════════════════════════
NOW DRAW — Re-render the character above in the pixel art style from Phase 1
═══════════════════════════════════════════════════

WHAT STAYS THE SAME (from the character images you just studied):
- Species, creature type, body plan — EXACTLY as shown
- Number of legs, arms, wings, tails, horns, heads — EXACTLY as counted
- Body shape, proportions, size ratios — EXACTLY as shown
- Color palette, markings, patterns — same hues, same placement  
- All equipment, armor, weapons, accessories — EXACTLY as shown
- Facial features, expression — EXACTLY as shown
- Every distinctive feature — if you can see it in the reference, it MUST be in your output

WHAT CHANGES (ONLY these):
- Rendering technique → match the ${styleImages.length} style samples from Phase 1
- Pixel art with visible individual pixels, dithering, crisp outlines
- Strong upper-left lighting with dramatic shadows
- Saturated, bold colors with deep blacks
- Pre-rendered 3D miniature aesthetic
- NO smooth digital painting, NO airbrushing, NO soft gradients

SIDE-BY-SIDE TEST: If your output was placed next to the character reference, someone should say "that's the SAME character, just rendered as pixel art." If they would say "that's a DIFFERENT character" — you have failed.

═══════════════════════════════════════════════════
SPRITE SIZE & FRAMING
═══════════════════════════════════════════════════
SIZE CLASS: ${sizeLabel.toUpperCase()} (${charPx}×${charPx} pixels)
- Character bounding box ≈ ${charPx}×${charPx} pixels
- Full canvas = ${canvasPx}×${canvasPx} pixels  
- Character CENTERED, filling ~${fillPct}% of the canvas
- Remaining space = animation padding (${padPct}%)
- Padding area = solid grey, no effects/ground/shadows

═══════════════════════════════════════════════════
OUTPUT SPEC
═══════════════════════════════════════════════════
- ONE image, ONE subject, full body visible
- 3/4 VIEW facing RIGHT (body angled ~45°, head/chest toward right)
- Idle stance — neutral, weight settled, all limbs visible and in natural position
- Solid grey background (#808080)
- PIXEL ART matching the style samples — visible pixels, dithering, NOT smooth/painted
- Must be INSTANTLY RECOGNIZABLE as the same character from the reference images

Generate the image now.`
		});

		console.log(`[Style Transfer] Generating styled character "${characterName}" | size=${sizeLabel} ${charPx}px char in ${canvasPx}px canvas | pad=${padPct}% | ${styleImages.length} style refs`);

		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), 5 * 60 * 1000); // 5 min

		let response;
		try {
			response = await fetch(
				`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${env.GEMINI_API_KEY}`,
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					signal: controller.signal,
					body: JSON.stringify({
						contents: [{ parts }],
						generationConfig: {
							responseModalities: ['TEXT', 'IMAGE'],
							imageConfig: {
								aspectRatio: '1:1'
							}
						}
					})
				}
			);
		} finally {
			clearTimeout(timeoutId);
		}

		if (!response.ok) {
			const errorText = await response.text();
			console.error('[Style Transfer] Gemini API error:', response.status, errorText);
			return json({ error: `Gemini API error: ${response.status}`, details: errorText }, { status: 500 });
		}

		const result = await response.json();

		// Extract generated image
		let generatedImage = null;
		if (result.candidates?.[0]?.content?.parts) {
			for (const part of result.candidates[0].content.parts) {
				const data = part.inlineData?.data || part.inline_data?.data;
				if (data) {
					generatedImage = `data:image/png;base64,${data}`;
					break;
				}
			}
		}

		if (!generatedImage) {
			console.error('[Style Transfer] No image in response:', JSON.stringify(result).slice(0, 500));
			return json({ error: 'No image generated', details: JSON.stringify(result) }, { status: 500 });
		}

		console.log(`[Style Transfer] ✓ Successfully generated styled character "${characterName}"`);
		return json({ image: generatedImage });

	} catch (error) {
		console.error('[Style Transfer] Error:', error);
		if (error.name === 'AbortError') {
			return json({ error: 'Style transfer timed out after 5 minutes. Please try again.' }, { status: 504 });
		}
		return json({ error: error.message }, { status: 500 });
	}
}
