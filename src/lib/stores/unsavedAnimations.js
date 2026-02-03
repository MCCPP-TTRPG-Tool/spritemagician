import { writable, get } from 'svelte/store';

// Store for unsaved/pending animations that haven't been committed yet
const createUnsavedAnimationsStore = () => {
	const { subscribe, set, update } = writable({
		animations: [], // Array of { id, name, frames, createdAt, jobId }
		activeIndex: 0  // Which animation is currently displayed
	});

	return {
		subscribe,
		
		// Add a completed animation to the buffer
		addAnimation: (animation) => {
			const newAnim = {
				id: `unsaved-${Date.now()}-${Math.random().toString(36).substring(7)}`,
				createdAt: new Date(),
				...animation
			};
			update(state => ({
				animations: [...state.animations, newAnim],
				activeIndex: state.animations.length // Switch to the new one
			}));
			return newAnim.id;
		},
		
		// Remove an animation from the buffer
		removeAnimation: (id) => {
			update(state => {
				const newAnimations = state.animations.filter(a => a.id !== id);
				return {
					animations: newAnimations,
					activeIndex: Math.min(state.activeIndex, Math.max(0, newAnimations.length - 1))
				};
			});
		},
		
		// Set which animation is active/displayed
		setActiveIndex: (index) => {
			update(state => ({
				...state,
				activeIndex: Math.max(0, Math.min(index, state.animations.length - 1))
			}));
		},
		
		// Go to next animation
		nextAnimation: () => {
			update(state => ({
				...state,
				activeIndex: (state.activeIndex + 1) % state.animations.length
			}));
		},
		
		// Go to previous animation
		prevAnimation: () => {
			update(state => ({
				...state,
				activeIndex: state.activeIndex === 0 ? state.animations.length - 1 : state.activeIndex - 1
			}));
		},
		
		// Get the currently active animation
		getActive: () => {
			const state = get({ subscribe });
			if (state.animations.length === 0) return null;
			return state.animations[state.activeIndex];
		},
		
		// Clear all unsaved animations
		clearAll: () => {
			set({ animations: [], activeIndex: 0 });
		},
		
		// Get count
		getCount: () => {
			return get({ subscribe }).animations.length;
		}
	};
};

export const unsavedAnimations = createUnsavedAnimationsStore();
