/**
 * User settings (API keys, preferences) stored in <dataDir>/settings.json.
 *
 * Keys are resolved in this order:
 *   1. settings.json  (entered in the in-app Settings screen)
 *   2. process.env    (for people running from a terminal with a .env file)
 */
import { getSettingsPath, readJson, writeJsonAtomic, getDataDir } from './paths.js';

/** Every secret / endpoint the app can use, with UI metadata. */
export const KEY_DEFINITIONS = [
	{
		name: 'REPLICATE_API_TOKEN',
		label: 'Replicate API token',
		group: 'Required',
		required: true,
		help: 'Powers sprite generation, upscaling, background removal, and video models. Get one at replicate.com/account/api-tokens.'
	},
	{
		name: 'GEMINI_API_KEY',
		label: 'Google Gemini API key',
		group: 'Optional',
		help: 'Used by the Design chat, character sheets, and image edits. Get one at aistudio.google.com.'
	},
	{
		name: 'OPENAI_API_KEY',
		label: 'OpenAI API key',
		group: 'Optional',
		help: 'Used as an alternative image editor and for some prompt helpers.'
	},
	{
		name: 'RUNPOD_API_KEY',
		label: 'RunPod API key',
		group: 'Self-hosted (advanced)',
		help: 'Only needed if you deploy the custom RunPod endpoints from the runpod/ folder.'
	},
	{ name: 'RUNPOD_ENDPOINT_ID', label: 'RunPod keyframe endpoint ID', group: 'Self-hosted (advanced)', secret: false },
	{ name: 'RUNPOD_IMAGE_EDIT_ENDPOINT_ID', label: 'RunPod image-edit endpoint ID', group: 'Self-hosted (advanced)', secret: false },
	{ name: 'RUNPOD_KONTEXT_IMAGE_ENDPOINT_ID', label: 'RunPod Kontext endpoint ID', group: 'Self-hosted (advanced)', secret: false },
	{ name: 'RUNPOD_QWEN_IMAGE_ENDPOINT_ID', label: 'RunPod Qwen image endpoint ID', group: 'Self-hosted (advanced)', secret: false },
	{ name: 'POSE_ENDPOINT_ID', label: 'RunPod pose endpoint ID', group: 'Self-hosted (advanced)', secret: false },
	{ name: 'RUNPOD_WORKFLOW_FILE', label: 'RunPod workflow file', group: 'Self-hosted (advanced)', secret: false },
	{
		name: 'COMFYUI_URL',
		label: 'ComfyUI server URL',
		group: 'Local models (advanced)',
		secret: false,
		help: 'Run Wan 2.2 video generation on your own GPU through ComfyUI. Default http://127.0.0.1:8188. A working workflow is copied to <data dir>/workflows/wan-i2v.json on first use; see the README for the model files to download. Then pick the ComfyUI backend below.'
	}
];

const KEY_NAMES = new Set(KEY_DEFINITIONS.map((k) => k.name));

let cache = null;

function load() {
	if (cache) return cache;
	const raw = readJson(getSettingsPath(), {});
	cache = {
		keys: raw?.keys && typeof raw.keys === 'object' ? raw.keys : {},
		preferences: raw?.preferences && typeof raw.preferences === 'object' ? raw.preferences : {}
	};
	return cache;
}

function persist() {
	writeJsonAtomic(getSettingsPath(), cache);
}

/** Resolve a secret or endpoint value by name. */
export function getSecret(name) {
	const s = load();
	const fromSettings = s.keys[name];
	if (typeof fromSettings === 'string' && fromSettings.trim()) return fromSettings.trim();
	const fromEnv = process.env[name];
	if (typeof fromEnv === 'string' && fromEnv.trim()) return fromEnv.trim();
	return undefined;
}

export function setSecrets(updates) {
	const s = load();
	for (const [name, value] of Object.entries(updates || {})) {
		if (!KEY_NAMES.has(name)) continue;
		if (value === null || value === '') delete s.keys[name];
		else if (typeof value === 'string') s.keys[name] = value.trim();
	}
	persist();
}

export function getPreference(name, fallback = undefined) {
	const s = load();
	return s.preferences[name] ?? fallback;
}

export function setPreferences(updates) {
	const s = load();
	Object.assign(s.preferences, updates || {});
	persist();
}

/** Public, masked view for the Settings UI. Never returns full secrets. */
export function describeSettings() {
	const s = load();
	return {
		dataDir: getDataDir(),
		preferences: s.preferences,
		keys: KEY_DEFINITIONS.map((def) => {
			const value = getSecret(def.name);
			const source = s.keys[def.name] ? 'settings' : value ? 'env' : null;
			const secret = def.secret !== false;
			return {
				...def,
				secret,
				configured: !!value,
				source,
				preview: value ? (secret ? maskSecret(value) : value) : ''
			};
		})
	};
}

function maskSecret(value) {
	if (value.length <= 8) return '••••';
	return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

/**
 * Drop-in replacement for SvelteKit's `$env/dynamic/private` `env` object.
 * Routes keep writing `env.REPLICATE_API_TOKEN`; this proxy consults
 * settings.json first and falls back to the real environment.
 */
export const env = new Proxy(
	{},
	{
		get(_t, prop) {
			if (typeof prop !== 'string') return undefined;
			return getSecret(prop);
		},
		has(_t, prop) {
			return typeof prop === 'string' && getSecret(prop) !== undefined;
		}
	}
);
