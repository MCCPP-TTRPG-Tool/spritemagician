/**
 * Local file storage under the data directory.
 *
 * Files are written under <dataDir>/library and served by the
 * /local/[...path] route, so a stored file's URL looks like
 *   /local/Characters/hero.png
 *
 * Anything that is not part of the user's visible library (provider inputs,
 * project frames, 3D uploads) goes under a dotted folder such as
 * /local/.projects/… so the file tree stays clean.
 */
import fs from 'node:fs';
import path from 'node:path';
import { getLibraryDir } from './paths.js';

export const LOCAL_URL_PREFIX = '/local/';

const EXT_BY_MIME = {
	'image/png': 'png',
	'image/jpeg': 'jpg',
	'image/gif': 'gif',
	'image/webp': 'webp',
	'image/svg+xml': 'svg',
	'video/mp4': 'mp4',
	'video/webm': 'webm',
	'application/json': 'json',
	'model/gltf-binary': 'glb',
	'model/gltf+json': 'gltf',
	'application/octet-stream': 'bin'
};

export const MIME_BY_EXT = {
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	gif: 'image/gif',
	webp: 'image/webp',
	svg: 'image/svg+xml',
	mp4: 'video/mp4',
	webm: 'video/webm',
	json: 'application/json',
	glb: 'model/gltf-binary',
	gltf: 'model/gltf+json',
	fbx: 'application/octet-stream',
	obj: 'text/plain',
	txt: 'text/plain'
};

export function isLocalUrl(url) {
	return typeof url === 'string' && url.startsWith(LOCAL_URL_PREFIX);
}

