/**
 * Style Anchor — Master Style Image management
 *
 * Ensures every generation request carries a consistent "style DNA" image.
 *
 * Resolution order:
 *  1. In-memory cache
 *  2. User-chosen style  (<library>/.style/master-style.*, recorded in the local db)
 *  3. Bundled fallback   static/Example images/*
 */

import fs from 'fs';
import path from 'path';
import * as db from './db.js';
import { saveBuffer, readLocalUrl, extForMime } from './localFiles.js';
import { getExampleImagesDir } from './resources.js';

const CONFIG_COLLECTION = 'config';
const CONFIG_ID = 'styleAnchor';
const CACHE_TTL_MS = 60 * 60 * 1000;

let cache = { data: null, timestamp: 0 };

/**
 * @typedef {Object} StyleData
 * @property {string}  base64
 * @property {string}  mimeType
 * @property {string}  source    - 'user' | 'local'
 * @property {string}  name
 * @property {string}  [updatedAt]
 */

/** @returns {Promise<StyleData|null>} */
export async function getMasterStyle() {
	if (cache.data && Date.now() - cache.timestamp < CACHE_TTL_MS) {
		return cache.data;
	}
	const user = tryUserStyle();
	if (user) return user;
	return loadLocalStyle();
}

/**
 * Save a new master style image.
 * @param {string} base64Data
 * @param {string} mimeType
 * @returns {Promise<{publicUrl: string, storagePath: string}>}
 */
export async function setMasterStyle(base64Data, mimeType) {
	const buffer = Buffer.from(base64Data, 'base64');
	const saved = saveBuffer(buffer, `.style/master-style.${extForMime(mimeType)}`, { overwrite: true });
	db.setDoc(CONFIG_COLLECTION, CONFIG_ID, {
		storagePath: saved.relPath,
		publicUrl: saved.url,
		mimeType,
		name: 'Master Style',
		updatedAt: new Date().toISOString()
	});
	clearStyleCache();
	console.log('[StyleAnchor] Master style updated');
	return { publicUrl: saved.url, storagePath: saved.relPath };
}

export async function getStyleConfig() {
	const cfg = db.getDoc(CONFIG_COLLECTION, CONFIG_ID);
	if (cfg?.publicUrl) {
		return {
			publicUrl: cfg.publicUrl,
			mimeType: cfg.mimeType,
			name: cfg.name,
			updatedAt: cfg.updatedAt,
			source: 'user'
		};
	}
	const dir = getExampleImagesDir();
	try {
		const files = fs.readdirSync(dir).filter((f) => /\.(jpg|jpeg|png|webp)$/i.test(f));
		if (files.length > 0) return { name: files[0], source: 'local' };
	} catch {
		/* no local files */
	}
	return null;
}

export function clearStyleCache() {
	cache = { data: null, timestamp: 0 };
}

function tryUserStyle() {
	try {
		const cfg = db.getDoc(CONFIG_COLLECTION, CONFIG_ID);
		if (!cfg?.publicUrl) return null;
		const file = readLocalUrl(cfg.publicUrl);
		if (!file) return null;
		return cacheAndReturn({
			base64: file.buffer.toString('base64'),
			mimeType: cfg.mimeType || file.mimeType,
			source: 'user',
			name: cfg.name || 'Master Style',
			updatedAt: cfg.updatedAt
		});
	} catch (err) {
		console.warn('[StyleAnchor] user style read failed:', err.message);
		return null;
	}
}

function loadLocalStyle() {
	const dir = getExampleImagesDir();
	try {
		const files = fs.readdirSync(dir).filter((f) => /\.(jpg|jpeg|png|webp)$/i.test(f)).sort();
		if (files.length === 0) return null;
		const file = files[0];
		const buffer = fs.readFileSync(path.join(dir, file));
		const ext = path.extname(file).toLowerCase();
		const mimeType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
		return cacheAndReturn({ base64: buffer.toString('base64'), mimeType, source: 'local', name: file });
	} catch (err) {
		console.warn('[StyleAnchor] No local style images:', err.message);
		return null;
	}
}

function cacheAndReturn(data) {
	cache = { data, timestamp: Date.now() };
	return data;
}
