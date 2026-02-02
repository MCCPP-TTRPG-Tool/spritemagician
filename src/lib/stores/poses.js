import { writable } from 'svelte/store';

// Store for saved poses
function createPoseStore() {
	const { subscribe, set, update } = writable({
		referenceImage: null, // The original character reference
		poses: [], // Array of { id, name, imageData, prompt, createdAt }
	});

	return {
		subscribe,
		setReference: (imageData) => update(s => ({ ...s, referenceImage: imageData })),
		addPose: (pose) => update(s => ({
			...s,
			poses: [...s.poses, {
				id: `pose-${Date.now()}`,
				createdAt: Date.now(),
				...pose
			}]
		})),
		removePose: (id) => update(s => ({
			...s,
			poses: s.poses.filter(p => p.id !== id)
		})),
		renamePose: (id, name) => update(s => ({
			...s,
			poses: s.poses.map(p => p.id === id ? { ...p, name } : p)
		})),
		clear: () => set({ referenceImage: null, poses: [] }),
		reset: () => set({ referenceImage: null, poses: [] })
	};
}

export const poseStore = createPoseStore();

