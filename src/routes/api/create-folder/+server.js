/**
 * POST /api/create-folder
 * 
 * Creates a folder in Firestore using server-side auth (session cookie).
 * This bypasses the need for client-side Firebase auth to be signed in.
 * 
 * Body: { name: string, parentId?: string | null, metadata?: object }
 * Returns: { id: string, name: string }
 */
import { json } from '@sveltejs/kit';
import { getAdminDb } from '$lib/firebase/admin.js';
import { CHROMA_KEY_HEX } from '$lib/constants/chromaKey.js';
import { approxJsonBytes, enforceRateLimit } from '$lib/server/security.js';
import {
	beginIdempotentRequest,
	completeIdempotentRequest,
	failIdempotentRequest,
	makeRequestHash,
	recordUsageEvent
} from '$lib/server/requestTracking.js';

function normalizeId(value) {
	if (value === null || value === undefined) return null;
	const trimmed = String(value).trim();
	if (!trimmed) return null;
	return /^[a-zA-Z0-9_-]{1,128}$/.test(trimmed) ? trimmed : null;
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

		const { name, parentId, metadata } = await request.json();
		const payload = { name, parentId, metadata };
		payloadBytes = approxJsonBytes(payload);
		idempotencyKey = request.headers.get('Idempotency-Key')?.trim() || null;
		requestHash = makeRequestHash(payload);
		if (payloadBytes > 1024 * 1024) {
			return json({ error: 'Request payload too large' }, { status: 413 });
		}
		const rate = enforceRateLimit({
			uid: user.uid,
			routeKey: 'create-folder',
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
				uid: user.uid,
				routeKey: 'create-folder',
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

		if (!name || typeof name !== 'string' || !name.trim()) {
			return json({ error: 'Folder name is required' }, { status: 400 });
		}
		const normalizedParentId = normalizeId(parentId);
		if (parentId && !normalizedParentId) {
			return json({ error: 'parentId format is invalid' }, { status: 400 });
		}
		const safeName = name.trim().slice(0, 120);

		const incomingMetadata =
			metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {};
		const tags = Array.isArray(incomingMetadata.tags)
			? incomingMetadata.tags
				.map((t) => String(t || '').trim())
				.filter(Boolean)
				.slice(0, 10)
			: [];
		const folderMetadata = {
			assetType: String(incomingMetadata.assetType || '').trim().slice(0, 40),
			notes: String(incomingMetadata.notes || '').trim().slice(0, 1000),
			tags,
			source: String(incomingMetadata.source || '').trim().slice(0, 40),
			chromaKeyHex:
				typeof incomingMetadata.chromaKeyHex === 'string' &&
				/^#[0-9A-Fa-f]{6}$/.test(incomingMetadata.chromaKeyHex)
					? incomingMetadata.chromaKeyHex.toUpperCase()
					: CHROMA_KEY_HEX
		};

		const db = getAdminDb();
		const folderRef = db.collection('users').doc(user.uid).collection('files').doc();

		await folderRef.set({
			name: safeName,
			parentId: normalizedParentId || null,
			isFolder: true,
			url: null,
			thumbnailUrl: null,
			fileType: null,
			metadata: folderMetadata,
			size: null,
			createdAt: new Date(),
			updatedAt: new Date()
		});

		const responseBody = {
			id: folderRef.id,
			name: safeName,
			metadata: folderMetadata
		};
		if (idempotencyKey) {
			await completeIdempotentRequest({
				uid: user.uid,
				routeKey: 'create-folder',
				idempotencyKey,
				requestHash,
				responseStatus: 200,
				responseBody
			});
		}
		await recordUsageEvent({
			uid: user.uid,
			routeKey: 'create-folder',
			provider: 'firestore',
			statusCode: 200,
			requestBytes: payloadBytes,
			metadata: { parentId: normalizedParentId || null }
		});
		return json(responseBody);
	} catch (error) {
		console.error('[create-folder] Error:', error);
		if (idempotencyKey && requestHash && locals.user?.uid) {
			try {
				await failIdempotentRequest({
					uid: locals.user.uid,
					routeKey: 'create-folder',
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
				routeKey: 'create-folder',
				provider: 'firestore',
				success: false,
				statusCode: 500,
				requestBytes: payloadBytes,
				metadata: { error: String(error.message || 'unknown').slice(0, 200) }
			});
		}
		return json({ error: error.message || 'Failed to create folder' }, { status: 500 });
	}
}
