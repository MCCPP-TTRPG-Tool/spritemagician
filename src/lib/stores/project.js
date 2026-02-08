import { writable } from 'svelte/store';

export const projectStore = writable({
	frames: [],
	fps: 12, // 12fps default, good balance of smoothness and length
	prompt: '',
	firstFrame: null,
	lastFrame: null,
	generationMode: 'prompt', // 'prompt' or 'interpolation'
	frameCount: 8,
	duration: null, // in seconds
	projectName: 'Untitled Project',
	lastSaved: null,
	// Set by FileTree to load an image into a standalone panel + switch tab
	editImage: null,
	styleImage: null,
	// Pre-selected save folder for animations
	animSaveFolderId: null,
	animSaveFolderPath: null
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

