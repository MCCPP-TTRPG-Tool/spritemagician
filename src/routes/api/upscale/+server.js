/**
 * Upscale images using Real-ESRGAN on Replicate
 */

import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { uploadImageToFirebase } from '$lib/utils/firebaseStorage.js';

// Real-ESRGAN for upscaling
const ESRGAN_VERSION = 'nightmareai/real-esrgan:f121d640bd286e1fdc67f9799164c1d5be36ff74576ee11c803ae5b665dd46aa';

export async function POST({ request }) {
	try {
		const { image, scale = 2 } = await request.json();

		if (!image) {
			return json({ error: 'Image is required' }, { status: 400 });
		}

		if (!env.REPLICATE_API_TOKEN) {
			return json({ error: 'Replicate API token not configured' }, { status: 500 });
		}

		// Upload image to Firebase for public URL
		let imageUrl;
		if (image.startsWith('data:')) {
			imageUrl = await uploadImageToFirebase(image, `upscale-input-${Date.now()}.png`);
		} else {
			imageUrl = image;
		}

		console.log('Upscaling image:', imageUrl);

		// Call Real-ESRGAN
		const response = await fetch('https://api.replicate.com/v1/predictions', {
			method: 'POST',
			headers: {
				'Authorization': `Token ${env.REPLICATE_API_TOKEN}`,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				version: ESRGAN_VERSION.split(':')[1],
				input: {
					image: imageUrl,
					scale: scale, // 2x or 4x
					face_enhance: false
				}
			})
		});

		if (!response.ok) {
			const errorText = await response.text();
			console.error('ESRGAN API error:', errorText);
			return json({ error: `Upscale API error: ${response.status}` }, { status: 500 });
		}

		const prediction = await response.json();

		// Poll for completion
		let result = prediction;
		let attempts = 0;
		const maxAttempts = 60;

		while ((result.status === 'starting' || result.status === 'processing') && attempts < maxAttempts) {
			await new Promise(resolve => setTimeout(resolve, 1000));
			
			const statusResponse = await fetch(`https://api.replicate.com/v1/predictions/${result.id}`, {
				headers: {
					'Authorization': `Token ${env.REPLICATE_API_TOKEN}`
				}
			});
			
			result = await statusResponse.json();
			attempts++;
		}

		if (result.status === 'failed') {
			return json({ error: result.error || 'Upscale failed' }, { status: 500 });
		}

		if (result.status !== 'succeeded') {
			return json({ error: 'Upscale timed out' }, { status: 500 });
		}

		const outputUrl = result.output;
		
		if (!outputUrl) {
			return json({ error: 'No upscaled image' }, { status: 500 });
		}

		return json({ image: outputUrl });

	} catch (error) {
		console.error('Upscale error:', error);
		return json({ error: error.message }, { status: 500 });
	}
}

