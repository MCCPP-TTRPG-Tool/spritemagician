import { writable } from 'svelte/store';

// Store for saved animations (collections of frames)
function createAnimationStore() {
	const { subscribe, set, update } = writable({
		animations: [], // Array of { id, name, frames[], fps, prompt, animationType, createdAt }
	});

	return {
		subscribe,
		addAnimation: (animation) => update(s => ({
			...s,
			animations: [...s.animations, {
				id: `anim-${Date.now()}`,
				createdAt: Date.now(),
				...animation
			}]
		})),
		removeAnimation: (id) => update(s => ({
			...s,
			animations: s.animations.filter(a => a.id !== id)
		})),
		renameAnimation: (id, name) => update(s => ({
			...s,
			animations: s.animations.map(a => a.id === id ? { ...a, name } : a)
		})),
		updateAnimation: (id, updates) => update(s => ({
			...s,
			animations: s.animations.map(a => a.id === id ? { ...a, ...updates } : a)
		})),
		clear: () => set({ animations: [] }),
		reset: () => set({ animations: [] })
	};
}

export const animationStore = createAnimationStore();
