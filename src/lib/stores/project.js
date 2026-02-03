import { writable } from 'svelte/store';

export const projectStore = writable({
	frames: [],
	fps: 8, // Lower FPS = longer animations from same frames
	prompt: '',
	firstFrame: null,
	lastFrame: null,
	generationMode: 'prompt', // 'prompt' or 'interpolation'
	frameCount: 8,
	duration: null, // in seconds
	projectName: 'Untitled Project',
	lastSaved: null
});

export function addFrame(frameData) {
	projectStore.update(project => ({
		...project,
		frames: [...project.frames, frameData]
	}));
}

export function removeFrame(index) {
	projectStore.update(project => ({
		...project,
		frames: project.frames.filter((_, i) => i !== index)
	}));
}

export function reorderFrames(oldIndex, newIndex) {
	projectStore.update(project => {
		const frames = [...project.frames];
		const [moved] = frames.splice(oldIndex, 1);
		frames.splice(newIndex, 0, moved);
		return { ...project, frames };
	});
}

export function updateFPS(fps) {
	projectStore.update(project => ({ ...project, fps }));
}

export function setGenerationMode(mode) {
	projectStore.update(project => ({ ...project, generationMode: mode }));
}

export function setFrameCount(count) {
	projectStore.update(project => ({ ...project, frameCount: count }));
}

