import { json } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import { getAdminStorage } from '$lib/firebase/admin.js';
import { approxJsonBytes, enforceRateLimit } from '$lib/server/security.js';
import {
	beginIdempotentRequest,
	completeIdempotentRequest,
	failIdempotentRequest,
	makeRequestHash,
	recordUsageEvent
} from '$lib/server/requestTracking.js';

const MAX_BYTES = 30 * 1024 * 1024;
const MIME_BY_EXT = {
	glb: 'model/gltf-binary',
	gltf: 'model/gltf+json',
	fbx: 'application/octet-stream',
	obj: 'text/plain'
};

function sanitizeFileName(name) {
	const raw = String(name || '').trim();
	if (!raw) return '';
	const cleaned = raw.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
	return cleaned;
}

function parseModelDataUrl(dataUrl) {
	if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) return null;
	const m = dataUrl.match(/^data:([^;,]+);base64,(.+)$/s);
	if (!m) return null;
	return { mimeType: m[1], base64: m[2] };
}

function allowedModelExt(name) {
	const ext = String(name || '').toLowerCase().split('.').pop() || '';
	return ['glb', 'gltf', 'fbx', 'obj'].includes(ext) ? ext : '';
}

export async function POST({ request, locals }) {
	let payloadBytes = 0;
	let idempotencyKey = null;
	let requestHash = null;
	try {
		if (!locals.user) {
			return json({ error: 'Authentication required' }, { status: 401 });
		}

		const { modelData, filename, folder = 'files' } = await request.json();
		const safeFilename = sanitizeFileName(filename);
		const ext = allowedModelExt(safeFilename);
		const payload = { modelData, filename: safeFilename, folder };
		payloadBytes = approxJsonBytes(payload);
		idempotencyKey = request.headers.get('Idempotency-Key')?.trim() || null;
		requestHash = makeRequestHash(payload);

		if (payloadBytes > MAX_BYTES * 1.5) {
			return json({ error: 'Request payload too large' }, { status: 413 });
		}
		const rate = enforceRateLimit({
			uid: locals.user.uid,
			routeKey: 'upload-3d-model',
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
			const idem = await beginIdempotentRequest({
				uid: locals.user.uid,
				routeKey: 'upload-3d-model',
				idempotencyKey,
				requestHash
			});
			if (idem.status === 'replay') {
				return json(idem.responseBody, { status: idem.responseStatus });
			}
			if (idem.status === 'processing') {
				return json(
					{ error: 'A request with this Idempotency-Key is already processing.' },
					{ status: 409 }
				);
			}
			if (idem.status === 'conflict') {
				return json(
					{ error: 'Idempotency-Key already used with different payload.' },
					{ status: 409 }
				);
			}
		}

		if (!safeFilename || !ext) {
			return json({ error: 'filename is required (.glb/.gltf/.fbx/.obj)' }, { status: 400 });
		}
		const parsed = parseModelDataUrl(modelData);
		if (!parsed?.base64) {
			return json({ error: 'modelData must be a base64 data URL' }, { status: 400 });
		}
		const bytes = Buffer.byteLength(parsed.base64, 'base64');
		if (bytes <= 0 || bytes > MAX_BYTES) {
			return json({ error: `Model size must be <= ${MAX_BYTES / (1024 * 1024)}MB` }, { status: 400 });
		}

		const bucket = getAdminStorage();
		const token = randomUUID();
		const folderSanitized = String(folder || 'files').replace(/[^a-zA-Z0-9/_-]/g, '_');
		const objectPath = `users/${locals.user.uid}/${folderSanitized}/${Date.now()}_${safeFilename}`;
		const file = bucket.file(objectPath);
		const contentType = MIME_BY_EXT[ext] || parsed.mimeType || 'application/octet-stream';
		await file.save(Buffer.from(parsed.base64, 'base64'), {
			metadata: {
				contentType,
				metadata: { firebaseStorageDownloadTokens: token },
				cacheControl: 'public, max-age=3600'
			}
		});

		const encodedPath = encodeURIComponent(objectPath);
		const url = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodedPath}?alt=media&token=${token}`;
		const responseBody = { url, path: objectPath, size: bytes };

		if (idempotencyKey) {
			await completeIdempotentRequest({
				uid: locals.user.uid,
				routeKey: 'upload-3d-model',
				idempotencyKey,
				requestHash,
				responseStatus: 200,
				responseBody
			});
		}
		await recordUsageEvent({
			uid: locals.user.uid,
			routeKey: 'upload-3d-model',
			provider: 'firebase',
			statusCode: 200,
			requestBytes: payloadBytes,
			metadata: { ext, size: bytes }
		});
		return json(responseBody);
	} catch (error) {
		if (idempotencyKey && requestHash && locals.user?.uid) {
			try {
				await failIdempotentRequest({
					uid: locals.user.uid,
					routeKey: 'upload-3d-model',
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
				routeKey: 'upload-3d-model',
				provider: 'firebase',
				success: false,
				statusCode: 500,
				requestBytes: payloadBytes,
				metadata: { error: String(error.message || 'unknown').slice(0, 200) }
			});
		}
		return json({ error: error.message || '3D model upload failed' }, { status: 500 });
	}
}
