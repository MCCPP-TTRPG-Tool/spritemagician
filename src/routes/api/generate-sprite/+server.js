import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { getMasterStyle } from '$lib/server/styleAnchor.js';
import { CHROMA_KEY_PROMPT_RULES } from '$lib/constants/chromaKey.js';

export async function POST({ request }) {
	try {
		const { prompt, referenceImage, useMasterStyleAnchor = false, generationNonce = null } = await request.json();

		if (!prompt && !referenceImage) {
			return json({ error: 'Prompt or reference image is required' }, { status: 400 });
		}

		if (!env.GEMINI_API_KEY) {
			return json({ error: 'Gemini API key not configured. Set GEMINI_API_KEY in .env' }, { status: 500 });
		}

		// Send prompt EXACTLY as provided - don't add extra instructions that confuse the model
		const finalPrompt = generationNonce
			? `${prompt}\n\nVariation nonce: ${generationNonce}`
			: prompt;

		let masterStyle = null;
		if (useMasterStyleAnchor) {
			masterStyle = await getMasterStyle();
			if (!masterStyle?.base64) {
				return json(
					{
						error: 'Style lock requested, but no master style anchor found. Upload one via /api/style-anchor.'
					},
					{ status: 500 }
				);
			}
		}

		console.log('[Sprite Generator] Creating sprite with Nano Banana (Gemini)...');
		console.log('[Sprite Generator] Prompt:', finalPrompt.substring(0, 100) + '...');
		console.log('[Sprite Generator] Reference image:', referenceImage ? 'provided' : 'none');
		console.log('[Sprite Generator] Style anchor lock:', useMasterStyleAnchor ? (masterStyle?.name || masterStyle?.source || 'enabled') : 'disabled');

		// Build the parts array:
		// 1) Style anchor (optional when style-lock is requested)
		// 2) Optional reference image if user provided one
		// 3) Prompt text
		const parts = [];

		if (useMasterStyleAnchor && masterStyle) {
			parts.push({
				text:
					'MASTER STYLE ANCHOR (MANDATORY): Match this exact rendering style, color language, texture treatment, and overall aesthetic.'
			});
			parts.push({
				inline_data: {
					mime_type: masterStyle.mimeType || 'image/png',
					data: masterStyle.base64
				}
			});
		}
		
		if (referenceImage) {
			// Add reference image instruction
			parts.push({
				text:
					'REFERENCE IMAGE (MANDATORY): Match this image as the primary visual target. Preserve composition intent, subject silhouette, material treatment, and painting texture. Do not drift into generic AI rendering.'
			});
			
			let mimeType = 'image/png';
			let base64Data;

			if (referenceImage.startsWith('http://') || referenceImage.startsWith('https://')) {
				// Fetch the image from URL and convert to base64
				const imgRes = await fetch(referenceImage);
				if (!imgRes.ok) throw new Error(`Failed to fetch reference image: ${imgRes.status}`);
				const buf = Buffer.from(await imgRes.arrayBuffer());
				mimeType = imgRes.headers.get('content-type') || 'image/png';
				base64Data = buf.toString('base64');
			} else if (referenceImage.startsWith('data:')) {
				const base64Index = referenceImage.indexOf(',');
				if (base64Index !== -1) {
					const header = referenceImage.substring(0, base64Index);
					const mimeMatch = header.match(/data:(.*?);/);
					if (mimeMatch) mimeType = mimeMatch[1];
					base64Data = referenceImage.substring(base64Index + 1);
				}
			} else {
				base64Data = referenceImage;
			}
			
			// Add the reference image
			parts.push({
				inline_data: {
					mime_type: mimeType,
					data: base64Data
				}
			});
		}
		
		// Add the prompt with explicit style-lock directive.
		parts.push({
			text:
				`${finalPrompt}\n\n` +
				(useMasterStyleAnchor
					? `STYLE LOCK REQUIREMENTS (MANDATORY):\n` +
					  `- Keep output in the same visual style as MASTER STYLE ANCHOR.\n` +
					  `- Preserve style consistency over subject changes.\n` +
					  `- Do not drift to photoreal or unrelated art styles.\n\n`
					: '') +
				`${CHROMA_KEY_PROMPT_RULES}`
		});

		// Use the same model as pose generator (gemini-2.5-flash-image)
		const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${env.GEMINI_API_KEY}`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				contents: [{
					parts: parts
				}],
				generationConfig: {
					responseModalities: ['TEXT', 'IMAGE'],
					imageConfig: {
						aspectRatio: '1:1'
					}
				}
			})
		});

		if (!response.ok) {
			const errorText = await response.text();
			console.error('[Sprite Generator] Gemini API error:', response.status, errorText);
			return json({ 
				error: `Gemini API error: ${response.status}`, 
				details: errorText 
			}, { status: 500 });
		}

		const result = await response.json();
		return processGeminiResult(result);

	} catch (error) {
		console.error('[Sprite Generator] Error:', error);
		return json({ error: error.message }, { status: 500 });
	}
}

function noCacheHeaders() {
	return {
		'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
		Pragma: 'no-cache',
		Expires: '0',
		'Surrogate-Control': 'no-store'
	};
}

function processGeminiResult(result) {
	let generatedImage = null;
	
	if (result.candidates && result.candidates[0] && result.candidates[0].content) {
		const parts = result.candidates[0].content.parts;
		for (const part of parts) {
			if (part.inlineData && part.inlineData.data) {
				generatedImage = `data:image/png;base64,${part.inlineData.data}`;
				break;
			} else if (part.inline_data && part.inline_data.data) {
				generatedImage = `data:image/png;base64,${part.inline_data.data}`;
				break;
			}
		}
	}

	if (!generatedImage) {
		console.error('[Sprite Generator] No image in response:', result);
		return json({ error: 'No image generated', details: JSON.stringify(result) }, { status: 500 });
	}

	console.log('[Sprite Generator] Successfully generated sprite with Nano Banana');
	return json({ image: generatedImage }, { headers: noCacheHeaders() });
}
