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
			text: `PHASE 1 — LEARN THE ART STYLE (study OBSESSIVELY)

You are about to re-render a character in a very specific, extremely detailed art style. These ${styleImages.length} example sprites ARE the standard. Your output must be INDISTINGUISHABLE from them in quality, detail density, and rendering technique.

ZOOM IN AND STUDY:
- PIXEL DENSITY: Every single square pixel is deliberately placed. There are HUNDREDS of individually colored pixels per limb. This is NOT simple pixel art — it's HYPER-DETAILED pixel art, closer to a downscaled 3D render than typical 16-bit sprites
- TEXTURE WORK: Look at the fabric folds on robes — each fold has 5+ shading steps using individual pixels. Metal armor has specular pixel highlights. Skin has sub-surface scattering approximated through warm pixel tones. Hair/fur has individual strands rendered pixel by pixel
- DITHERING: Transitions between colors use organized dithering patterns — checkerboard, gradient, and scattered pixel placement. There are NO smooth gradients or soft blending anywhere
- LIGHTING: Dramatic directional light from upper-left. The light-to-shadow transition happens over just 3-5 pixels but creates convincing volume. Highlights are bright, almost white. Shadows are near-black. The contrast ratio is EXTREME
- OUTLINES: Dark pixel outlines (1-2px) define silhouette edges, but interior detail lines are softer/colored. The outline color shifts — warmer on lit sides, cooler in shadow
- MATERIAL DISTINCTION: You can TELL what material everything is made of just by the pixel technique: cloth drapes with soft dithered folds, metal gleams with hard specular dots, leather has subtle grain, bone/horn is smooth with hard light edges, magical effects use bright saturated pixels with scattered particle dots
- FACES: Even small faces have individually pixeled eyes, nose shadows, mouth lines, cheekbone highlights — every facial feature is READABLE at sprite size
- OVERALL IMPRESSION: These look like miniature oil paintings rendered in pixels. Rich, dense, lavish detail. Nothing is left empty or flat. Every surface has texture

Your output MUST match this EXACT quality level. If your output has smooth areas, flat colors, or missing texture detail — it is WRONG. Study these samples:`
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

WHAT CHANGES (ONLY the rendering — match the style samples EXACTLY):
- HYPER-DETAILED PIXEL ART — hundreds of individually placed pixels per body part
- Every surface MUST have texture: cloth has dithered folds, metal has specular pixel highlights, skin has warm tonal pixels, scales/fur rendered individually
- Dramatic upper-left lighting with EXTREME contrast — bright highlights to near-black shadows
- Organized dithering for ALL color transitions — NO smooth gradients, NO soft blending
- Dark pixel outlines (1-2px) on silhouette, softer colored lines for interior detail
- Saturated, bold, rich colors — deep blacks in shadows, punchy highlights
- Faces must have readable features — individual pixel eyes, nose shadow, mouth
- The overall look is a "miniature oil painting rendered in pixels" — dense, lavish, NOTHING flat or empty
- NO smooth digital painting, NO airbrushing, NO soft brushstrokes, NO flat areas
- If ANY part of your output looks "smooth" or "digitally painted" rather than made of VISIBLE INDIVIDUAL PIXELS — you have FAILED

QUALITY TEST: Place your output next to the style samples from Phase 1. They should look like they came from the SAME game, rendered by the SAME artist, at the SAME detail level. If yours looks simpler or smoother — regenerate with MORE detail.

IDENTITY TEST: Place your output next to the character reference. Someone should say "that's the SAME character, just in pixel art style." If they'd say "that's a DIFFERENT character" — you have failed.

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
- HYPER-DETAILED PIXEL ART at the SAME quality/density as the style samples
- Every body part textured with individually placed pixels — no flat or smooth areas
- Dramatic lighting with extreme contrast
- Dithered transitions, crisp outlines, readable face details
- Must be INSTANTLY RECOGNIZABLE as the same character from the reference images
- Must be VISUALLY INDISTINGUISHABLE in quality from the ${styleImages.length} style samples

DETAIL LEVEL REMINDER: Look at the style samples one more time. See how DENSE the pixel work is. Your output must be EQUALLY dense. If a wizard's robe in the style sample has 50+ individually shaded pixel folds, your character's equivalent surfaces need the SAME density. Do not simplify. Do not smooth. Every pixel matters.

Generate the image now.`
		});

		console.log(`[Style Transfer] Generating styled character "${characterName}" | size=${sizeLabel} ${charPx}px char in ${canvasPx}px canvas | pad=${padPct}% | ${styleImages.length} style refs`);

		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), 5 * 60 * 1000); // 5 min

		// Try multiple models for best quality — highest quality first
		const models = [
			'gemini-3-pro-image-preview',              // Best quality — Gemini 3 Pro
			'gemini-2.0-flash-exp-image-generation',   // Good quality — 2.0 Flash experimental
			'gemini-2.5-flash-image',                  // Fallback — basic flash
		];

		let response = null;

		try {
			for (const model of models) {
				console.log(`[Style Transfer] Trying model: ${model}`);
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
									temperature: 0.8,
								}
							})
						}
					);
					
					if (response.ok) {
						console.log(`[Style Transfer] ✓ Model ${model} responded OK`);
						break;
					}
					
					const errText = await response.text();
					console.warn(`[Style Transfer] Model ${model} failed (${response.status}): ${errText.slice(0, 200)}`);
					response = null;
				} catch (fetchErr) {
					if (fetchErr.name === 'AbortError') throw fetchErr;
					console.warn(`[Style Transfer] Model ${model} error: ${fetchErr.message}`);
					response = null;
				}
			}
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
