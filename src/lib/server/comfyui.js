/**
 * ComfyUI backend — run a user-supplied workflow on a local ComfyUI server.
 *
 * Set COMFYUI_URL in Settings (default http://127.0.0.1:8188) and put an
 * API-format workflow at <dataDir>/workflows/wan-i2v.json. The workflow may
 * use these placeholders anywhere in a string value:
 *   {{IMAGE}}        filename of the uploaded input image
 *   {{PROMPT}}       the prompt
 *   {{SEED}}         integer seed
 *   {{NUM_FRAMES}}   frame count
 *   {{FPS}}          frames per second
 * The first video/gif/webp output found in the history is returned.
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { getDataDir } from './paths.js';
import { env } from './settings.js';
import { saveBuffer, parseDataUrl, extForMime } from './localFiles.js';

export function comfyBaseUrl() {
	return (env.COMFYUI_URL || 'http://127.0.0.1:8188').replace(/\/+$/, '');
}

export function workflowPath(name = 'wan-i2v') {
	return path.join(getDataDir(), 'workflows', `${name}.json`);
}

export function loadWorkflow(name = 'wan-i2v') {
	const p = workflowPath(name);
	if (!fs.existsSync(p)) {
		throw new Error(`ComfyUI workflow not found. Export your workflow in API format and save it as ${p}`);
	}
	return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function substitute(value, vars) {
	if (typeof value === 'string') {
		if (vars[value.replace(/^\{\{|\}\}$/g, '')] !== undefined && /^\{\{[A-Z_]+\}\}$/.test(value)) {
			return vars[value.slice(2, -2)];
		}
		return value.replace(/\{\{([A-Z_]+)\}\}/g, (m, k) => (vars[k] !== undefined ? String(vars[k]) : m));
	}
	if (Array.isArray(value)) return value.map((v) => substitute(v, vars));
	if (value && typeof value === 'object') {
		const out = {};
		for (const [k, v] of Object.entries(value)) out[k] = substitute(v, vars);
		return out;
	}
	return value;
}

export async function uploadImage(dataUrl) {
	const parsed = parseDataUrl(dataUrl);
	if (!parsed) throw new Error('ComfyUI upload needs a data URL');
	const name = `sm-${randomUUID().slice(0, 8)}.${extForMime(parsed.mimeType)}`;
	const form = new FormData();
	form.append('image', new Blob([Buffer.from(parsed.base64, 'base64')], { type: parsed.mimeType }), name);
	form.append('overwrite', 'true');
	const res = await fetch(`${comfyBaseUrl()}/upload/image`, { method: 'POST', body: form });
	if (!res.ok) throw new Error(`ComfyUI upload failed (${res.status})`);
	const data = await res.json();
	return data.name || name;
}

/**
 * Queue a workflow and wait for it. Returns a /local URL of the output video.
 * @param {{workflow?: string, vars: object, signal?: AbortSignal, maxMs?: number, onTick?: (status: string) => void}} opts
 */
export async function runVideoWorkflow({ workflow = 'wan-i2v', vars, signal, maxMs = 20 * 60 * 1000, onTick }) {
	const base = comfyBaseUrl();
	const prompt = substitute(loadWorkflow(workflow), vars);
	const clientId = randomUUID();

	const queued = await fetch(`${base}/prompt`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ prompt, client_id: clientId }),
		signal
	});
	if (!queued.ok) throw new Error(`ComfyUI rejected the workflow (${queued.status}): ${(await queued.text()).slice(0, 300)}`);
	const { prompt_id: promptId } = await queued.json();
	if (!promptId) throw new Error('ComfyUI returned no prompt id');

	const started = Date.now();
	while (Date.now() - started < maxMs) {
		if (signal?.aborted) throw new Error('Cancelled');
		await new Promise((r) => setTimeout(r, 2000));
		const hist = await fetch(`${base}/history/${promptId}`, { signal });
		if (!hist.ok) continue;
		const data = await hist.json();
		const entry = data[promptId];
		if (!entry) {
			onTick?.('queued');
			continue;
		}
		if (entry.status?.status_str === 'error') {
			throw new Error('ComfyUI workflow failed: ' + JSON.stringify(entry.status.messages || []).slice(0, 300));
		}
		const outputs = entry.outputs || {};
		for (const node of Object.values(outputs)) {
			const files = [...(node.gifs || []), ...(node.videos || []), ...(node.images || [])];
			const file = files.find((f) => /\.(mp4|webm|gif|webp)$/i.test(f.filename));
			if (file) {
				const q = new URLSearchParams({ filename: file.filename, subfolder: file.subfolder || '', type: file.type || 'output' });
				const bin = await fetch(`${base}/view?${q}`, { signal });
				if (!bin.ok) throw new Error('Could not download ComfyUI output');
				const buffer = Buffer.from(await bin.arrayBuffer());
				const saved = saveBuffer(buffer, `.uploads/comfy-${Date.now()}-${file.filename}`);
				return saved.url;
			}
		}
		onTick?.('running');
	}
	throw new Error('ComfyUI workflow timed out');
}
