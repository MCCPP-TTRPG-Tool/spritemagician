import { json } from '@sveltejs/kit';
import { approxJsonBytes, enforceRateLimit, isAllowedUpstreamUrl } from '$lib/server/security.js';
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

		const { inputType, prompt, referenceImageUrl } = await request.json();
		const safeInputType = inputType === 'text' ? 'text' : 'image';
		const safePrompt = String(prompt || '').trim().slice(0, 4000);
		const safeReferenceImageUrl = String(referenceImageUrl || '').trim();
		const payload = {
			inputType: safeInputType,
			prompt: safePrompt,
			referenceImageUrl: safeReferenceImageUrl
		};
		payloadBytes = approxJsonBytes(payload);
		idempotencyKey = request.headers.get('Idempotency-Key')?.trim() || null;
		requestHash = makeRequestHash(payload);
		if (payloadBytes > 2 * 1024 * 1024) {
			return json({ error: 'Request payload too large' }, { status: 413 });
		}
		const rate = enforceRateLimit({
			uid: locals.user.uid,
			routeKey: '3d-generate',
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
				routeKey: '3d-generate',
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

		if (!safePrompt && !safeReferenceImageUrl) {
			return json({ error: 'Provide a prompt or reference image URL.' }, { status: 400 });
		}
		if (safeReferenceImageUrl && !isAllowedUpstreamUrl(safeReferenceImageUrl)) {
			return json({ error: 'Reference image URL domain not allowed.' }, { status: 400 });
		}

		const responseBody = {
			ok: true,
			stage: 'generate_model',
			message:
				'3D generation is intentionally local-first right now. Upload a model to proceed into marker rigging.',
			inputType: safeInputType,
			mode: 'local_first'
		};
		if (idempotencyKey) {
			await completeIdempotentRequest({
				uid: locals.user.uid,
				routeKey: '3d-generate',
				idempotencyKey,
				requestHash,
				responseStatus: 200,
				responseBody
			});
		}
		await recordUsageEvent({
			uid: locals.user.uid,
			routeKey: '3d-generate',
			provider: 'internal',
			statusCode: 200,
			requestBytes: payloadBytes,
			metadata: { inputType: safeInputType, hasReferenceUrl: !!safeReferenceImageUrl }
		});
		return json(responseBody);
	} catch (error) {
		if (idempotencyKey && requestHash && locals.user?.uid) {
			try {
				await failIdempotentRequest({
					uid: locals.user.uid,
					routeKey: '3d-generate',
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
				routeKey: '3d-generate',
				provider: 'internal',
				success: false,
				statusCode: 500,
				requestBytes: payloadBytes,
				metadata: { error: String(error.message || 'unknown').slice(0, 200) }
			});
		}
		return json({ error: error.message || 'Failed to process 3D generation request.' }, { status: 500 });
	}
}
