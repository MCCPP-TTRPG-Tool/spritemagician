/**
 * Background removal API
 * Uses rembg model on Replicate to remove backgrounds from images
 */

import { json } from '@sveltejs/kit';
import { REPLICATE_API_TOKEN } from '$env/static/private';
import { uploadImageToFirebase } from '$lib/utils/firebaseStorage.js';

// rembg model for background removal
const REMBG_VERSION = 'cjwbw/rembg:fb8af171cfa1616ddcf1242c093f9c46bcada5ad4cf6f2fbe8b81b330ec5c003';

/**
 * Remove background from a single image
 */
async function removeBackground(imageUrl) {
	const response = await fetch('https://api.replicate.com/v1/predictions', {
		method: 'POST',
		headers: {
			'Authorization': `Token ${REPLICATE_API_TOKEN}`,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({
			version: REMBG_VERSION.split(':')[1],
			input: {
				image: imageUrl
			}
		})
	});

	if (!response.ok) {
		const error = await response.text();
		throw new Error(`rembg API error: ${error}`);
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
				'Authorization': `Token ${REPLICATE_API_TOKEN}`
			}
		});
		
		result = await statusResponse.json();
		attempts++;
	}

	if (result.status === 'failed') {
		throw new Error(result.error || 'Background removal failed');
	}

	if (result.status !== 'succeeded') {
		throw new Error('Background removal timed out');
	}

	return result.output;
}

/**
 * POST - Remove background from one or more images
 * Body: { images: [base64 or URL, ...] }
 * Returns: { images: [transparent PNG URL, ...] }
 */
export async function POST({ request }) {
	try {
		const { images } = await request.json();

		if (!images || !Array.isArray(images) || images.length === 0) {
			return json({ error: 'Images array is required' }, { status: 400 });
		}

		if (!REPLICATE_API_TOKEN) {
			return json({ error: 'Replicate API token not configured' }, { status: 500 });
		}

		// Process images in parallel for speed
		const processImage = async (image, index) => {
			let imageUrl = image;
			
			// If base64, upload to Firebase first
			if (imageUrl.startsWith('data:')) {
				imageUrl = await uploadImageToFirebase(imageUrl, `rembg-input-${Date.now()}-${index}.png`);
			}

			try {
				const transparentUrl = await removeBackground(imageUrl);
				return transparentUrl;
			} catch (error) {
				console.error(`Failed to remove background from image ${index}:`, error);
				return null; // Mark as failed
			}
		};

		// Process all images in parallel
		const results = await Promise.all(images.map((img, i) => processImage(img, i)));

		return json({ images: results });

	} catch (error) {
		console.error('Background removal API error:', error);
		return json({ error: error.message }, { status: 500 });
	}
}

