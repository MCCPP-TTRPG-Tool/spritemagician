import { writable, get } from 'svelte/store';
import { browser } from '$app/environment';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '$lib/firebase/client.js';
import { saveEditClusterJob, upsertJobLog, deleteJobLog } from '$lib/firebase/firestore.js';

const STORAGE_KEY = 'spritemagician_completed_jobs';
const DB_NAME = 'spritemagician_completed_db';
const STORE_NAME = 'completed_jobs';
const JOB_LOG_OPS_KEY = 'spritemagician_completed_job_log_ops_v1';

// IndexedDB helpers for large data (frames, images)
let db = null;

async function openDB() {
	if (!browser) return null;
	if (db) return db;
	
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, 1);
		request.onerror = () => reject(request.error);
		request.onsuccess = () => {
			db = request.result;
			resolve(db);
		};
		request.onupgradeneeded = (event) => {
			const database = event.target.result;
			if (!database.objectStoreNames.contains(STORE_NAME)) {
				database.createObjectStore(STORE_NAME, { keyPath: 'id' });
			}
		};
	});
}

async function saveJobToDB(job) {
	if (!browser) return;
	try {
		const database = await openDB();
		if (!database) return;
		return new Promise((resolve, reject) => {
			const transaction = database.transaction([STORE_NAME], 'readwrite');
			const store = transaction.objectStore(STORE_NAME);
			const request = store.put(job);
			request.onsuccess = () => resolve();
			request.onerror = () => reject(request.error);
		});
	} catch (e) {
		console.error('Failed to save job to IndexedDB:', e);
	}
}

async function getJobFromDB(id) {
	if (!browser) return null;
	try {
		const database = await openDB();
		if (!database) return null;
		return new Promise((resolve, reject) => {
			const transaction = database.transaction([STORE_NAME], 'readonly');
			const store = transaction.objectStore(STORE_NAME);
			const request = store.get(id);
			request.onsuccess = () => resolve(request.result || null);
			request.onerror = () => reject(request.error);
		});
	} catch (e) {
		console.error('Failed to get job from IndexedDB:', e);
		return null;
	}
}

async function deleteJobFromDB(id) {
	if (!browser) return;
	try {
		const database = await openDB();
		if (!database) return;
		return new Promise((resolve, reject) => {
			const transaction = database.transaction([STORE_NAME], 'readwrite');
			const store = transaction.objectStore(STORE_NAME);
			const request = store.delete(id);
			request.onsuccess = () => resolve();
			request.onerror = () => reject(request.error);
		});
	} catch (e) {
		console.error('Failed to delete job from IndexedDB:', e);
	}
}

async function getAllJobsFromDB() {
	if (!browser) return [];
	try {
		const database = await openDB();
		if (!database) return [];
		return new Promise((resolve, reject) => {
			const transaction = database.transaction([STORE_NAME], 'readonly');
			const store = transaction.objectStore(STORE_NAME);
			const request = store.getAll();
			request.onsuccess = () => resolve(request.result || []);
			request.onerror = () => reject(request.error);
		});
	} catch (e) {
		console.error('Failed to get all jobs from IndexedDB:', e);
		return [];
	}
}

function getJobSortTime(job) {
	const ts = job?.updatedAt || job?.createdAt;
	const ms = ts ? new Date(ts).getTime() : 0;
	return Number.isFinite(ms) ? ms : 0;
}

function createCompletedJobLogPayload(job) {
	const frameCount = Array.isArray(job?.frames) ? job.frames.length : 0;
	return {
		sourceStore: 'completed',
		type: job?.type || 'job',
		kind: job?.type === 'animation' ? 'animation' : 'image',
		status: job?.status || 'completed',
		name: job?.name || 'Job',
		progress: 100,
		error: job?.error || null,
		frameCount,
		hasImage: !!job?.image,
		hasVideo: !!job?.videoUrl,
		createdAt: job?.createdAt || null,
		completedAt: job?.updatedAt || job?.createdAt || null,
		updatedAtClient: new Date().toISOString()
	};
}

async function clearAllJobsFromDB() {
	if (!browser) return;
	try {
		const database = await openDB();
		if (!database) return;
		return new Promise((resolve, reject) => {
			const transaction = database.transaction([STORE_NAME], 'readwrite');
			const store = transaction.objectStore(STORE_NAME);
			const request = store.clear();
			request.onsuccess = () => resolve();
			request.onerror = () => reject(request.error);
		});
	} catch (e) {
		console.error('Failed to clear IndexedDB:', e);
	}
}

