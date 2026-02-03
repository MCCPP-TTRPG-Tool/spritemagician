import { writable, get } from 'svelte/store';

// Store for all completed generation jobs (sprites + animations)
const createCompletedJobsStore = () => {
	const { subscribe, set, update } = writable({
		jobs: [],      // Array of { id, type, name, data, createdAt }
		activeIndex: 0
	});

	return {
		subscribe,
		
		// Add a completed sprite
		addSprite: (sprite) => {
			const job = {
				id: `sprite-${Date.now()}-${Math.random().toString(36).substring(7)}`,
				type: 'sprite',
				name: sprite.name || 'Sprite',
				image: sprite.image,
				description: sprite.description || '',
				createdAt: new Date()
			};
			update(state => ({
				jobs: [job, ...state.jobs],
				activeIndex: 0
			}));
			return job.id;
		},
		
		// Add a completed animation
		addAnimation: (animation) => {
			const job = {
				id: `anim-${Date.now()}-${Math.random().toString(36).substring(7)}`,
				type: 'animation',
				name: animation.name || 'Animation',
				frames: animation.frames,
				fps: animation.fps || 12,
				pose: animation.pose || '',
				createdAt: new Date()
			};
			update(state => ({
				jobs: [job, ...state.jobs],
				activeIndex: 0
			}));
			return job.id;
		},
		
		// Remove a job
		removeJob: (id) => {
			update(state => {
				const newJobs = state.jobs.filter(j => j.id !== id);
				return {
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
		clearAll: () => {
			set({ jobs: [], activeIndex: 0 });
		},
		
		// Get count
		getCount: () => get({ subscribe }).jobs.length
	};
};

export const completedJobs = createCompletedJobsStore();
