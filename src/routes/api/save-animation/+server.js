/**
 * POST /api/save-animation
 *
 * Dedicated endpoint for saving animation files (.anim.json) to Firebase Storage.
 * Unlike /api/upload-file, this accepts the raw animation JSON directly,
 * avoiding the double-base64 encoding overhead (which can double payload size).
 *
 * Also uploads the first frame as a thumbnail image so the file tree can display it.
 *
 * Body: { name: string, frames: string[], fps: number, prompt?: string }
 * Returns: { url: string, path: string, frameCount: number, thumbnailUrl: string }
 */
import { json } from '@sveltejs/kit';
import { getAdminStorage } from '$lib/firebase/admin.js';
import { approxJsonBytes, enforceRateLimit } from '$lib/server/security.js';
import { normalizeBoundedInt, validateImageArray } from '$lib/server/validation.js';
import {
	beginIdempotentRequest,
	completeIdempotentRequest,
	failIdempotentRequest,
	makeRequestHash,
	recordUsageEvent
} from '$lib/server/requestTracking.js';

/** Extract raw bytes + content type from a data-URL string */
function parseDataUrl(dataUrl) {
	const match = dataUrl.match(/^data:([^;,]+);base64,(.+)$/s);
	if (!match) return null;
	return { mime: match[1], buffer: Buffer.from(match[2], 'base64') };
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

		const body = await request.json();
		const { name, frames, fps, prompt } = body;
		const payload = { name, frames, fps, prompt };
		payloadBytes = approxJsonBytes(payload);
		idempotencyKey = request.headers.get('Idempotency-Key')?.trim() || null;
		requestHash = makeRequestHash(payload);
		if (payloadBytes > 25 * 1024 * 1024) {
			return json({ error: 'Request payload too large' }, { status: 413 });
		}
		const rate = enforceRateLimit({
			uid: user.uid,
			routeKey: 'save-animation',
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
				uid: user.uid,
				routeKey: 'save-animation',
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

		const framesValidation = validateImageArray(frames, {
			minItems: 1,
			maxItems: 240,
			maxItemChars: 2_000_000
		});
		if (!framesValidation.ok) {
			return json({ error: framesValidation.error }, { status: 400 });
		}
		const safeFps = normalizeBoundedInt(fps, 12, 1, 60);

		const bucket = getAdminStorage();
		const safeName = (name || 'animation').slice(0, 40).replace(/[^a-zA-Z0-9_-]/g, '_');
		const ts = Date.now();

		// ── 1. Upload first frame as thumbnail ──────────────────
		let thumbnailUrl = '';
		const firstFrame = frames[0];
		if (firstFrame) {
			const parsed = parseDataUrl(firstFrame);
			if (parsed) {
				const ext = parsed.mime === 'image/webp' ? 'webp' : 'png';
				const thumbPath = `users/${user.uid}/animations/${safeName}_${ts}_thumb.${ext}`;
				const thumbFile = bucket.file(thumbPath);
				await thumbFile.save(parsed.buffer, {
					metadata: { contentType: parsed.mime, cacheControl: 'public, max-age=31536000' },
					public: true
				});
				await thumbFile.makePublic();
				thumbnailUrl = `https://storage.googleapis.com/${bucket.name}/${thumbPath}`;
			}
		}

		// ── 2. Build and upload the animation JSON ──────────────
		const animData = {
			type: 'animation',
			name: name || 'animation',
			frames,
			fps: safeFps,
			frameCount: frames.length,
			prompt: prompt || '',
			thumbnailUrl,
			createdAt: new Date().toISOString()
		};

		const jsonString = JSON.stringify(animData);
		const buffer = Buffer.from(jsonString, 'utf-8');

		const fname = `${safeName}_${ts}.anim.json`;
		const storagePath = `users/${user.uid}/animations/${fname}`;
		const file = bucket.file(storagePath);

		await file.save(buffer, {
			metadata: {
				contentType: 'application/json',
				cacheControl: 'public, max-age=3600'
			},
			public: true
		});
		await file.makePublic();

		const publicUrl = `https://storage.googleapis.com/${bucket.name}/${storagePath}`;
		console.log(`[save-animation] Saved ${fname}: ${frames.length} frames, ${(buffer.length / 1024).toFixed(1)} KB, thumb=${!!thumbnailUrl}`);

		const responseBody = { url: publicUrl, path: storagePath, frameCount: frames.length, thumbnailUrl };
		if (idempotencyKey) {
			await completeIdempotentRequest({
				uid: user.uid,
				routeKey: 'save-animation',
				idempotencyKey,
				requestHash,
				responseStatus: 200,
				responseBody
			});
		}
		await recordUsageEvent({
			uid: user.uid,
			routeKey: 'save-animation',
			provider: 'firebase',
			statusCode: 200,
			requestBytes: payloadBytes,
			metadata: { frameCount: frames.length, fps: safeFps }
		});
		return json(responseBody);
	} catch (error) {
		console.error('[save-animation] Error:', error);
		if (idempotencyKey && requestHash && locals.user?.uid) {
			try {
				await failIdempotentRequest({
					uid: locals.user.uid,
					routeKey: 'save-animation',
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
				routeKey: 'save-animation',
				provider: 'firebase',
				success: false,
				statusCode: 500,
				requestBytes: payloadBytes,
				metadata: { error: String(error.message || 'unknown').slice(0, 200) }
			});
		}
		return json({ error: error.message || 'Save failed' }, { status: 500 });
	}
}