// Store for all completed generation jobs (sprites + animations)
const createCompletedJobsStore = () => {
	const { subscribe, set, update } = writable({
		jobs: [],
		activeIndex: 0,
		loaded: false
	});
	let pendingOps = browser
		? (() => {
				try {
					const raw = localStorage.getItem(JOB_LOG_OPS_KEY);
					const parsed = raw ? JSON.parse(raw) : [];
					return Array.isArray(parsed) ? parsed : [];
				} catch {
					return [];
				}
			})()
		: [];
	let isFlushingOps = false;

	function persistPendingOps() {
		if (!browser) return;
		try {
			localStorage.setItem(JOB_LOG_OPS_KEY, JSON.stringify(pendingOps));
		} catch {
			// ignore persistence failures
		}
	}

	function enqueueUpsert(job) {
		if (!job?.id) return;
		pendingOps.push({
			type: 'upsert',
			jobId: job.id,
			payload: createCompletedJobLogPayload(job)
		});
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
		const uid = auth.currentUser?.uid || null;
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
			// keep queue for retry
		} finally {
			isFlushingOps = false;
		}
	}

	// Load jobs from IndexedDB on startup
	async function loadJobs() {
		if (!browser) return;
		try {
			const jobs = await getAllJobsFromDB();
			// Sort by updatedAt/createdAt descending (newest first)
			jobs.sort((a, b) => getJobSortTime(b) - getJobSortTime(a));
			set({ jobs, activeIndex: 0, loaded: true });
			console.log(`Loaded ${jobs.length} completed jobs from storage`);
			for (const job of jobs) enqueueUpsert(job);
		} catch (e) {
			console.error('Failed to load jobs:', e);
			set({ jobs: [], activeIndex: 0, loaded: true });
		}
	}

	// Initialize
	if (browser) {
		loadJobs();
		window.addEventListener('online', () => {
			void flushPendingOps();
		});
		onAuthStateChanged(auth, () => {
			void flushPendingOps();
		});
	}

	return {
		subscribe,
		
		// Add a completed sprite
		addSprite: async (sprite) => {
			const nowIso = new Date().toISOString();
			let job = {
				id: `sprite-${Date.now()}-${Math.random().toString(36).substring(7)}`,
				type: 'sprite',
				name: sprite.name || 'Sprite',
				image: sprite.image,
				description: sprite.description || '',
				promptJson: sprite.promptJson || null,
				editClusterId: sprite.editClusterId || null,
				status: 'completed',
				editHistoryId: sprite.editHistoryId || null,
				editParentHistoryId: sprite.editParentHistoryId || null,
				editRootHistoryId: sprite.editRootHistoryId || null,
				sourceFileId: sprite.sourceFileId || null,
				createdAt: nowIso,
				updatedAt: nowIso
			};

			// Save to IndexedDB
			await saveJobToDB(job);
			if (sprite.uid && job.editClusterId) {
				try {
					await saveEditClusterJob(sprite.uid, job.editClusterId, job);
				} catch (e) {
					console.warn('Failed to sync edit cluster job to Firestore:', e?.message || e);
				}
			}

			// Update store (limit to 50 jobs max)
			update((current) => {
				const jobs = [job, ...current.jobs]
					.sort((a, b) => getJobSortTime(b) - getJobSortTime(a))
					.slice(0, 50);
				return {
					...current,
					jobs,
					activeIndex: 0
				};
			});
			enqueueUpsert(job);
			
			console.log('Saved sprite to completed jobs:', job.id);
			return job.id;
		},
		
		// Add a completed animation
		addAnimation: async (animation) => {
			const job = {
				id: `anim-${Date.now()}-${Math.random().toString(36).substring(7)}`,
				type: 'animation',
				name: animation.name || 'Animation',
				frames: animation.frames || [],
				videoUrl: animation.videoUrl || null,
				error: animation.error || null,
				fps: animation.fps || 12,
				pose: animation.pose || '',
				status: 'completed',
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString()
			};
			
			// Save to IndexedDB
			await saveJobToDB(job);
			
			// Update store (limit to 50 jobs max)
			update((state) => ({
				...state,
				jobs: [job, ...state.jobs]
					.sort((a, b) => getJobSortTime(b) - getJobSortTime(a))
					.slice(0, 50),
				activeIndex: 0
			}));
			enqueueUpsert(job);
			
			console.log('Saved animation to completed jobs:', job.id, animation.videoUrl ? '(has video)' : `(${job.frames.length} frames)`);
			return job.id;
		},
		
		// Remove a job
		removeJob: async (id) => {
			await deleteJobFromDB(id);
			update(state => {
				const newJobs = state.jobs.filter(j => j.id !== id);
				return {
					...state,
					jobs: newJobs,
					activeIndex: Math.min(state.activeIndex, Math.max(0, newJobs.length - 1))
				};
			});
			enqueueDelete(id);
		},

		// Rename a completed job
		renameJob: async (id, nextName) => {
			const name = String(nextName || '').trim();
			if (!name) return;
			const state = get({ subscribe });
			const existing = state.jobs.find((j) => j.id === id);
			if (!existing) return;
			const updated = {
				...existing,
				name,
				updatedAt: new Date().toISOString()
			};
			await saveJobToDB(updated);
			update((current) => ({
				...current,
				jobs: current.jobs
					.map((j) => (j.id === id ? updated : j))
					.sort((a, b) => getJobSortTime(b) - getJobSortTime(a))
			}));
			enqueueUpsert(updated);
		},
		
		// Set active job by index
		setActiveIndex: (index) => {
			update(state => ({
				...state,
				activeIndex: Math.max(0, Math.min(index, state.jobs.length - 1))
			}));
		},
		
		// Navigate
		next: () => {
			update(state => ({
				...state,
				activeIndex: state.jobs.length > 0 ? (state.activeIndex + 1) % state.jobs.length : 0
			}));
		},
		
		prev: () => {
			update(state => ({
				...state,
				activeIndex: state.jobs.length > 0 
					? (state.activeIndex === 0 ? state.jobs.length - 1 : state.activeIndex - 1)
					: 0
			}));
		},
		
		// Get active job
		getActive: () => {
			const state = get({ subscribe });
			return state.jobs.length > 0 ? state.jobs[state.activeIndex] : null;
		},
		
		// Clear all
		clearAll: async () => {
			const state = get({ subscribe });
			for (const job of state.jobs) enqueueDelete(job.id);
			await clearAllJobsFromDB();
			set({ jobs: [], activeIndex: 0, loaded: true });
		},
		
		// Get count
		getCount: () => get({ subscribe }).jobs.length,
		
		// Reload from storage
		reload: loadJobs
	};
};

export const completedJobs = createCompletedJobsStore();
