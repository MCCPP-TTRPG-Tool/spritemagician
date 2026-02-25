import { browser } from '$app/environment';
import { writable } from 'svelte/store';

const STORAGE_KEY = 'spritemagician.project.v1';

const defaultProjectState = {
	frames: [],
	currentFrame: 0,
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
};

function toPersistedState(state) {
	return {
		frames: Array.isArray(state.frames) ? state.frames : [],
		currentFrame: Number.isFinite(state.currentFrame) ? state.currentFrame : 0,
		fps: Number.isFinite(state.fps) ? state.fps : 12,
		prompt: typeof state.prompt === 'string' ? state.prompt : '',
		firstFrame: typeof state.firstFrame === 'string' ? state.firstFrame : null,
		lastFrame: typeof state.lastFrame === 'string' ? state.lastFrame : null,
		generationMode: typeof state.generationMode === 'string' ? state.generationMode : 'prompt',
		frameCount: Number.isFinite(state.frameCount) ? state.frameCount : 8,
		duration: Number.isFinite(state.duration) ? state.duration : null,
		projectName: typeof state.projectName === 'string' ? state.projectName : 'Untitled Project',
		lastSaved: state.lastSaved || null,
		editImage: typeof state.editImage === 'string' ? state.editImage : null,
		styleImage: typeof state.styleImage === 'string' ? state.styleImage : null,
		animSaveFolderId: typeof state.animSaveFolderId === 'string' ? state.animSaveFolderId : null,
		animSaveFolderPath: typeof state.animSaveFolderPath === 'string' ? state.animSaveFolderPath : null
	};
}

function readStoredState() {
	if (!browser) return defaultProjectState;
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return defaultProjectState;
		const parsed = JSON.parse(raw);
		if (!parsed || typeof parsed !== 'object') return defaultProjectState;
		return {
			...defaultProjectState,
			...toPersistedState(parsed)
		};
	} catch {
		return defaultProjectState;
	}
}

export const projectStore = writable(readStoredState());

if (browser) {
	projectStore.subscribe((state) => {
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(toPersistedState(state)));
		} catch {
			// ignore quota/storage issues
		}
	});
}

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

