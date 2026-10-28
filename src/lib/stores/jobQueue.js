import { writable } from 'svelte/store';
import { browser } from '$app/environment';
import { upsertJobLog, deleteJobLog } from '$lib/library/client.js';

const JOB_QUEUE_KEY = 'spritemagician_job_queue_v1';
const JOB_LOG_OPS_KEY = 'spritemagician_job_log_ops_v1';
const INTERRUPTED_ERROR_MESSAGE = 'Interrupted before completion';

function toIso(value) {
	if (!value) return null;
	if (typeof value === 'string') return value;
	if (value instanceof Date) return value.toISOString();
	try {
		const d = new Date(value);
		return Number.isFinite(d.getTime()) ? d.toISOString() : null;
	} catch {
		return null;
	}
}

function readJsonArray(key) {
	if (!browser) return [];
	try {
		const raw = localStorage.getItem(key);
		const parsed = raw ? JSON.parse(raw) : [];
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

function inferKind(job) {
	if (job?.kind) return String(job.kind).toLowerCase();
	if (job?.frames?.length) return 'animation';
	if (job?.videoUrl || job?.result?.videoUrl) return 'video';
	return 'image';
}

function createJobLogPayload(job) {
	return {
		sourceStore: 'queue',
		type: job?.type || null,
		kind: inferKind(job),
		origin: job?.origin || null,
		status: job?.status || 'queued',
		name: job?.name || 'Generation',
		progress: Number.isFinite(Number(job?.progress)) ? Number(job.progress) : 0,
		message: job?.message || null,
		error: typeof job?.error === 'string' ? job.error : job?.error?.message || null,
		frameCount: Number(job?.result?.frameCount || job?.frames?.length || 0),
		hasImage: !!(job?.image || job?.result?.image),
		hasVideo: !!(job?.videoUrl || job?.result?.videoUrl),
		createdAt: toIso(job?.createdAt),
		completedAt: toIso(job?.completedAt),
		updatedAtClient: new Date().toISOString()
	};
}

function normalizeHydratedJob(job) {
	const normalized = {
		...job,
		createdAt: toIso(job?.createdAt) || new Date().toISOString(),
		completedAt: toIso(job?.completedAt),
		updatedAt: toIso(job?.updatedAt) || new Date().toISOString()
	};

	if (normalized.status === 'pending' || normalized.status === 'processing') {
		return {
			...normalized,
			status: 'failed',
			error: normalized.error || INTERRUPTED_ERROR_MESSAGE,
			message: normalized.message || 'Marked failed after interruption.',
			completedAt: normalized.completedAt || new Date().toISOString(),
			updatedAt: new Date().toISOString()
		};
	}

	return normalized;
}

// Job statuses: 'pending', 'processing', 'completed', 'failed', 'cancelled'
const createJobQueueStore = () => {
	const { subscribe, set, update } = writable([]);
	let pendingOps = readJsonArray(JOB_LOG_OPS_KEY);
	let isFlushingOps = false;

	function persistQueue(jobs) {
		if (!browser) return;
		try {
			localStorage.setItem(JOB_QUEUE_KEY, JSON.stringify(jobs));
		} catch {
			// ignore persistence errors
		}
	}

	function persistPendingOps() {
		if (!browser) return;
		try {
			localStorage.setItem(JOB_LOG_OPS_KEY, JSON.stringify(pendingOps));
		} catch {
			// ignore persistence errors
		}
	}

	function enqueueUpsert(job) {
		if (!job?.id) return;
		pendingOps.push({ type: 'upsert', jobId: job.id, payload: createJobLogPayload(job) });
		persistPendingOps();
		void flushPendingOps();
	}

	function enqueueDelete(jobId) {
		if (!jobId) return;
		pendingOps.push({ type: 'delete', jobId });
		persistPendingOps();
		void flushPendingOps();
	}

	async function flushPendingOps() {
		if (!browser || isFlushingOps) return;
		if (typeof navigator !== 'undefined' && !navigator.onLine) return;
		const uid = 'local';
		if (!uid) return;

		isFlushingOps = true;
		try {
			while (pendingOps.length > 0) {
				const op = pendingOps[0];
				if (op?.type === 'upsert') {
					await upsertJobLog(uid, op.jobId, op.payload || {});
				} else if (op?.type === 'delete') {
					await deleteJobLog(uid, op.jobId);
				}
				pendingOps.shift();
				persistPendingOps();
			}
		} catch {
			// keep remaining ops queued for retry on next auth/online event
		} finally {
			isFlushingOps = false;
		}
	}

	if (browser) {
		const hydrated = readJsonArray(JOB_QUEUE_KEY).map(normalizeHydratedJob);
		set(hydrated);
		persistQueue(hydrated);
		window.addEventListener('online', () => {
			void flushPendingOps();
		});
	}

	function updateAndPersist(mutator) {
		let nextSnapshot = [];
		update((jobs) => {
			nextSnapshot = mutator(jobs);
			return nextSnapshot;
		});
		persistQueue(nextSnapshot);
		return nextSnapshot;
	}

	return {
		subscribe,

		// Add a new job to the queue
		addJob: (job) => {
			const nowIso = new Date().toISOString();
			const newJob = {
				id: `job-${Date.now()}-${Math.random().toString(36).substring(7)}`,
				createdAt: nowIso,
				updatedAt: nowIso,
				status: 'pending',
				progress: 0,
				...job
			};
			updateAndPersist((jobs) => [newJob, ...jobs]);
			enqueueUpsert(newJob);
			return newJob.id;
		},

		// Update job status/progress
		updateJob: (jobId, updates) => {
			let changedJob = null;
			updateAndPersist((jobs) =>
				jobs.map((job) => {
					if (job.id !== jobId) return job;
					changedJob = { ...job, ...updates, updatedAt: new Date().toISOString() };
					return changedJob;
				})
			);
			if (changedJob) enqueueUpsert(changedJob);
		},

		// Mark job as completed
		completeJob: (jobId, result = null) => {
			let changedJob = null;
			updateAndPersist((jobs) =>
				jobs.map((job) => {
					if (job.id !== jobId) return job;
					changedJob = {
						...job,
						status: 'completed',
						progress: 100,
						result,
						completedAt: new Date().toISOString(),
						updatedAt: new Date().toISOString()
					};
					return changedJob;
				})
			);
			if (changedJob) enqueueUpsert(changedJob);
		},

		// Mark job as failed
		failJob: (jobId, error) => {
			let changedJob = null;
			updateAndPersist((jobs) =>
				jobs.map((job) => {
					if (job.id !== jobId) return job;
					changedJob = {
						...job,
						status: 'failed',
						error,
						completedAt: new Date().toISOString(),
						updatedAt: new Date().toISOString()
					};
					return changedJob;
				})
			);
			if (changedJob) enqueueUpsert(changedJob);
		},

		// Cancel a job
		cancelJob: (jobId) => {
			let changedJob = null;
			updateAndPersist((jobs) =>
				jobs.map((job) => {
					if (job.id !== jobId) return job;
					changedJob = {
						...job,
						status: 'cancelled',
						completedAt: new Date().toISOString(),
						updatedAt: new Date().toISOString()
					};
					return changedJob;
				})
			);
			if (changedJob) enqueueUpsert(changedJob);
		},

		// Remove a job from the queue
		removeJob: (jobId) => {
			updateAndPersist((jobs) => jobs.filter((job) => job.id !== jobId));
			enqueueDelete(jobId);
		},

		// Clear completed/failed jobs
		clearFinished: () => {
			const removedIds = [];
			updateAndPersist((jobs) =>
				jobs.filter((job) => {
					const keep = job.status === 'pending' || job.status === 'processing';
					if (!keep) removedIds.push(job.id);
					return keep;
				})
			);
			for (const id of removedIds) enqueueDelete(id);
		},

		// Clear all jobs
		clearAll: () => {
			const removedIds = [];
			updateAndPersist((jobs) => {
				for (const job of jobs) removedIds.push(job.id);
				return [];
			});
			for (const id of removedIds) enqueueDelete(id);
		}
	};
};

export const jobQueue = createJobQueueStore();
