/**
 * Pose Generation using Google Gemini (Nano Banana)
 * 
 * Takes a reference image and generates the same character in a new pose
 * Uses Gemini's multimodal capabilities for character consistency
 */

import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

export async function POST({ request }) {
	try {
		const { referenceImage, poseDescription } = await request.json();

		if (!referenceImage) {
			return json({ error: 'Reference image is required' }, { status: 400 });
		}

		if (!poseDescription) {
			return json({ error: 'Pose description is required' }, { status: 400 });
		}

		if (!env.GEMINI_API_KEY) {
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

		// Build the prompt for pose generation - balance between consistency and actual pose change
		const prompt = `TASK: Draw this SAME character in a COMPLETELY DIFFERENT pose.

⚠️ THE POSE MUST CHANGE DRAMATICALLY ⚠️
New pose required: ${poseDescription}

WHAT MUST CHANGE (the pose):
- Body position and stance must be COMPLETELY DIFFERENT from reference
- Arms, legs, wings, tail positions must change to match: "${poseDescription}"
- The character should be DOING something different
- Movement, gesture, and body language must reflect the new pose

WHAT MUST STAY THE SAME (the character):
- Same creature/character design
- Same colors and patterns
- Same art style and quality
- Same number of limbs/appendages/features
- Same proportions and details

OUTPUT REQUIREMENTS:
- Side view, facing right
- Full body visible and centered
- Plain white or transparent background
- 2D game sprite quality

IMPORTANT: If the new pose looks identical to the reference, you have FAILED. The pose "${poseDescription}" should be OBVIOUSLY DIFFERENT from the standing/idle reference pose. Show action, movement, or a distinct body position.`;

		console.log('Generating pose with Gemini (Nano Banana):', poseDescription);

		// Call Gemini API
		const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${env.GEMINI_API_KEY}`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				contents: [{
					parts: [
						{ text: 'REFERENCE CHARACTER IMAGE - Study every detail of this character:' },
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

		console.log('Generated pose with Gemini, removing background...');

		// Remove background for transparent pose using Replicate rembg
		let finalImage = generatedImage;
		
		if (env.REPLICATE_API_TOKEN) {
			try {
				const bgRemovalResponse = await fetch('https://api.replicate.com/v1/predictions', {
					method: 'POST',
					headers: {
						'Authorization': `Bearer ${env.REPLICATE_API_TOKEN}`,
						'Content-Type': 'application/json'
					},
					body: JSON.stringify({
						version: 'fb8af171cfa1616ddcf1242c093f9c46bcada5ad4cf6f2fbe8b81b330ec5c003',
						input: { 
							image: generatedImage,
							alpha_matting: true,
							alpha_matting_foreground_threshold: 240,
							alpha_matting_background_threshold: 10
						}
					})
				});

				if (!bgRemovalResponse.ok) {
					const errorText = await bgRemovalResponse.text();
					console.error('BG removal API error:', bgRemovalResponse.status, errorText);
				} else {
					const prediction = await bgRemovalResponse.json();
					console.log('BG removal started, polling for result...');
					
					// Poll for completion
					const maxAttempts = 60; // 60 seconds max
					for (let i = 0; i < maxAttempts; i++) {
						await new Promise(resolve => setTimeout(resolve, 1000));
						
						const statusResponse = await fetch(prediction.urls.get, {
							headers: { 'Authorization': `Bearer ${env.REPLICATE_API_TOKEN}` }
						});
						
						if (statusResponse.ok) {
							const status = await statusResponse.json();
							console.log(`BG removal status (${i+1}/${maxAttempts}):`, status.status);
							
							if (status.status === 'succeeded' && status.output) {
								// Download the result and convert to base64
								const imageResponse = await fetch(status.output);
								if (imageResponse.ok) {
									const imageBuffer = await imageResponse.arrayBuffer();
									const base64 = Buffer.from(imageBuffer).toString('base64');
									finalImage = `data:image/png;base64,${base64}`;
									console.log('✓ Background removed successfully');
								} else {
									console.error('Failed to download BG-removed image');
								}
								break;
							} else if (status.status === 'failed') {
								console.error('Background removal failed:', status.error);
								break;
							}
						}
					}
				}
			} catch (bgError) {
				console.error('Background removal error:', bgError.message);
			}
		} else {
			console.warn('env.REPLICATE_API_TOKEN not set, skipping background removal');
		}

		return json({ 
			image: finalImage,
			pose: poseDescription
		});

	} catch (error) {
		console.error('Pose generation error:', error);
		return json({ error: error.message }, { status: 500 });
	}
}
