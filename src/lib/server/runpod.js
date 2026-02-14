import { readFile } from 'node:fs/promises';
import path from 'node:path';

function getRunpodConfig() {
	const apiKey = process.env.RUNPOD_API_KEY;
	const endpointId = process.env.RUNPOD_ENDPOINT_ID;

	if (!apiKey) {
		throw new Error('RUNPOD_API_KEY is not set');
	}
	if (!endpointId) {
		throw new Error('RUNPOD_ENDPOINT_ID is not set');
	}

	return { apiKey, endpointId };
}

function runpodUrl(endpointId, suffix) {
	return `https://api.runpod.ai/v2/${endpointId}/${suffix}`;
}

export async function submitRunpodJob(input) {
	const { apiKey, endpointId } = getRunpodConfig();
	const res = await fetch(runpodUrl(endpointId, 'run'), {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${apiKey}`,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({ input })
	});

	const data = await res.json().catch(() => ({}));
	if (!res.ok) {
		throw new Error(data?.error || data?.message || `RunPod submit failed (${res.status})`);
	}
	return data;
}

export async function getRunpodJobStatus(jobId) {
	const { apiKey, endpointId } = getRunpodConfig();
	const res = await fetch(runpodUrl(endpointId, `status/${encodeURIComponent(jobId)}`), {
		headers: {
			Authorization: `Bearer ${apiKey}`
		}
	});

	const data = await res.json().catch(() => ({}));
	if (!res.ok) {
		throw new Error(data?.error || data?.message || `RunPod status failed (${res.status})`);
	}
	return data;
}

export function normalizeRunpodStatus(status) {
	const s = String(status || '').toUpperCase();
	if (s === 'IN_PROGRESS' || s === 'IN_QUEUE') return 'processing';
	if (s === 'COMPLETED') return 'completed';
	if (s === 'FAILED' || s === 'CANCELLED' || s === 'TIMED_OUT') return 'failed';
	return 'pending';
}

export function parseDataUrlImage(dataUrl, fieldName) {
	if (!dataUrl || typeof dataUrl !== 'string') {
		throw new Error(`${fieldName} is required`);
	}
	const match = dataUrl.match(/^data:([^;,]+);base64,(.+)$/s);
	if (!match) {
		throw new Error(`${fieldName} must be a base64 data URL`);
	}
	return { mimeType: match[1], data: match[2] };
}

export async function loadWorkflowTemplate() {
	const customPath = process.env.RUNPOD_WORKFLOW_FILE || 'static/keyframe_sdxl_openpose_depth_ipadapter.json';
	const fullPath = path.isAbsolute(customPath) ? customPath : path.resolve(process.cwd(), customPath);
	const raw = await readFile(fullPath, 'utf-8');
	return JSON.parse(raw);
}

export function replaceTemplatePlaceholders(value, replacements) {
	if (typeof value === 'string') {
		return Object.prototype.hasOwnProperty.call(replacements, value)
			? replacements[value]
			: value;
	}
	if (Array.isArray(value)) {
		return value.map((item) => replaceTemplatePlaceholders(item, replacements));
	}
	if (value && typeof value === 'object') {
		const next = {};
		for (const [k, v] of Object.entries(value)) {
			next[k] = replaceTemplatePlaceholders(v, replacements);
		}
		return next;
	}
	return value;
}

export function extractFirstImageUrl(payload) {
	const urls = [];

	function walk(node) {
		if (!node) return;
		if (typeof node === 'string' && /^https?:\/\//i.test(node)) {
			urls.push(node);
			return;
		}
		if (Array.isArray(node)) {
			node.forEach(walk);
			return;
		}
		if (typeof node === 'object') {
			Object.values(node).forEach(walk);
		}
	}

	walk(payload);
	return urls[0] || null;
}
