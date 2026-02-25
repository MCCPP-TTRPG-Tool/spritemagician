import { browser } from '$app/environment';
import { get, writable } from 'svelte/store';

const STORAGE_KEY = 'spritemagician.design.v2';
const MAX_MESSAGES = 300;
const MAX_MESSAGE_CHARS = 2000;
const MAX_SAVED_CONVERSATIONS = 100;

const defaultMessages = [
	{
		role: 'assistant',
		content:
			'Tell me your idea. I will help conceptualize it first, then use Write Prompt when you are ready for a Genesis draft.'
	}
];

const defaultState = {
	mode: 'chat',
	messages: defaultMessages,
	draftPrompt: '',
	generatedImage: null, // volatile (not persisted to localStorage)
	chatReferenceImage: null,
	contentPreset: 'character',
	stylePreset: 'default',
	genesisModel: 'nano_banana',
	savedConversations: []
};

function normalizeMessages(messages) {
	if (!Array.isArray(messages) || messages.length === 0) return defaultMessages;
	const cleaned = messages
		.filter((m) => m && (m.role === 'assistant' || m.role === 'user') && typeof m.content === 'string')
		.map((m) => ({
			role: m.role,
			content: m.content.slice(0, MAX_MESSAGE_CHARS),
			image: typeof m.image === 'string' && m.image.startsWith('data:image/') ? m.image : null
		}))
		.slice(-MAX_MESSAGES);
	return cleaned.length ? cleaned : defaultMessages;
}

function normalizeSavedConversations(items) {
	if (!Array.isArray(items)) return [];
	return items
		.filter((item) => item && typeof item.id === 'string')
		.map((item) => ({
			id: item.id,
			name: typeof item.name === 'string' ? item.name.slice(0, 80) : 'Conversation',
			createdAt: item.createdAt || new Date().toISOString(),
			messages: normalizeMessages(item.messages),
			draftPrompt: typeof item.draftPrompt === 'string' ? item.draftPrompt : '',
			contentPreset: typeof item.contentPreset === 'string' ? item.contentPreset : 'character',
			stylePreset: typeof item.stylePreset === 'string' ? item.stylePreset : 'default',
			genesisModel:
				item.genesisModel === 'gpt4' || item.genesisModel === 'dalle'
					? item.genesisModel
					: 'nano_banana'
		}))
		.slice(0, MAX_SAVED_CONVERSATIONS);
}

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
			generatedImage: null,
			messages: normalizeMessages(parsed.messages),
			savedConversations: normalizeSavedConversations(parsed.savedConversations)
		};
	} catch {
		return null;
	}
}

function toPersistedState(state) {
	return {
		...state,
		generatedImage: null,
		messages: normalizeMessages(state.messages),
		savedConversations: normalizeSavedConversations(state.savedConversations)
	};
}

function persist(state) {
	if (!browser) return;
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(toPersistedState(state)));
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
	designStore.update((state) => ({
		...state,
		...patch,
		messages: patch?.messages ? normalizeMessages(patch.messages) : state.messages
	}));
}

export function appendDesignMessage(message) {
	if (!message || (message.role !== 'assistant' && message.role !== 'user')) return;
	const content = typeof message.content === 'string' ? message.content.slice(0, MAX_MESSAGE_CHARS) : '';
	if (!content.trim()) return;
	const image = typeof message.image === 'string' && message.image.startsWith('data:image/') ? message.image : null;

	designStore.update((state) => ({
		...state,
		messages: [...state.messages, { role: message.role, content, image }].slice(-MAX_MESSAGES)
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
		name: String(name || 'Conversation').slice(0, 80),
		createdAt: new Date().toISOString(),
		messages: normalizeMessages(state.messages),
		draftPrompt: state.draftPrompt,
		contentPreset: state.contentPreset,
		stylePreset: state.stylePreset,
		genesisModel: state.genesisModel
	};

	designStore.update((s) => ({
		...s,
		savedConversations: [snapshot, ...normalizeSavedConversations(s.savedConversations)].slice(0, MAX_SAVED_CONVERSATIONS)
	}));
}

export function loadSavedConversation(conversationId) {
	designStore.update((state) => {
		const found = state.savedConversations.find((item) => item.id === conversationId);
		if (!found) return state;
		return {
			...state,
			messages: normalizeMessages(found.messages),
			draftPrompt: found.draftPrompt || '',
			contentPreset: found.contentPreset || state.contentPreset,
			stylePreset: found.stylePreset || state.stylePreset,
			genesisModel: found.genesisModel || state.genesisModel,
			generatedImage: null,
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
