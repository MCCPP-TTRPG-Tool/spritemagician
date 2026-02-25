/**
 * Style Anchor API
 *
 * GET  → Returns current master style metadata (source, name, preview URL)
 * PUT  → Uploads a new master style image (base64 body)
 *
 * The master style image is attached to every generation request
 * to lock the output aesthetic to the HoMM3 pixel-art style.
 */

import { json } from '@sveltejs/kit';
import { getStyleConfig, setMasterStyle, clearStyleCache } from '$lib/server/styleAnchor.js';
import { approxJsonBytes, enforceRateLimit } from '$lib/server/security.js';
import {
	beginIdempotentRequest,
	completeIdempotentRequest,
	failIdempotentRequest,
	makeRequestHash,
	recordUsageEvent
} from '$lib/server/requestTracking.js';

/**
 * GET /api/style-anchor
 * Returns metadata about the current master style (no image bytes).
 */
export async function GET({ locals }) {
	if (!locals.user) {
		return json({ error: 'Authentication required' }, { status: 401 });
	}
	const rate = enforceRateLimit({
		uid: locals.user.uid,
		routeKey: 'style-anchor:get',
		maxRequests: 60,
		windowMs: 60_000
	});
	if (!rate.allowed) {
		return json(
			{ error: 'Rate limit exceeded. Please try again shortly.' },
			{ status: 429, headers: { 'Retry-After': String(rate.retryAfterSec) } }
		);
	}

	const config = await getStyleConfig();
	await recordUsageEvent({
		uid: locals.user.uid,
		routeKey: 'style-anchor:get',
		provider: 'firebase',
		statusCode: 200,
		requestBytes: 0
	});
	return json({ styleAnchor: config });
}

/**
 * PUT /api/style-anchor
 * Upload a new master style image.
 *
 * Body: { imageData: "data:image/png;base64,…" | "raw-base64", mimeType?: "image/png" }
 */
export async function PUT({ request, locals }) {
	if (!locals.user) {
		return json({ error: 'Authentication required' }, { status: 401 });
	}

	let payloadBytes = 0;
	let idempotencyKey = null;
	let requestHash = null;
	try {
		const { imageData, mimeType } = await request.json();
		const payload = {
			imageData,
			mimeType: String(mimeType || '').trim().toLowerCase()
		};
		payloadBytes = approxJsonBytes(payload);
		idempotencyKey = request.headers.get('Idempotency-Key')?.trim() || null;
		requestHash = makeRequestHash(payload);
		if (payloadBytes > 10 * 1024 * 1024) {
			return json({ error: 'Request payload too large' }, { status: 413 });
		}
		const rate = enforceRateLimit({
			uid: locals.user.uid,
			routeKey: 'style-anchor:put',
			maxRequests: 10,
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
				routeKey: 'style-anchor:put',
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
		if (!imageData) {
			return json({ error: 'imageData is required' }, { status: 400 });
		}
		if (typeof imageData !== 'string') {
			return json({ error: 'imageData must be a string' }, { status: 400 });
		}

		// Strip data-URL prefix if present
		let base64 = imageData;
		if (base64.startsWith('data:')) {
			const idx = base64.indexOf(',');
			base64 = idx !== -1 ? base64.substring(idx + 1) : base64;
		}
		if (!/^[A-Za-z0-9+/=\r\n]+$/.test(base64) || base64.length < 100) {
			return json({ error: 'imageData must be valid base64 image data' }, { status: 400 });
		}

		// Detect mime from data-URL or use provided value
		let resolvedMime = mimeType || 'image/png';
		if (imageData.startsWith('data:')) {
			const match = imageData.match(/^data:([^;,]+)/);
			if (match) resolvedMime = match[1];
		}
		resolvedMime = String(resolvedMime || 'image/png').toLowerCase();
		if (!['image/png', 'image/jpeg', 'image/webp'].includes(resolvedMime)) {
			return json({ error: 'Unsupported mimeType' }, { status: 400 });
		}

		const result = await setMasterStyle(base64, resolvedMime, locals.user.uid);
		const responseBody = {
			ok: true,
			publicUrl: result.publicUrl,
			storagePath: result.storagePath,
		};
		if (idempotencyKey) {
			await completeIdempotentRequest({
				uid: locals.user.uid,
				routeKey: 'style-anchor:put',
				idempotencyKey,
				requestHash,
				responseStatus: 200,
				responseBody
			});
		}
		await recordUsageEvent({
			uid: locals.user.uid,
			routeKey: 'style-anchor:put',
			provider: 'firebase',
			statusCode: 200,
			requestBytes: payloadBytes,
			metadata: { mimeType: resolvedMime }
		});
		return json(responseBody);

	} catch (error) {
		console.error('[StyleAnchor] PUT error:', error);
		if (idempotencyKey && requestHash && locals.user?.uid) {
			try {
				await failIdempotentRequest({
					uid: locals.user.uid,
					routeKey: 'style-anchor:put',
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
				routeKey: 'style-anchor:put',
				provider: 'firebase',
				success: false,
				statusCode: 500,
				requestBytes: payloadBytes,
				metadata: { error: String(error.message || 'unknown').slice(0, 200) }
			});
		}
		return json({ error: error.message }, { status: 500 });
	}
}

/**
 * DELETE /api/style-anchor
 * Clears the style cache (forces reload on next generation).
 */
export async function DELETE({ locals }) {
	if (!locals.user) {
		return json({ error: 'Authentication required' }, { status: 401 });
	}
	const rate = enforceRateLimit({
		uid: locals.user.uid,
		routeKey: 'style-anchor:delete',
		maxRequests: 20,
		windowMs: 60_000
	});
	if (!rate.allowed) {
		return json(
			{ error: 'Rate limit exceeded. Please try again shortly.' },
			{ status: 429, headers: { 'Retry-After': String(rate.retryAfterSec) } }
		);
	}

	clearStyleCache();
	await recordUsageEvent({
		uid: locals.user.uid,
		routeKey: 'style-anchor:delete',
		provider: 'firebase',
		statusCode: 200,
		requestBytes: 0
	});
	return json({ ok: true, message: 'Style cache cleared' });
}
