import { json } from '@sveltejs/kit';
import { approxJsonBytes, enforceRateLimit } from '$lib/server/security.js';
import { isDataUrl, isHttpUrl, isLocalUrl } from '$lib/server/validation.js';
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

		const { provider, modelUrl, preset } = await request.json();
		const safeProvider = provider === 'mixamo' ? 'mixamo' : 'meshy';
		const safeModelUrl = String(modelUrl || '').trim();
		const safePreset = String(preset || 'idle').trim().toLowerCase().slice(0, 80);
		const payload = { provider: safeProvider, modelUrl: safeModelUrl, preset: safePreset };
		payloadBytes = approxJsonBytes(payload);
		idempotencyKey = request.headers.get('Idempotency-Key')?.trim() || null;
		requestHash = makeRequestHash(payload);
		if (payloadBytes > 1 * 1024 * 1024) {
			return json({ error: 'Request payload too large' }, { status: 413 });
		}
		const rate = enforceRateLimit({
			uid: locals.user.uid,
			routeKey: '3d-animate',
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
				routeKey: '3d-animate',
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

		if (!safeModelUrl) {
			return json({ error: 'Model URL is required for animation.' }, { status: 400 });
		}
		if (!isLocalUrl(safeModelUrl) && !isHttpUrl(safeModelUrl)) {
			return json({ error: 'Model URL domain not allowed.' }, { status: 400 });
		}
		if (!safePreset) {
			return json({ error: 'Preset is required for animation.' }, { status: 400 });
		}

		const responseBody = {
			ok: true,
			stage: 'apply_animation',
			message: 'Animation foundation endpoint ready. Provider call not wired yet.',
			provider: safeProvider,
			preset: safePreset
		};
		if (idempotencyKey) {
			await completeIdempotentRequest({
				uid: locals.user.uid,
				routeKey: '3d-animate',
				idempotencyKey,
				requestHash,
				responseStatus: 200,
				responseBody
			});
		}
		await recordUsageEvent({
			uid: locals.user.uid,
			routeKey: '3d-animate',
			provider: 'placeholder',
			statusCode: 200,
			requestBytes: payloadBytes,
			metadata: { provider: safeProvider, preset: safePreset }
		});
		return json(responseBody);
	} catch (error) {
		if (idempotencyKey && requestHash && locals.user?.uid) {
			try {
				await failIdempotentRequest({
					uid: locals.user.uid,
					routeKey: '3d-animate',
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
				routeKey: '3d-animate',
				provider: 'placeholder',
				success: false,
				statusCode: 500,
				requestBytes: payloadBytes,
				metadata: { error: String(error.message || 'unknown').slice(0, 200) }
			});
		}
		return json({ error: error.message || 'Failed to process animation request.' }, { status: 500 });
	}
}
