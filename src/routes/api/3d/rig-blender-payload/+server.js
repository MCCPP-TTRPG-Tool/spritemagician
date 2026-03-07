import { json } from '@sveltejs/kit';
import { getAdminDb } from '$lib/firebase/admin.js';
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

	const snap = await getAdminDb()
		.collection('users')
		.doc(locals.user.uid)
		.collection('rig_jobs')
		.doc(jobId)
		.get();
	if (!snap.exists) {
		return json({ error: 'Rig job not found' }, { status: 404 });
	}

	const data = snap.data() || {};
	if (!data.blenderPayload || typeof data.blenderPayload !== 'object') {
		return json({ error: 'Blender payload not available for this rig job' }, { status: 404 });
	}
	return json({
		jobId,
		payload: data.blenderPayload
	});
}
