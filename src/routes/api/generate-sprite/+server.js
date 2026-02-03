import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

export async function POST({ request }) {
	try {
		const { prompt, referenceImage } = await request.json();

		if (!prompt && !referenceImage) {
			return json({ error: 'Prompt or reference image is required' }, { status: 400 });
		}

		if (!env.GEMINI_API_KEY) {
			return json({ error: 'Gemini API key not configured. Set GEMINI_API_KEY in .env' }, { status: 500 });
		}

		// Send prompt EXACTLY as provided - don't add extra instructions that confuse the model
		const finalPrompt = prompt;

		console.log('[Sprite Generator] Creating sprite with Nano Banana (Gemini)...');
		console.log('[Sprite Generator] Prompt:', finalPrompt.substring(0, 100) + '...');
		console.log('[Sprite Generator] Reference image:', referenceImage ? 'provided' : 'none');

		// Build the parts array - include reference image if provided
		const parts = [];
		
		if (referenceImage) {
			// Add reference image instruction
			parts.push({ text: 'REFERENCE IMAGE - Use this as the basis for generation:' });
			
			// Extract base64 from data URL
			let base64Data = referenceImage;
			if (referenceImage.startsWith('data:')) {
				const base64Index = referenceImage.indexOf(',');
				if (base64Index !== -1) {
					base64Data = referenceImage.substring(base64Index + 1);
				}
			}
			
			// Add the reference image
			parts.push({
				inline_data: {
					mime_type: 'image/png',
					data: base64Data
				}
			});
		}
		
		// Add the prompt EXACTLY as provided
		parts.push({ text: finalPrompt });

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
	return json({ image: generatedImage });
}
