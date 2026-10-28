/**
 * Proxy endpoint to fetch images and return as base64
 * Bypasses CORS issues with Firebase Storage
 *
 * Domain allowlist prevents SSRF — only trusted origins are fetched.
 */

import { json } from '@sveltejs/kit';
import { approxJsonBytes, enforceRateLimit } from '$lib/server/security.js';
import { isHttpUrl } from '$lib/server/validation.js';
import { isLocalUrl, fetchLocalOrRemote } from '$lib/server/localFiles.js';
import {
	beginIdempotentRequest,
	completeIdempotentRequest,
	failIdempotentRequest,
	makeRequestHash,
	recordUsageEvent
} from '$lib/server/requestTracking.js';


export async function POST({ request, locals }) {
	let payloadBytes = 0;
	let idempotencyKey = null;
	let requestHash = null;
	try {
		if (!locals.user) {
			return json({ error: 'Authentication required' }, { status: 401 });
		}

		const { url } = await request.json();
		const payload = { url };
		payloadBytes = approxJsonBytes(payload);
		idempotencyKey = request.headers.get('Idempotency-Key')?.trim() || null;
		requestHash = makeRequestHash(payload);
		if (payloadBytes > 512 * 1024) {
			return json({ error: 'Request payload too large' }, { status: 413 });
		}
		const rate = enforceRateLimit({
			uid: locals.user.uid,
			routeKey: 'proxy-image',
			maxRequests: 60,
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
				routeKey: 'proxy-image',
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

		if (!url) {
			return json({ error: 'URL required' }, { status: 400 });
		}
		if (!isLocalUrl(url) && !isHttpUrl(url)) {
			return json({ error: 'url must be an http(s) URL' }, { status: 400 });
		}


		// Fetch the image
		const response = await fetchLocalOrRemote(url);
		
		if (!response.ok) {
			return json({ error: `Failed to fetch image: ${response.status}` }, { status: 500 });
		}

		const contentType = response.headers.get('content-type') || 'image/png';
		const arrayBuffer = await response.arrayBuffer();
		const base64 = Buffer.from(arrayBuffer).toString('base64');
		const dataUrl = `data:${contentType};base64,${base64}`;

		const responseBody = { dataUrl };
		if (idempotencyKey) {
			await completeIdempotentRequest({
				uid: locals.user.uid,
				routeKey: 'proxy-image',
				idempotencyKey,
				requestHash,
				responseStatus: 200,
				responseBody
			});
		}
		await recordUsageEvent({
			uid: locals.user.uid,
			routeKey: 'proxy-image',
			provider: 'internal',
			statusCode: 200,
			requestBytes: payloadBytes,
			metadata: { contentType, responseBytes: arrayBuffer.byteLength }
		});
		return json(responseBody);
	} catch (error) {
		console.error('Proxy image error:', error);
		if (idempotencyKey && requestHash && locals.user?.uid) {
			try {
				await failIdempotentRequest({
					uid: locals.user.uid,
					routeKey: 'proxy-image',
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
				routeKey: 'proxy-image',
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
