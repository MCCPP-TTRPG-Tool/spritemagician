/**
 * Style Anchor — Master Style Image management
 *
 * Ensures every generation request carries a consistent "style DNA" image
 * so outputs always match the 16-bit HoMM3 pixel-art aesthetic.
 *
 * Resolution order:
 *  1. In-memory cache (hot path, < 1 ms)
 *  2. Firestore  config/styleAnchor  document (stores base64 inline)
 *  3. Firebase Storage  style-anchor/master-style.png
 *  4. Local fallback  static/Example images/*
 */

import { getAdminDb, getAdminStorage } from '$lib/firebase/admin.js';
import fs from 'fs';
import path from 'path';

// ─── Config ──────────────────────────────────────────────────
const FIRESTORE_DOC = 'config/styleAnchor';
const STORAGE_PATH = 'style-anchor/master-style.png';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

/** @type {{ data: StyleData|null, timestamp: number }} */
let cache = { data: null, timestamp: 0 };

/**
 * @typedef {Object} StyleData
 * @property {string}  base64    - Raw base64 (no data-URL prefix)
 * @property {string}  mimeType  - e.g. image/png
 * @property {string}  source    - 'firestore' | 'storage' | 'local'
 * @property {string}  name      - Human-readable label
 * @property {string}  [updatedAt]
 */

// ─── Public API ──────────────────────────────────────────────

/**
 * Load the current master style image.
 * Returns cached data when available; otherwise fetches from Firestore → Storage → local.
 *
 * @returns {Promise<StyleData|null>}
 */
export async function getMasterStyle() {
	if (cache.data && Date.now() - cache.timestamp < CACHE_TTL_MS) {
		return cache.data;
	}

	// 1. Firestore
	const firestoreResult = await tryFirestore();
	if (firestoreResult) return firestoreResult;

	// 2. Local fallback
	return loadLocalStyle();
}

/**
 * Upload a new master style image. Updates both Storage and Firestore.
 *
 * @param {string} base64Data  - Raw base64 image bytes
 * @param {string} mimeType    - e.g. image/png
 * @param {string} userId      - UID of the user performing the swap
 * @returns {Promise<{publicUrl: string, storagePath: string}>}
 */
export async function setMasterStyle(base64Data, mimeType, userId) {
	const db = getAdminDb();
	const storage = getAdminStorage();

	// Upload to Storage
	const buffer = Buffer.from(base64Data, 'base64');
	const file = storage.file(STORAGE_PATH);
	await file.save(buffer, {
		metadata: { contentType: mimeType },
		public: true,
	});
	await file.makePublic();

	const publicUrl = `https://storage.googleapis.com/${storage.name}/${STORAGE_PATH}`;

	// Persist config + inline base64 in Firestore for fast reads
	await db.doc(FIRESTORE_DOC).set({
		storagePath: STORAGE_PATH,
		publicUrl,
		mimeType,
		imageBase64: base64Data,
		updatedAt: new Date().toISOString(),
		updatedBy: userId,
		name: 'Master Style',
	});

	// Invalidate cache so next request picks up the new style
	clearStyleCache();
	console.log(`[StyleAnchor] Master style updated by ${userId}`);

	return { publicUrl, storagePath: STORAGE_PATH };
}

/**
 * Return metadata about the current style (no image bytes).
 * @returns {Promise<Object|null>}
 */
export async function getStyleConfig() {
	try {
		const db = getAdminDb();
		const doc = await db.doc(FIRESTORE_DOC).get();
		if (doc.exists) {
			const d = doc.data();
			return {
				publicUrl: d.publicUrl,
				mimeType: d.mimeType,
				name: d.name,
				updatedAt: d.updatedAt,
				updatedBy: d.updatedBy,
				source: 'firestore',
			};
		}
	} catch (_) {
		/* fall through */
	}

	// Check local
	const dir = path.resolve('static/Example images');
	try {
		const files = fs.readdirSync(dir).filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f));
		if (files.length > 0) {
			return { name: files[0], source: 'local' };
		}
	} catch (_) {
		/* no local files */
	}
	return null;
}

/** Invalidate the in-memory cache (called after a style swap). */
export function clearStyleCache() {
	cache = { data: null, timestamp: 0 };
}

// ─── Internal Loaders ────────────────────────────────────────

/** @returns {Promise<StyleData|null>} */
async function tryFirestore() {
	try {
		const db = getAdminDb();
		const doc = await db.doc(FIRESTORE_DOC).get();
		if (!doc.exists) return null;

		const cfg = doc.data();

		// Prefer inline base64 (fastest)
		if (cfg.imageBase64) {
			return cacheAndReturn({
				base64: cfg.imageBase64,
				mimeType: cfg.mimeType || 'image/png',
				source: 'firestore',
				name: cfg.name || 'Master Style',
				updatedAt: cfg.updatedAt,
			});
		}

		// Otherwise download from Storage
		if (cfg.storagePath) {
			const storage = getAdminStorage();
			const [buffer] = await storage.file(cfg.storagePath).download();
			return cacheAndReturn({
				base64: buffer.toString('base64'),
				mimeType: cfg.mimeType || 'image/png',
				source: 'storage',
				name: cfg.name || 'Master Style',
				updatedAt: cfg.updatedAt,
			});
		}
	} catch (err) {
		console.warn('[StyleAnchor] Firestore read failed:', err.message);
	}
	return null;
}

/** @returns {StyleData|null} */
function loadLocalStyle() {
	const dir = path.resolve('static/Example images');
	try {
		const files = fs
			.readdirSync(dir)
			.filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f))
			.sort();
		if (files.length === 0) return null;

		const file = files[0];
		const buffer = fs.readFileSync(path.join(dir, file));
		const ext = path.extname(file).toLowerCase();
		const mimeType =
			ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';

		const result = cacheAndReturn({
			base64: buffer.toString('base64'),
			mimeType,
			source: 'local',
			name: file,
		});
		console.log(`[StyleAnchor] Loaded local fallback: ${file}`);
		return result;
	} catch (err) {
		console.warn('[StyleAnchor] No local style images:', err.message);
		return null;
	}
}

/**
 * Write to cache and return.
 * @param {StyleData} data
 * @returns {StyleData}
 */
function cacheAndReturn(data) {
	cache = { data, timestamp: Date.now() };
	return data;
}
