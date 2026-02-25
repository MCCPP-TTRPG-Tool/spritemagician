import { browser } from '$app/environment';
import { get, writable } from 'svelte/store';

const STORAGE_KEY = 'spritemagician.design.v1';

const defaultMessages = [
	{
		role: 'assistant',
		content: 'Tell me your character idea. I will help turn it into a clean Genesis prompt.'
	}
];

const defaultState = {
	mode: 'chat',
	messages: defaultMessages,
	draftPrompt: '',
	generatedImage: null,
	contentPreset: 'character',
	stylePreset: 'default',
	savedConversations: []
};

function readStoredState() {
	if (!browser) return null;
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw);
		if (!parsed || typeof parsed !== 'object') return null;
		return {
			...defaultState,
			...parsed,
			messages: Array.isArray(parsed.messages) && parsed.messages.length ? parsed.messages : defaultMessages,
			savedConversations: Array.isArray(parsed.savedConversations) ? parsed.savedConversations : []
		};
	} catch {
		return null;
	}
}

function persist(state) {
	if (!browser) return;
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
	} catch {
		// Ignore storage errors (quota/private mode)
	}
}

const initial = readStoredState() || defaultState;

export const designStore = writable(initial);

if (browser) {
	designStore.subscribe((state) => {
		persist(state);
	});
}

export function updateDesignState(patch) {
	designStore.update((state) => ({ ...state, ...patch }));
}

export function appendDesignMessage(message) {
	designStore.update((state) => ({
		...state,
		messages: [...state.messages, message]
	}));
}

export function resetCurrentConversation() {
	designStore.update((state) => ({
		...state,
		messages: defaultMessages,
		draftPrompt: '',
		generatedImage: null,
		mode: 'chat'
	}));
}

export function saveCurrentConversation(name = 'Conversation') {
	const state = get(designStore);
	const snapshot = {
		id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
		name,
		createdAt: new Date().toISOString(),
		messages: state.messages,
		draftPrompt: state.draftPrompt,
		contentPreset: state.contentPreset,
		stylePreset: state.stylePreset
	};

	designStore.update((s) => ({
		...s,
		savedConversations: [snapshot, ...s.savedConversations].slice(0, 50)
	}));
}

export function loadSavedConversation(conversationId) {
	designStore.update((state) => {
		const found = state.savedConversations.find((item) => item.id === conversationId);
		if (!found) return state;
		return {
			...state,
			messages: found.messages || defaultMessages,
			draftPrompt: found.draftPrompt || '',
			contentPreset: found.contentPreset || state.contentPreset,
			stylePreset: found.stylePreset || state.stylePreset,
			mode: 'chat'
		};
	});
}

export function deleteSavedConversation(conversationId) {
	designStore.update((state) => ({
		...state,
		savedConversations: state.savedConversations.filter((item) => item.id !== conversationId)
	}));
}
