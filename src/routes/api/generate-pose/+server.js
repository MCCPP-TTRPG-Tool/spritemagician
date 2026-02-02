/**
 * Pose Generation using Google Gemini (Nano Banana)
 * 
 * Takes a reference image and generates the same character in a new pose
 * Uses Gemini's multimodal capabilities for character consistency
 */

import { json } from '@sveltejs/kit';
import { GEMINI_API_KEY } from '$env/static/private';

export async function POST({ request }) {
	try {
		const { referenceImage, poseDescription } = await request.json();

		if (!referenceImage) {
			return json({ error: 'Reference image is required' }, { status: 400 });
		}

		if (!poseDescription) {
			return json({ error: 'Pose description is required' }, { status: 400 });
		}

		if (!GEMINI_API_KEY) {
			return json({ error: 'Gemini API key not configured. Set GEMINI_API_KEY in .env' }, { status: 500 });
		}

		// Extract base64 from data URL if needed
		let imageBase64 = referenceImage;
		if (referenceImage.startsWith('data:')) {
			// Extract base64 part
			const base64Index = referenceImage.indexOf(',');
			if (base64Index !== -1) {
				imageBase64 = referenceImage.substring(base64Index + 1);
			}
		} else {
			// If it's a URL, we'd need to download it first, but for now assume it's base64
			return json({ error: 'Reference image must be a base64 data URL' }, { status: 400 });
		}

		// Build the prompt for pose generation
		const prompt = `Generate this exact character in a new pose: ${poseDescription}

Requirements:
- 2D game sprite style
- Side view, facing right
- Maintain the exact same appearance, colors, clothing, and style as the reference
- Clean lines, game asset quality
- Centered, full body visible
- White background
- Character consistency is critical`;

		console.log('Generating pose with Gemini (Nano Banana):', poseDescription);

		// Call Gemini API
		const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${GEMINI_API_KEY}`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				contents: [{
					parts: [
						{ text: 'CHARACTER REFERENCE - Generate a new pose for this exact character:' },
						{
							inline_data: {
								mime_type: 'image/png',
								data: imageBase64
							}
						},
						{ text: prompt }
					]
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
			console.error('Gemini API error:', response.status, errorText);
			let errorDetails = errorText;
			try {
				const errorJson = JSON.parse(errorText);
				errorDetails = errorJson.error?.message || errorJson.message || errorText;
			} catch (e) {
				// Not JSON, use as-is
			}
			return json({ 
				error: `Gemini API error: ${response.status}`, 
				details: errorDetails 
			}, { status: 500 });
		}

		const result = await response.json();
		
		// Extract generated image from response
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
			console.error('No image in Gemini response:', result);
			return json({ error: 'No image generated. Gemini response: ' + JSON.stringify(result) }, { status: 500 });
		}

		console.log('Generated pose with Gemini');

		return json({ 
			image: generatedImage,
			pose: poseDescription
		});

	} catch (error) {
		console.error('Pose generation error:', error);
		return json({ error: error.message }, { status: 500 });
	}
}
