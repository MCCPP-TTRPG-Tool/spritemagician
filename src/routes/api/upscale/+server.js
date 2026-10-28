/**
 * Upscale images using Real-ESRGAN on Replicate
 */

import { json } from '@sveltejs/kit';
import { env } from '$lib/server/env.js';
import { waitForPrediction, toReplicateInput } from '$lib/server/replicate.js';
import { approxJsonBytes, enforceRateLimit } from '$lib/server/security.js';
import { isImageInput, normalizeBoundedInt } from '$lib/server/validation.js';
import {
	beginIdempotentRequest,
	completeIdempotentRequest,
	failIdempotentRequest,
	makeRequestHash,
	recordUsageEvent
} from '$lib/server/requestTracking.js';

// Real-ESRGAN for upscaling
const ESRGAN_VERSION = 'nightmareai/real-esrgan:f121d640bd286e1fdc67f9799164c1d5be36ff74576ee11c803ae5b665dd46aa';

export async function POST({ request, locals }) {
	let payloadBytes = 0;
	let idempotencyKey = null;
	let requestHash = null;
	try {
		if (!locals.user) {
			return json({ error: 'Authentication required' }, { status: 401 });
		}

		const { image, scale = 2 } = await request.json();
		const safeScale = normalizeBoundedInt(scale, 2, 2, 4);
		const payload = { image, scale: safeScale };
		payloadBytes = approxJsonBytes(payload);
		idempotencyKey = request.headers.get('Idempotency-Key')?.trim() || null;
		requestHash = makeRequestHash(payload);
		if (payloadBytes > 6 * 1024 * 1024) {
			return json({ error: 'Request payload too large' }, { status: 413 });
		}
		const rate = enforceRateLimit({
			uid: locals.user.uid,
			routeKey: 'upscale',
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
				routeKey: 'upscale',
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

		if (!image) {
			return json({ error: 'Image is required' }, { status: 400 });
		}
		if (!isImageInput(image)) {
			return json({ error: 'image must be a data URL or http(s) URL' }, { status: 400 });
		}

		if (!env.REPLICATE_API_TOKEN) {
			return json({ error: 'Replicate is not configured. Add your REPLICATE_API_TOKEN in Settings.', code: 'MISSING_KEY', key: 'REPLICATE_API_TOKEN' }, { status: 412 });
		}

		const imageUrl = await toReplicateInput(image);

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
					scale: safeScale, // 2x or 4x
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

		let result;
		try {
			result = await waitForPrediction(prediction, { intervalMs: 1000, maxMs: 180_000 });
		} catch (err) {
			return json({ error: err.message || 'Upscale failed' }, { status: 500 });
		}

		const outputUrl = result.output;
		
		if (!outputUrl) {
			return json({ error: 'No upscaled image' }, { status: 500 });
		}

		const responseBody = { image: outputUrl };
		if (idempotencyKey) {
			await completeIdempotentRequest({
				uid: locals.user.uid,
				routeKey: 'upscale',
				idempotencyKey,
				requestHash,
				responseStatus: 200,
				responseBody
			});
		}
		await recordUsageEvent({
			uid: locals.user.uid,
			routeKey: 'upscale',
			provider: 'replicate',
			statusCode: 200,
			requestBytes: payloadBytes,
			metadata: { scale: safeScale }
		});
		return json(responseBody);

	} catch (error) {
		console.error('Upscale error:', error);
		if (idempotencyKey && requestHash && locals.user?.uid) {
			try {
				await failIdempotentRequest({
					uid: locals.user.uid,
					routeKey: 'upscale',
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
				routeKey: 'upscale',
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

