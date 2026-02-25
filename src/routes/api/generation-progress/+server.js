import { json } from '@sveltejs/kit';
import { getProgress, isProgressOwner } from '$lib/utils/generationProgress.js';
import { enforceRateLimit } from '$lib/server/security.js';
import { recordUsageEvent } from '$lib/server/requestTracking.js';

/**
 * Get generation progress
 */
export async function GET({ url, locals }) {
	if (!locals.user) {
		return json({ error: 'Authentication required' }, { status: 401 });
	}
	const rate = enforceRateLimit({
		uid: locals.user.uid,
		routeKey: 'generation-progress',
		maxRequests: 120,
		windowMs: 60_000
	});
	if (!rate.allowed) {
		return json(
			{ error: 'Rate limit exceeded. Please try again shortly.' },
			{ status: 429, headers: { 'Retry-After': String(rate.retryAfterSec) } }
		);
	}

	const jobId = url.searchParams.get('jobId')?.trim();
	if (!jobId) {
		return json({ error: 'jobId required' }, { status: 400 });
	}
	if (!/^[a-zA-Z0-9_-]{6,128}$/.test(jobId)) {
		return json({ error: 'Invalid jobId format' }, { status: 400 });
	}
	if (!isProgressOwner(jobId, locals.user.uid)) {
		return json({ error: 'Job not found' }, { status: 404 });
	}

	const progress = getProgress(jobId);
	if (!progress) {
		return json({ error: 'Job not found' }, { status: 404 });
	}
	await recordUsageEvent({
		uid: locals.user.uid,
		routeKey: 'generation-progress',
		provider: 'internal',
		statusCode: 200,
		requestBytes: 0,
		metadata: { jobId, status: progress.status || 'unknown' }
	});

	return json(progress);
}

