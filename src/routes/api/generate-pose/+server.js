/**
 * Pose Generation using IP-Adapter on Replicate
 * 
 * Takes a reference image and generates the same character in a new pose
 * Uses IP-Adapter for character consistency
 */

import { json } from '@sveltejs/kit';
import { REPLICATE_API_TOKEN } from '$env/static/private';
import { uploadImageToFirebase } from '$lib/utils/firebaseStorage.js';

// IP-Adapter SDXL for character-consistent generation
const IP_ADAPTER_VERSION = 'lucataco/ip_adapter-sdxl:06db9db4f0f4d9d160f54e251c53bfbd84e57c55fe7c32ee55701aea57a4f927';

export async function POST({ request }) {
	try {
		const { referenceImage, poseDescription } = await request.json();

		if (!referenceImage) {
			return json({ error: 'Reference image is required' }, { status: 400 });
		}

		if (!poseDescription) {
			return json({ error: 'Pose description is required' }, { status: 400 });
		}

		if (!REPLICATE_API_TOKEN) {
			return json({ error: 'Replicate API token not configured' }, { status: 500 });
		}

		// Upload reference image to Firebase for public URL
		let imageUrl;
		if (referenceImage.startsWith('data:')) {
			imageUrl = await uploadImageToFirebase(referenceImage, `pose-ref-${Date.now()}.png`);
		} else {
			imageUrl = referenceImage;
		}

		console.log('Reference image URL:', imageUrl);

		// Build the prompt for pose generation
		const prompt = `2D game sprite, side view, facing right, ${poseDescription}, clean lines, game asset, centered, full body, white background`;
		const negativePrompt = 'blurry, low quality, distorted, multiple characters, cropped, cut off';

		console.log('Generating pose with IP-Adapter:', prompt);

		// Call IP-Adapter on Replicate
		const response = await fetch('https://api.replicate.com/v1/predictions', {
			method: 'POST',
			headers: {
				'Authorization': `Token ${REPLICATE_API_TOKEN}`,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				version: IP_ADAPTER_VERSION.split(':')[1],
				input: {
					image: imageUrl,
					prompt: prompt,
					negative_prompt: negativePrompt,
					num_outputs: 1,
					guidance_scale: 7.5,
					num_inference_steps: 30,
					ip_adapter_scale: 0.8 // High value = more faithful to reference
				}
			})
		});

		if (!response.ok) {
			const errorText = await response.text();
			console.error('IP-Adapter API error:', errorText);
			return json({ error: `Replicate API error: ${response.status}` }, { status: 500 });
		}

		const prediction = await response.json();
		console.log('Prediction started:', prediction.id);

		// Poll for completion
		let result = prediction;
		let attempts = 0;
		const maxAttempts = 60; // 1 minute timeout

		while ((result.status === 'starting' || result.status === 'processing') && attempts < maxAttempts) {
			await new Promise(resolve => setTimeout(resolve, 1000));
			
			const statusResponse = await fetch(`https://api.replicate.com/v1/predictions/${result.id}`, {
				headers: {
					'Authorization': `Token ${REPLICATE_API_TOKEN}`
				}
			});
			
			result = await statusResponse.json();
			attempts++;
			console.log(`Poll ${attempts}: ${result.status}`);
		}

		if (result.status === 'failed') {
			console.error('IP-Adapter failed:', result.error);
			return json({ error: result.error || 'Generation failed' }, { status: 500 });
		}

		if (result.status !== 'succeeded') {
			return json({ error: 'Generation timed out' }, { status: 500 });
		}

		// Get the output image URL
		const outputUrl = Array.isArray(result.output) ? result.output[0] : result.output;
		
		if (!outputUrl) {
			return json({ error: 'No image generated' }, { status: 500 });
		}

		console.log('Generated pose:', outputUrl);

		return json({ 
			image: outputUrl,
			pose: poseDescription
		});

	} catch (error) {
		console.error('Pose generation error:', error);
		return json({ error: error.message }, { status: 500 });
	}
}
