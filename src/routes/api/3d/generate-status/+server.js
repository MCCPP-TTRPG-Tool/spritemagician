import { json } from '@sveltejs/kit';
import {
	extractFirstModelUrl,
	getRunpodJobStatus,
	normalizeRunpodStatus
} from '$lib/server/runpod.js';
import { enforceRateLimit } from '$lib/server/security.js';
import { hasRunpodJobOwnership, recordUsageEvent } from '$lib/server/requestTracking.js';

export async function GET({ url, locals }) {
	try {
		if (!locals.user) {
			return json({ error: 'Authentication required' }, { status: 401 });
		}
		const rate = enforceRateLimit({
			uid: locals.user.uid,
			routeKey: '3d-generate-status',
			maxRequests: 120,
			windowMs: 60_000
		});
		if (!rate.allowed) {
			return json(
				{ error: 'Rate limit exceeded. Please try again shortly.' },
				{ status: 429, headers: { 'Retry-After': String(rate.retryAfterSec) } }
			);
		}

		const runpodId = url.searchParams.get('runpodId')?.trim();
		if (!runpodId) {
			return json({ error: 'runpodId is required' }, { status: 400 });
		}
		if (!/^[a-zA-Z0-9_-]{6,128}$/.test(runpodId)) {
			return json({ error: 'Invalid runpodId format' }, { status: 400 });
		}
		const ownedByCaller = await hasRunpodJobOwnership({ uid: locals.user.uid, runpodId });
		if (!ownedByCaller) {
			return json({ error: 'Job not found' }, { status: 404 });
		}

		const data = await getRunpodJobStatus(runpodId);
		const normalized = normalizeRunpodStatus(data.status);
		const modelUrl = normalized === 'completed' ? extractFirstModelUrl(data.output) : null;
		const responseBody = {
			status: normalized,
			runpodStatus: data.status || null,
			delayTime: data.delayTime || null,
			executionTime: data.executionTime || null,
			modelUrl,
			error: data.error || null,
			raw: normalized === 'failed' ? data : undefined
		};
		await recordUsageEvent({
			uid: locals.user.uid,
			routeKey: '3d-generate-status',
			provider: 'runpod',
			statusCode: 200,
			requestBytes: 0,
			metadata: { runpodId, status: normalized }
		});
		return json(responseBody);
	} catch (error) {
		if (locals.user?.uid) {
			await recordUsageEvent({
				uid: locals.user.uid,
				routeKey: '3d-generate-status',
				provider: 'runpod',
				success: false,
				statusCode: 500,
				requestBytes: 0,
				metadata: { error: String(error.message || 'unknown').slice(0, 200) }
			});
		}
		return json({ error: error.message || 'Failed to fetch 3D generation status' }, { status: 500 });
	}
}
