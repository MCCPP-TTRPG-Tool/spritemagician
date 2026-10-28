import { json } from '@sveltejs/kit';
import * as db from '$lib/server/db.js';
import { enforceRateLimit } from '$lib/server/security.js';

export async function GET({ url, locals }) {
	if (!locals.user) {
		return json({ error: 'Authentication required' }, { status: 401 });
	}
	const rate = enforceRateLimit({
		uid: locals.user.uid,
		routeKey: '3d-rig-blender-payload',
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
	if (!jobId || !/^[a-zA-Z0-9_-]{6,128}$/.test(jobId)) {
		return json({ error: 'Valid jobId is required' }, { status: 400 });
	}

	const data = db.getDoc('rig_jobs', jobId);
	if (!data) {
		return json({ error: 'Rig job not found' }, { status: 404 });
	}


	if (!data.blenderPayload || typeof data.blenderPayload !== 'object') {
		return json({ error: 'Blender payload not available for this rig job' }, { status: 404 });
	}
	return json({
		jobId,
		payload: data.blenderPayload
	});
}
