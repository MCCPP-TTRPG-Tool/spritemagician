import { CHROMA_KEY_HEX } from '$lib/constants/chromaKey.js';
import { browser } from '$app/environment';
import { writable } from 'svelte/store';

const STORAGE_KEY = 'spritemagician.active-asset.v1';

const defaultState = {
	folderId: null,
	folderName: '',
	folderPath: '',
	autoSave: true,
	chromaKeyHex: CHROMA_KEY_HEX
};

function readStored() {
	if (!browser) return defaultState;
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return defaultState;
		const parsed = JSON.parse(raw);
		if (!parsed || typeof parsed !== 'object') return defaultState;
		return {
			folderId: typeof parsed.folderId === 'string' ? parsed.folderId : null,
			folderName: typeof parsed.folderName === 'string' ? parsed.folderName : '',
			folderPath: typeof parsed.folderPath === 'string' ? parsed.folderPath : '',
			autoSave: parsed.autoSave !== false,
			chromaKeyHex:
				typeof parsed.chromaKeyHex === 'string' && /^#[0-9A-Fa-f]{6}$/.test(parsed.chromaKeyHex)
					? parsed.chromaKeyHex.toUpperCase()
					: CHROMA_KEY_HEX
		};
	} catch {
		return defaultState;
	}
}

export const activeAssetStore = writable(readStored());

if (browser) {
	activeAssetStore.subscribe((state) => {
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
		} catch {
			// ignore storage errors
		}
	});
}

export function setActiveAssetContext({ folderId, folderName, folderPath, chromaKeyHex }) {
	activeAssetStore.update((state) => ({
		...state,
		folderId: folderId || null,
		folderName: folderName || '',
		folderPath: folderPath || folderName || '',
		chromaKeyHex:
			typeof chromaKeyHex === 'string' && /^#[0-9A-Fa-f]{6}$/.test(chromaKeyHex)
				? chromaKeyHex.toUpperCase()
				: state.chromaKeyHex || CHROMA_KEY_HEX
	}));
}

export function clearActiveAssetContext() {
	activeAssetStore.set(defaultState);
}

export function setActiveAssetAutoSave(enabled) {
	activeAssetStore.update((state) => ({
		...state,
		autoSave: !!enabled
	}));
}

export function setActiveAssetChromaKeyHex(hex) {
	if (typeof hex !== 'string' || !/^#[0-9A-Fa-f]{6}$/.test(hex)) return;
	activeAssetStore.update((state) => ({
		...state,
		chromaKeyHex: hex.toUpperCase()
	}));
}
