/**
 * POST /api/replace-file
 *
 * Replaces an existing file in Firebase Storage by overwriting it.
 * Used when updating files (e.g., background removal) to avoid creating duplicates.
 *
 * Body: { imageData: string, existingUrl: string }
 * Returns: { url: string, path: string }
 */
import { json } from '@sveltejs/kit';
import { uploadImageToFirebase, deleteImageFromFirebase } from '$lib/utils/firebaseStorage.js';
import { getStorage } from 'firebase-admin/storage';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { env } from '$env/dynamic/private';
import { approxJsonBytes, enforceRateLimit, isAllowedUpstreamUrl } from '$lib/server/security.js';
import { isDataUrl, isHttpUrl } from '$lib/server/validation.js';
import {
	beginIdempotentRequest,
	completeIdempotentRequest,
	failIdempotentRequest,
	makeRequestHash,
	recordUsageEvent
} from '$lib/server/requestTracking.js';

const ALLOWED_STORAGE_DOMAINS = [
	'storage.googleapis.com',
	'firebasestorage.googleapis.com',
	'firebasestorage.app'
];

function initFirebase() {
	if (getApps().length === 0) {
		const projectId = env.FIREBASE_PROJECT_ID;
		const clientEmail = env.FIREBASE_CLIENT_EMAIL;
		const privateKey = env.FIREBASE_PRIVATE_KEY;
		const storageBucket = env.FIREBASE_STORAGE_BUCKET;

		if (!projectId || !clientEmail || !privateKey) {
			throw new Error('Firebase credentials not configured');
		}

		initializeApp({
			credential: cert({
				projectId,
				clientEmail,
				privateKey: privateKey.replace(/\\n/g, '\n')
			}),
			storageBucket: storageBucket || `${projectId}.firebasestorage.app`
		});
	}

	return getStorage().bucket();
}

/**
 * Extract storage path from a Firebase Storage URL
 */
function extractStoragePath(url, bucketName) {
	try {
		// Handle both formats:
		// https://storage.googleapis.com/BUCKET_NAME/path/to/file.png
		// https://BUCKET_NAME.storage.googleapis.com/path/to/file.png
		const urlObj = new URL(url);
		let path = '';
		
		if (urlObj.hostname.includes('storage.googleapis.com')) {
			// Extract path after bucket name
			const parts = urlObj.pathname.split('/');
			const bucketIndex = parts.findIndex(p => p === bucketName || p.includes(bucketName));
			if (bucketIndex !== -1) {
				path = parts.slice(bucketIndex + 1).join('/');
			} else {
				// Fallback: use pathname directly (minus leading slash)
				path = urlObj.pathname.substring(1);
			}
		} else {
			// Fallback: try to extract from pathname
			path = urlObj.pathname.substring(1);
		}
		
		return path;
	} catch (error) {
		console.error('[replace-file] Failed to extract path from URL:', url, error);
		return null;
	}
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

		const { imageData, existingUrl } = await request.json();
		const payload = { imageData, existingUrl };
		payloadBytes = approxJsonBytes(payload);
		idempotencyKey = request.headers.get('Idempotency-Key')?.trim() || null;
		requestHash = makeRequestHash(payload);
		if (payloadBytes > 12 * 1024 * 1024) {
			return json({ error: 'Request payload too large' }, { status: 413 });
		}
		const rate = enforceRateLimit({
			uid: user.uid,
			routeKey: 'replace-file',
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
				routeKey: 'replace-file',
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

		if (!existingUrl) {
			return json({ error: 'existingUrl is required' }, { status: 400 });
		}
		if (!isHttpUrl(existingUrl) || !isAllowedUpstreamUrl(existingUrl, ALLOWED_STORAGE_DOMAINS)) {
			return json({ error: 'existingUrl must be a Firebase/Google Storage URL' }, { status: 400 });
		}

		const bucket = initFirebase();
		const bucketName = bucket.name;
		
		// Extract the storage path from the existing URL
		const storagePath = extractStoragePath(existingUrl, bucketName);
		
		if (!storagePath) {
			return json({ error: 'Could not extract storage path from existing URL' }, { status: 400 });
		}
		if (!storagePath.startsWith(`users/${user.uid}/`)) {
			return json({ error: 'You can only replace your own files' }, { status: 403 });
		}

		// Detect content type
		const detectContentType = (dataUrl) => {
			if (dataUrl && dataUrl.startsWith('data:')) {
				const match = dataUrl.match(/^data:([^;,]+)/);
				if (match && match[1]) return match[1];
			}
			return 'image/png';
		};

		const contentType = detectContentType(imageData);

		// Extract base64 from data URL if needed
		let base64Data = imageData;
		if (imageData.startsWith('data:')) {
			const base64Index = imageData.indexOf(',');
			if (base64Index !== -1) {
				base64Data = imageData.substring(base64Index + 1);
			}
		}

		// Convert base64 to buffer
		const buffer = Buffer.from(base64Data, 'base64');

		// Overwrite the existing file in Firebase Storage
		const file = bucket.file(storagePath);
		await file.save(buffer, {
			metadata: {
				contentType,
				cacheControl: 'public, max-age=3600'
			},
			public: true
		});

		// Make sure it's publicly accessible
		await file.makePublic();

		// Return the same URL (since we overwrote the file)
		const publicUrl = `https://storage.googleapis.com/${bucketName}/${storagePath}`;
		
		const responseBody = { url: publicUrl, path: storagePath };
		if (idempotencyKey) {
			await completeIdempotentRequest({
				uid: user.uid,
				routeKey: 'replace-file',
				idempotencyKey,
				requestHash,
				responseStatus: 200,
				responseBody
			});
		}
		await recordUsageEvent({
			uid: user.uid,
			routeKey: 'replace-file',
			provider: 'firebase',
			statusCode: 200,
			requestBytes: payloadBytes,
			metadata: { path: storagePath }
		});
		return json(responseBody);

	} catch (error) {
		console.error('[replace-file] Error:', error);
		if (idempotencyKey && requestHash && locals.user?.uid) {
			try {
				await failIdempotentRequest({
					uid: locals.user.uid,
					routeKey: 'replace-file',
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
				routeKey: 'replace-file',
				provider: 'firebase',
				success: false,
				statusCode: 500,
				requestBytes: payloadBytes,
				metadata: { error: String(error.message || 'unknown').slice(0, 200) }
			});
		}
		return json({ error: error.message || 'File replacement failed' }, { status: 500 });
	}
}
