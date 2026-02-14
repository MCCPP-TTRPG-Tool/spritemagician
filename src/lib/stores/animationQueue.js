import { writable, get } from 'svelte/store';
import { projectStore } from './project.js';

/**
 * Animation Queue Store
 * Manages a queue of animations that can be played in sequence
 */
export const animationQueue = writable([]);

// Store the initial animation state before queue operations
let initialAnimationState = null;

/**
 * Add an animation to the queue
 * @param {Object} animation - { id, name, frames, fps, url }
 */
export function addToQueue(animation) {
	animationQueue.update(queue => {
		// Check if already in queue
		if (queue.some(a => a.id === animation.id)) {
			return queue;
		}
		
		// Save and add initial animation state when adding first item to queue
		if (queue.length === 0 && initialAnimationState === null) {
			const current = get(projectStore);
			if (current.frames && current.frames.length > 0) {
				initialAnimationState = {
					frames: [...current.frames],
					fps: current.fps || 12,
					currentFrame: current.currentFrame || 0,
					projectName: current.projectName || 'Untitled Project',
					prompt: current.prompt || ''
				};
				
				// Add the initial animation as the first item in the queue
				const initialAnim = {
					id: 'initial-animation',
					name: current.projectName || 'Initial Animation',
					frames: [...current.frames],
					fps: current.fps || 12,
					url: null
				};
				
				console.log('[AnimationQueue] Saved initial animation and added to front of queue');
				// Return initial animation first, then the new animation
				return [initialAnim, animation];
			}
		}
		
		// For subsequent additions, just append to the queue
		return [...queue, animation];
	});
}

/**
 * Remove an animation from the queue
 * @param {string} id - Animation ID
 */
export function removeFromQueue(id) {
	animationQueue.update(queue => queue.filter(a => a.id !== id));
}

/**
 * Reorder animations in the queue
 * @param {number} oldIndex - Current index
 * @param {number} newIndex - New index
 */
export function reorderQueue(oldIndex, newIndex) {
	animationQueue.update(queue => {
		const newQueue = [...queue];
		const [moved] = newQueue.splice(oldIndex, 1);
		newQueue.splice(newIndex, 0, moved);
		return newQueue;
	});
}

/**
 * Clear the entire queue and restore initial animation
 */
export function clearQueue() {
	animationQueue.set([]);
	
	// Restore the initial animation state if it was saved
	if (initialAnimationState) {
		projectStore.update(p => ({
			...p,
			frames: initialAnimationState.frames,
			fps: initialAnimationState.fps,
			currentFrame: initialAnimationState.currentFrame,
			projectName: initialAnimationState.projectName,
			prompt: initialAnimationState.prompt,
			_animationLoaded: true
		}));
		console.log('[AnimationQueue] Restored initial animation state');
		initialAnimationState = null; // Reset after restoring
	}
}

/**
 * Reset the initial animation state (when a new animation is loaded)
 */
export function resetInitialState() {
	initialAnimationState = null;
}

/**
 * Get all frames from all animations in queue order
 * @returns {Array} Combined frames array
 */
export function getCombinedFrames() {
	let combined = [];
	animationQueue.subscribe(queue => {
		combined = queue.flatMap(anim => anim.frames || []);
	})();
	return combined;
}