/** Normalise a relative library path: forward slashes, no leading slash, no '..'. */
export function sanitizeRelPath(relPath) {
	const parts = String(relPath || '')
		.replace(/\\/g, '/')
		.split('/')
		.map((p) => p.trim())
		.filter((p) => p && p !== '.' && p !== '..')
		.map((p) => p.replace(/[<>:"|?*\x00-\x1f]/g, '_'));
	return parts.join('/');
}

export function relPathToUrl(relPath) {
	return LOCAL_URL_PREFIX + sanitizeRelPath(relPath).split('/').map(encodeURIComponent).join('/');
}

export function urlToRelPath(url) {
	if (!isLocalUrl(url)) return null;
	const withoutQuery = url.split('?')[0].split('#')[0];
	const encoded = withoutQuery.slice(LOCAL_URL_PREFIX.length);
	return sanitizeRelPath(encoded.split('/').map((s) => {
		try { return decodeURIComponent(s); } catch { return s; }
	}).join('/'));
}

export function relPathToAbs(relPath) {
	const root = getLibraryDir();
	const abs = path.resolve(root, sanitizeRelPath(relPath));
	if (abs !== root && !abs.startsWith(root + path.sep)) {
		throw new Error('Path escapes library directory');
	}
	return abs;
}

export function urlToAbs(url) {
	const rel = urlToRelPath(url);
	return rel ? relPathToAbs(rel) : null;
}

export function parseDataUrl(dataUrl) {
	if (typeof dataUrl !== 'string') return null;
	if (!dataUrl.startsWith('data:')) {
		// Raw base64 — assume PNG
		return { mimeType: 'image/png', base64: dataUrl };
	}
	const comma = dataUrl.indexOf(',');
	if (comma === -1) return null;
	const header = dataUrl.slice(5, comma);
	const mimeType = header.split(';')[0] || 'application/octet-stream';
	return { mimeType, base64: dataUrl.slice(comma + 1) };
}

export function extForMime(mime, fallback = 'png') {
	return EXT_BY_MIME[mime] || fallback;
}

export function mimeForPath(p) {
	const ext = path.extname(p).slice(1).toLowerCase();
	return MIME_BY_EXT[ext] || 'application/octet-stream';
}

/** Pick a filename that does not collide inside `absDir`. */
export function uniqueFileName(absDir, fileName) {
	const ext = path.extname(fileName);
	const base = fileName.slice(0, fileName.length - ext.length);
	let candidate = fileName;
	let i = 2;
	while (fs.existsSync(path.join(absDir, candidate))) {
		candidate = `${base} (${i})${ext}`;
		i += 1;
	}
	return candidate;
}

/**
 * Write a buffer to the library and return its /local URL.
 * @param {Buffer} buffer
 * @param {string} relPath  e.g. 'Characters/hero.png'
 * @param {{overwrite?: boolean}} [opts]
 */
export function saveBuffer(buffer, relPath, opts = {}) {
	const abs = relPathToAbs(relPath);
	fs.mkdirSync(path.dirname(abs), { recursive: true });
	let finalAbs = abs;
	if (!opts.overwrite && fs.existsSync(abs)) {
		finalAbs = path.join(path.dirname(abs), uniqueFileName(path.dirname(abs), path.basename(abs)));
	}
	fs.writeFileSync(finalAbs, buffer);
	const finalRel = path.relative(getLibraryDir(), finalAbs).replace(/\\/g, '/');
	return { url: relPathToUrl(finalRel), relPath: finalRel, absPath: finalAbs, size: buffer.length };
}

/**
 * Save a data URL (or raw base64) to the library.
 * If `relPath` has no extension one is added from the MIME type.
 */
export function saveDataUrl(dataUrl, relPath, opts = {}) {
	const parsed = parseDataUrl(dataUrl);
	if (!parsed) throw new Error('Invalid data URL');
	let target = sanitizeRelPath(relPath);
	if (!path.extname(target)) target += `.${extForMime(parsed.mimeType)}`;
	return saveBuffer(Buffer.from(parsed.base64, 'base64'), target, opts);
}

export function deleteLocalUrl(url) {
	try {
		const abs = urlToAbs(url);
		if (abs && fs.existsSync(abs)) fs.unlinkSync(abs);
	} catch (err) {
		console.warn('[localFiles] delete failed:', err?.message || err);
	}
}

export function readLocalUrl(url) {
	const abs = urlToAbs(url);
	if (!abs || !fs.existsSync(abs)) return null;
	return { buffer: fs.readFileSync(abs), mimeType: mimeForPath(abs), absPath: abs };
}

export function localUrlToDataUrl(url) {
	const file = readLocalUrl(url);
	if (!file) return null;
	return `data:${file.mimeType};base64,${file.buffer.toString('base64')}`;
}

/**
 * Convert an image reference into something a remote AI provider can consume.
 * Replicate and RunPod both accept data URLs, and they cannot reach files on
 * this machine, so local URLs are inlined as base64.
 */
export async function resolveForProvider(ref) {
	if (!ref || typeof ref !== 'string') return ref;
	if (ref.startsWith('data:')) return ref;
	if (isLocalUrl(ref)) {
		const dataUrl = localUrlToDataUrl(ref);
		if (!dataUrl) throw new Error(`Local file not found: ${ref}`);
		return dataUrl;
	}
	return ref; // remote http(s) URL — provider can fetch it directly
}

/**
 * Turn any image reference (data URL, local URL, remote URL) into a Buffer.
 */
export async function fetchImageBuffer(ref) {
	if (ref.startsWith('data:')) {
		const parsed = parseDataUrl(ref);
		return { buffer: Buffer.from(parsed.base64, 'base64'), mimeType: parsed.mimeType };
	}
	if (isLocalUrl(ref)) {
		const file = readLocalUrl(ref);
		if (!file) throw new Error(`Local file not found: ${ref}`);
		return { buffer: file.buffer, mimeType: file.mimeType };
	}
	const res = await fetch(ref);
	if (!res.ok) throw new Error(`Failed to fetch ${ref}: ${res.status}`);
	return {
		buffer: Buffer.from(await res.arrayBuffer()),
		mimeType: res.headers.get('content-type') || 'application/octet-stream'
	};
}

// ── Convenience wrappers used by the API routes ──────────────

/**
 * uploadImage(imageData, filename) -> /local URL.
 * Paths like `users/<uid>/x/y.png` are flattened to `.uploads/x/y.png`.
 */
export async function uploadImage(imageData, filename = null) {
	let rel = filename ? sanitizeRelPath(filename) : `.uploads/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
	rel = rel.replace(/^users\/[^/]+\//, '');
	if (!rel.startsWith('.')) rel = `.uploads/${rel}`;
	const saved = saveDataUrl(imageData, rel, { overwrite: true });
	return saved.url;
}

export async function deleteImage(url) {
	deleteLocalUrl(url);
}

/**
 * fetch() that also understands /local URLs. Returns a standard Response.
 */
export async function fetchLocalOrRemote(url) {
	if (isLocalUrl(url)) {
		const file = readLocalUrl(url);
		if (!file) return new Response('Not found', { status: 404 });
		return new Response(file.buffer, {
			status: 200,
			headers: { 'content-type': file.mimeType, 'content-length': String(file.buffer.length) }
		});
	}
	return fetch(url);
}

/**
 * Walk a parsed request body and replace every /local URL string with the
 * file's data URL, so provider routes never have to know about local storage.
 * Walks plain objects and arrays up to a small depth; skips keys whose name
 * suggests a 3D model (those stay as URLs and are handled per route).
 */
export function inlineLocalInputs(value, depth = 0) {
	if (depth > 4 || value === null || value === undefined) return value;
	if (typeof value === 'string') {
		if (!isLocalUrl(value)) return value;
		const dataUrl = localUrlToDataUrl(value);
		if (!dataUrl) throw new Error(`Local file not found: ${value}`);
		return dataUrl;
	}
	if (Array.isArray(value)) return value.map((v) => inlineLocalInputs(v, depth + 1));
	if (typeof value === 'object') {
		const out = {};
		for (const [k, v] of Object.entries(value)) {
			out[k] = /model/i.test(k) ? v : inlineLocalInputs(v, depth + 1);
		}
		return out;
	}
	return value;
}
