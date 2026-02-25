/**
 * POST /api/upload-file
 *
 * Accepts base64 image data, uploads to Firebase Storage,
 * returns the public URL so the client can create a Firestore doc.
 *
 * Body: { imageData: string, filename?: string, folder?: string }
 * Returns: { url: string, path: string }
 */
import { json } from '@sveltejs/kit';
import { uploadImageToFirebase } from '$lib/utils/firebaseStorage.js';
import { approxJsonBytes, enforceRateLimit } from '$lib/server/security.js';
import { isDataUrl } from '$lib/server/validation.js';
import {
	beginIdempotentRequest,
	completeIdempotentRequest,
	failIdempotentRequest,
	makeRequestHash,
	recordUsageEvent
} from '$lib/server/requestTracking.js';

function sanitizeFileName(name) {
	const raw = String(name || '').trim();
	if (!raw) return `${Date.now()}-${Math.random().toString(36).substring(2, 8)}.png`;
	const cleaned = raw.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
	return cleaned || `${Date.now()}-${Math.random().toString(36).substring(2, 8)}.png`;
}

function sanitizeFolderId(folder) {
	const raw = String(folder || '').trim();
	if (!raw) return 'files';
	return /^[a-zA-Z0-9_-]{1,128}$/.test(raw) ? raw : 'files';
}

export async function POST({ request, locals }) {
	let payloadBytes = 0;
	let idempotencyKey = null;
	let requestHash = null;
	try {
		const user = locals.user;
		if (!user) {
			return json({ error: 'Not authenticated' }, { status: 401 });
		}

		const { imageData, filename, folder } = await request.json();
		const payload = { imageData, filename, folder };
		payloadBytes = approxJsonBytes(payload);
		idempotencyKey = request.headers.get('Idempotency-Key')?.trim() || null;
		requestHash = makeRequestHash(payload);
		if (payloadBytes > 12 * 1024 * 1024) {
			return json({ error: 'Request payload too large' }, { status: 413 });
		}
		const rate = enforceRateLimit({
			uid: user.uid,
			routeKey: 'upload-file',
			maxRequests: 40,
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
				uid: user.uid,
				routeKey: 'upload-file',
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
		if (typeof imageData !== 'string' || imageData.length > 12 * 1024 * 1024) {
			return json({ error: 'imageData must be a valid base64/data URL string' }, { status: 400 });
		}
		if (isDataUrl(imageData) && !imageData.startsWith('data:image/')) {
			return json({ error: 'Only image data URLs are supported' }, { status: 400 });
		}

		// Build a namespaced storage path
		const safeName = sanitizeFileName(filename);
		const safeFolder = sanitizeFolderId(folder);
		const storagePath = `users/${user.uid}/${safeFolder}/${safeName}`;

		const url = await uploadImageToFirebase(imageData, storagePath);
		const cacheBustedUrl = `${url}${url.includes('?') ? '&' : '?'}v=${Date.now()}`;
		const responseBody = { url: cacheBustedUrl, path: storagePath };
		if (idempotencyKey) {
			await completeIdempotentRequest({
				uid: user.uid,
				routeKey: 'upload-file',
				idempotencyKey,
				requestHash,
				responseStatus: 200,
				responseBody
			});
		}
		await recordUsageEvent({
			uid: user.uid,
			routeKey: 'upload-file',
			provider: 'firebase',
			statusCode: 200,
			requestBytes: payloadBytes,
			metadata: { folder: safeFolder, hasDataUrl: isDataUrl(imageData) }
		});

		return json(responseBody);
	} catch (error) {
		console.error('[upload-file] Error:', error);
		if (idempotencyKey && requestHash && locals.user?.uid) {
			try {
				await failIdempotentRequest({
					uid: locals.user.uid,
					routeKey: 'upload-file',
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
				routeKey: 'upload-file',
				provider: 'firebase',
				success: false,
				statusCode: 500,
				requestBytes: payloadBytes,
				metadata: { error: String(error.message || 'unknown').slice(0, 200) }
			});
		}
		return json({ error: error.message || 'Upload failed' }, { status: 500 });
	}
}
