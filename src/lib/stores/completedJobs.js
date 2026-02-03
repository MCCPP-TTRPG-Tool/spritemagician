import { writable, get } from 'svelte/store';
import { browser } from '$app/environment';

const STORAGE_KEY = 'spritemagician_completed_jobs';
const DB_NAME = 'spritemagician_completed_db';
const STORE_NAME = 'completed_jobs';

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

	// Load jobs from IndexedDB on startup
	async function loadJobs() {
		if (!browser) return;
		try {
			const jobs = await getAllJobsFromDB();
			// Sort by createdAt descending (newest first)
			jobs.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
			set({ jobs, activeIndex: 0, loaded: true });
			console.log(`Loaded ${jobs.length} completed jobs from storage`);
		} catch (e) {
			console.error('Failed to load jobs:', e);
			set({ jobs: [], activeIndex: 0, loaded: true });
		}
	}

	// Initialize
	if (browser) {
		loadJobs();
	}

	return {
		subscribe,
		
		// Add a completed sprite
		addSprite: async (sprite) => {
			const job = {
				id: `sprite-${Date.now()}-${Math.random().toString(36).substring(7)}`,
				type: 'sprite',
				name: sprite.name || 'Sprite',
				image: sprite.image,
				description: sprite.description || '',
				createdAt: new Date().toISOString()
			};
			
			// Save to IndexedDB
			await saveJobToDB(job);
			
			// Update store (limit to 50 jobs max)
			update(state => ({
				...state,
				jobs: [job, ...state.jobs].slice(0, 50),
				activeIndex: 0
			}));
			
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
				createdAt: new Date().toISOString()
			};
			
			// Save to IndexedDB
			await saveJobToDB(job);
			
			// Update store (limit to 50 jobs max)
			update(state => ({
				...state,
				jobs: [job, ...state.jobs].slice(0, 50),
				activeIndex: 0
			}));
			
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
