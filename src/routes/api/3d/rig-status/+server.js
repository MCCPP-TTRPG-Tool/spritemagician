import { json } from '@sveltejs/kit';
import { getAdminDb } from '$lib/firebase/admin.js';
import { enforceRateLimit } from '$lib/server/security.js';
import { recordUsageEvent } from '$lib/server/requestTracking.js';

export async function GET({ url, locals }) {
	try {
		if (!locals.user) {
			return json({ error: 'Authentication required' }, { status: 401 });
		}
		const rate = enforceRateLimit({
			uid: locals.user.uid,
			routeKey: '3d-rig-status',
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
		const responseBody = {
			jobId,
			status: String(data.status || 'queued'),
			progress: Number.isFinite(data.progress) ? data.progress : 0,
			message: data.message || null,
			provider: data.provider || 'internal',
			markerCount: Number(data.markerCount || 0),
			requiredMarkerCount: Number(data.requiredMarkerCount || 16),
			createdAt: data.createdAt || null,
			updatedAt: data.updatedAt || null
		};

		await recordUsageEvent({
			uid: locals.user.uid,
			routeKey: '3d-rig-status',
			provider: 'internal',
			statusCode: 200,
			requestBytes: 0,
			metadata: { jobId, status: responseBody.status }
		});

		return json(responseBody);
	} catch (error) {
		if (locals.user?.uid) {
			await recordUsageEvent({
				uid: locals.user.uid,
				routeKey: '3d-rig-status',
				provider: 'internal',
				success: false,
				statusCode: 500,
				requestBytes: 0,
				metadata: { error: String(error.message || 'unknown').slice(0, 200) }
			});
		}
		return json({ error: error.message || 'Failed to fetch rig status' }, { status: 500 });
	}
}
