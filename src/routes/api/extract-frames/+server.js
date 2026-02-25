/**
 * Server-side video frame extraction
 * Two modes:
 * 1. Quick mode: Return video as data URL for client-side extraction
 * 2. Direct mode: Extract frames server-side (for large videos or CORS issues)
 */

import { json } from '@sveltejs/kit';
import { approxJsonBytes, enforceRateLimit, isAllowedUpstreamUrl } from '$lib/server/security.js';
import { isHttpUrl, normalizeBoundedInt } from '$lib/server/validation.js';
import {
	beginIdempotentRequest,
	completeIdempotentRequest,
	failIdempotentRequest,
	makeRequestHash,
	recordUsageEvent
} from '$lib/server/requestTracking.js';

// Maximum video size for base64 mode (10MB)
const MAX_BASE64_SIZE = 10 * 1024 * 1024;
const ALLOWED_DOMAINS = [
	'firebasestorage.googleapis.com',
	'storage.googleapis.com',
	'replicate.delivery',
	'pbxt.replicate.delivery',
	'runpod.net',
	'runpod.io',
	'runpodusercontent.com',
	'firebasestorage.app'
];

export async function POST({ request, locals }) {
	let payloadBytes = 0;
	let idempotencyKey = null;
	let requestHash = null;
	try {
		if (!locals.user) {
			return json({ error: 'Authentication required' }, { status: 401 });
		}

		const { videoUrl, numFrames = 8, mode = 'auto' } = await request.json();
		const safeNumFrames = normalizeBoundedInt(numFrames, 8, 1, 120);
		const safeMode = mode === 'auto' || mode === 'quick' || mode === 'direct' ? mode : 'auto';
		const payload = { videoUrl, numFrames: safeNumFrames, mode: safeMode };
		payloadBytes = approxJsonBytes(payload);
		idempotencyKey = request.headers.get('Idempotency-Key')?.trim() || null;
		requestHash = makeRequestHash(payload);
		if (payloadBytes > 1024 * 1024) {
			return json({ error: 'Request payload too large' }, { status: 413 });
		}
		const rate = enforceRateLimit({
			uid: locals.user.uid,
			routeKey: 'extract-frames',
			maxRequests: 30,
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
				routeKey: 'extract-frames',
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
		
		if (!videoUrl) {
			return json({ error: 'videoUrl required' }, { status: 400 });
		}
		if (!isHttpUrl(videoUrl)) {
			return json({ error: 'videoUrl must be an http(s) URL' }, { status: 400 });
		}

		if (!isAllowedUpstreamUrl(videoUrl, ALLOWED_DOMAINS)) {
			return json({ error: 'Domain not allowed' }, { status: 403 });
		}
		
		console.log(`[extract-frames] Fetching video: ${videoUrl.substring(0, 80)}...`);
		
		// Fetch video
		const response = await fetch(videoUrl);
		if (!response.ok) {
			throw new Error(`Failed to fetch video: ${response.status}`);
		}
		
		const contentType = response.headers.get('content-type');
		const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
		console.log(`[extract-frames] Content-Type: ${contentType}, Size: ${(contentLength / 1024 / 1024).toFixed(2)} MB`);
		
		// Get video as buffer
		const buffer = await response.arrayBuffer();
		const actualSize = buffer.byteLength;
		
		console.log(`[extract-frames] Actual size: ${(actualSize / 1024 / 1024).toFixed(2)} MB`);
		
		// If video/image is small enough, return as data URL
		if (actualSize <= MAX_BASE64_SIZE) {
			const mime = contentType || 'video/mp4';
			const base64 = Buffer.from(buffer).toString('base64');
			const dataUrl = `data:${mime};base64,${base64}`;
			
			const responseBody = {
				videoDataUrl: dataUrl,
				contentType: mime,
				size: actualSize,
				message: 'Media fetched - extract frames client-side'
			};
			if (idempotencyKey) {
				await completeIdempotentRequest({
					uid: locals.user.uid,
					routeKey: 'extract-frames',
					idempotencyKey,
					requestHash,
					responseStatus: 200,
					responseBody
				});
			}
			await recordUsageEvent({
				uid: locals.user.uid,
				routeKey: 'extract-frames',
				provider: 'internal',
				statusCode: 200,
				requestBytes: payloadBytes,
				metadata: { mode: safeMode, numFrames: safeNumFrames, size: actualSize }
			});
			return json(responseBody);
		}
		
		// For large videos, we can't easily send the full video
		// Instead, return an error with guidance
		console.warn(`[extract-frames] Video too large for base64 (${(actualSize / 1024 / 1024).toFixed(2)} MB)`);
		
		const tooLargeBody = { 
			error: 'Video too large for server-side processing',
			size: actualSize,
			suggestion: 'Try a shorter duration or lower quality'
		};
		if (idempotencyKey) {
			await completeIdempotentRequest({
				uid: locals.user.uid,
				routeKey: 'extract-frames',
				idempotencyKey,
				requestHash,
				responseStatus: 413,
				responseBody: tooLargeBody
			});
		}
		await recordUsageEvent({
			uid: locals.user.uid,
			routeKey: 'extract-frames',
			provider: 'internal',
			success: false,
			statusCode: 413,
			requestBytes: payloadBytes,
			metadata: { mode: safeMode, numFrames: safeNumFrames, size: actualSize, reason: 'too-large' }
		});
		return json(tooLargeBody, { status: 413 });
		
	} catch (error) {
		console.error('[extract-frames] Error:', error);
		if (idempotencyKey && requestHash && locals.user?.uid) {
			try {
				await failIdempotentRequest({
					uid: locals.user.uid,
					routeKey: 'extract-frames',
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
				routeKey: 'extract-frames',
				provider: 'internal',
				success: false,
				statusCode: 500,
				requestBytes: payloadBytes,
				metadata: { error: String(error.message || 'unknown').slice(0, 200) }
			});
		}
		return json({ error: error.message }, { status: 500 });
	}
}
