/**
 * Job log + edit cluster persistence (was Firestore `jobs` / `edit_clusters`).
 *
 * GET  /api/jobs                       → { jobs } newest first
 * POST /api/jobs { action, ... }
 */
import { json } from '@sveltejs/kit';
import * as db from '$lib/server/db.js';

const JOBS = 'jobs';
const CLUSTERS = 'edit_clusters';
const CLUSTER_JOBS = 'edit_cluster_jobs';

export async function GET() {
	const jobs = db.listDocs(JOBS).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
	return json({ jobs });
}

export async function POST({ request }) {
	let body;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400 });
	}
	const action = String(body?.action || '');
	try {
		switch (action) {
			case 'upsert': {
				if (!body.jobId) return json({ error: 'jobId required' }, { status: 400 });
				return json({ job: db.setDoc(JOBS, String(body.jobId), { jobId: body.jobId, ...(body.payload || {}) }, { merge: true }) });
			}
			case 'delete':
				return json({ ok: db.deleteDoc(JOBS, String(body.jobId)) });
			case 'clearFinished':
				return json({ removed: db.deleteWhere(JOBS, (j) => ['completed', 'failed', 'cancelled'].includes(j.status)) });
			case 'saveEditCluster': {
				const { clusterId, job } = body;
				if (!clusterId || !job?.id) return json({ error: 'clusterId and job.id required' }, { status: 400 });
				db.setDoc(CLUSTERS, String(clusterId), { clusterId, lastJobId: job.id, lastImage: job.image || null }, { merge: true });
				db.setDoc(CLUSTER_JOBS, `${clusterId}:${job.id}`, {
					clusterId,
					jobId: job.id,
					image: job.image || null,
					name: job.name || 'Edit Result',
					promptJson: job.promptJson || null,
					editHistoryId: job.editHistoryId || null,
					editParentHistoryId: job.editParentHistoryId || null,
					sourceFileId: job.sourceFileId || null,
					createdAt: job.createdAt || new Date().toISOString()
				}, { merge: true });
				return json({ ok: true });
			}
			default:
				return json({ error: `Unknown action: ${action}` }, { status: 400 });
		}
	} catch (error) {
		console.error('[api/jobs]', action, error);
		return json({ error: error.message }, { status: 500 });
	}
}
