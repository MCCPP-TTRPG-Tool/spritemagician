/**
 * Background removal API
 * Uses rembg model on Replicate to remove backgrounds from images
 */

import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { uploadImageToFirebase } from '$lib/utils/firebaseStorage.js';
import { approxJsonBytes, enforceRateLimit } from '$lib/server/security.js';
import { validateImageArray } from '$lib/server/validation.js';
import {
	beginIdempotentRequest,
	completeIdempotentRequest,
	failIdempotentRequest,
	makeRequestHash,
	recordUsageEvent
} from '$lib/server/requestTracking.js';

// rembg model for background removal
const REMBG_VERSION = 'cjwbw/rembg:fb8af171cfa1616ddcf1242c093f9c46bcada5ad4cf6f2fbe8b81b330ec5c003';

/**
 * Remove background from a single image using rembg (free on Replicate)
 */
async function removeBackground(imageUrl) {
	const response = await fetch('https://api.replicate.com/v1/predictions', {
		method: 'POST',
		headers: {
			'Authorization': `Token ${env.REPLICATE_API_TOKEN}`,
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
				'Authorization': `Token ${env.REPLICATE_API_TOKEN}`
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
 * 
 * Uses rembg model on Replicate (free)
 */
export async function POST({ request, locals }) {
	let payloadBytes = 0;
	let idempotencyKey = null;
	let requestHash = null;
	try {
		if (!locals.user) {
			return json({ error: 'Authentication required' }, { status: 401 });
		}

		const { images } = await request.json();
		const payload = { images };
		payloadBytes = approxJsonBytes(payload);
		idempotencyKey = request.headers.get('Idempotency-Key')?.trim() || null;
		requestHash = makeRequestHash(payload);
		if (payloadBytes > 10 * 1024 * 1024) {
			return json({ error: 'Request payload too large' }, { status: 413 });
		}
		const rate = enforceRateLimit({
			uid: locals.user.uid,
			routeKey: 'remove-background',
			maxRequests: 20,
			windowMs: 60_000
		});
		if (!rate.allowed) {
			return json(
				{ error: 'Rate limit exceeded. Please try again shortly.' },
				{ status: 429, headers: { 'Retry-After': String(rate.retryAfterSec) } }
			);
		}
		if (idempotencyKey) {
			const idempotency = await beginIdempotentRequest({
				uid: locals.user.uid,
				routeKey: 'remove-background',
				idempotencyKey,
				requestHash
			});
			if (idempotency.status === 'replay') {
				return json(idempotency.responseBody, { status: idempotency.responseStatus });
			}
			if (idempotency.status === 'processing') {
				return json(
					{ error: 'A request with this Idempotency-Key is already processing.' },
					{ status: 409 }
				);
			}
			if (idempotency.status === 'conflict') {
				return json(
					{ error: 'Idempotency-Key already used with different payload.' },
					{ status: 409 }
				);
			}
		}

		const validation = validateImageArray(images, { minItems: 1, maxItems: 24, maxItemChars: 2_000_000 });
		if (!validation.ok) {
			return json({ error: validation.error }, { status: 400 });
		}

		if (!env.REPLICATE_API_TOKEN) {
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
				console.error(`[remove-background] Failed to remove background from image ${index}:`, error);
				return null; // Mark as failed
			}
		};

		// Process all images in parallel
		const results = await Promise.all(images.map((img, i) => processImage(img, i)));

		const responseBody = { images: results };
		if (idempotencyKey) {
			await completeIdempotentRequest({
				uid: locals.user.uid,
				routeKey: 'remove-background',
				idempotencyKey,
				requestHash,
				responseStatus: 200,
				responseBody
			});
		}
		await recordUsageEvent({
			uid: locals.user.uid,
			routeKey: 'remove-background',
			provider: 'replicate',
			statusCode: 200,
			requestBytes: payloadBytes,
			metadata: { imageCount: images.length }
		});
		return json(responseBody);

	} catch (error) {
		console.error('Background removal API error:', error);
		if (idempotencyKey && requestHash && locals.user?.uid) {
			try {
				await failIdempotentRequest({
					uid: locals.user.uid,
					routeKey: 'remove-background',
					idempotencyKey,
					requestHash,
					errorMessage: error.message
				});
			} catch {
				// best effort
			}
		}
		if (locals.user?.uid) {
			await recordUsageEvent({
				uid: locals.user.uid,
				routeKey: 'remove-background',
				provider: 'replicate',
				success: false,
				statusCode: 500,
				requestBytes: payloadBytes,
				metadata: { error: String(error.message || 'unknown').slice(0, 200) }
			});
		}
		return json({ error: error.message }, { status: 500 });
	}
}

