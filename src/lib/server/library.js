/**
 * The user's asset library — replaces the Firestore `files` collection.
 *
 * Items live in <dataDir>/db/files.json and mirror real folders and files
 * under <dataDir>/library, so the tree you see in the app is the tree you
 * see in Explorer / Finder.
 *
 * Item shape (same fields the UI already used with Firestore):
 *   { id, name, parentId, isFolder, url, thumbnailUrl, fileType,
 *     metadata, size, createdAt, updatedAt }
 */
import fs from 'node:fs';
import path from 'node:path';
import * as db from './db.js';
import {
	relPathToAbs,
	relPathToUrl,
	saveDataUrl,
	saveBuffer,
	urlToAbs,
	urlToRelPath,
	sanitizeRelPath,
	deleteLocalUrl,
	uniqueFileName,
	isLocalUrl
} from './localFiles.js';
import { getLibraryDir } from './paths.js';

const COL = 'files';
const THUMB_DIR = '.thumbs';
export const DEFAULT_FOLDERS = ['Characters', 'Creatures', 'Items', 'Scenery', 'Effects', 'Props'];

function sortItems(items) {
	return items.sort((a, b) => {
		if (a.isFolder && !b.isFolder) return -1;
		if (!a.isFolder && b.isFolder) return 1;
		return (a.name || '').localeCompare(b.name || '');
	});
}

function safeName(name) {
	const cleaned = String(name || '')
		.trim()
		.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
		.slice(0, 120);
	return cleaned || 'untitled';
}

/** Relative on-disk path of a folder item (root = ''). */
export function folderRelPath(folderId) {
	const segments = [];
	let current = folderId ? db.getDoc(COL, folderId) : null;
	let guard = 0;
	while (current && guard++ < 64) {
		segments.unshift(safeName(current.name));
		current = current.parentId ? db.getDoc(COL, current.parentId) : null;
	}
	return segments.join('/');
}

export function getItem(id) {
	return db.getDoc(COL, id);
}

export function getChildren(parentId = null) {
	return sortItems(db.listDocs(COL, (i) => (i.parentId || null) === (parentId || null)));
}

export function listAll() {
	return db.listDocs(COL);
}

export function ensureDefaultFolders() {
	if (getChildren(null).length > 0) return;
	for (const name of DEFAULT_FOLDERS) createFolder(null, name);
}

export function createFolder(parentId, name, metadata = {}) {
	const folderName = safeName(name);
	const parentRel = folderRelPath(parentId);
	const rel = parentRel ? `${parentRel}/${folderName}` : folderName;
	fs.mkdirSync(relPathToAbs(rel), { recursive: true });
	return db.addDoc(COL, {
		name: folderName,
		parentId: parentId || null,
		isFolder: true,
		url: null,
		thumbnailUrl: null,
		fileType: null,
		metadata: metadata || {},
		size: null
	});
}

/**
 * Store a file inside a folder from a data URL and index it.
 * @returns the created item
 */
export function createFileFromDataUrl(parentId, name, dataUrl, fileType = 'image', metadata = {}) {
	const { thumbnailUrl, thumbnailData, ...rest } = metadata || {};
	const parentRel = folderRelPath(parentId);
	const fileName = safeName(name);
	const rel = parentRel ? `${parentRel}/${fileName}` : fileName;
	const saved = saveDataUrl(dataUrl, rel);
	let thumb = thumbnailUrl || null;
	if (thumbnailData) {
		thumb = saveDataUrl(thumbnailData, `${THUMB_DIR}/${db.newId()}`).url;
	}
	return db.addDoc(COL, {
		name: path.basename(saved.relPath),
		parentId: parentId || null,
		isFolder: false,
		url: saved.url,
		thumbnailUrl: thumb,
		fileType,
		metadata: rest,
		size: saved.size
	});
}

/**
 * Index a file that already exists at a /local URL (e.g. produced by a route).
 * If the file lives outside the target folder it is moved in.
 */
export function createFileFromUrl(parentId, name, url, fileType = 'image', metadata = {}) {
	const { thumbnailUrl, size, ...rest } = metadata || {};
	let finalUrl = url;
	let finalSize = size || null;
	let finalName = safeName(name);

	if (isLocalUrl(url)) {
		const abs = urlToAbs(url);
		if (abs && fs.existsSync(abs)) {
			const parentRel = folderRelPath(parentId);
			const targetDirAbs = relPathToAbs(parentRel || '.');
			fs.mkdirSync(targetDirAbs, { recursive: true });
			if (!path.extname(finalName)) finalName += path.extname(abs);
			const expectedAbs = path.join(targetDirAbs, finalName);
			if (path.resolve(abs) !== path.resolve(expectedAbs)) {
				finalName = uniqueFileName(targetDirAbs, finalName);
				fs.renameSync(abs, path.join(targetDirAbs, finalName));
			}
			const rel = parentRel ? `${parentRel}/${finalName}` : finalName;
			finalUrl = relPathToUrl(rel);
			finalSize = fs.statSync(relPathToAbs(rel)).size;
		}
	}

	return db.addDoc(COL, {
		name: finalName,
		parentId: parentId || null,
		isFolder: false,
		url: finalUrl,
		thumbnailUrl: thumbnailUrl || null,
		fileType,
		metadata: rest,
		size: finalSize
	});
}

/** Upsert by (parentId + name). Returns { item, replaced }. */
export function upsertFileByName(parentId, name, url, fileType = 'image', metadata = {}) {
	const existing = db.listDocs(
		COL,
		(i) => !i.isFolder && (i.parentId || null) === (parentId || null) && i.name === safeName(name)
	)[0];
	if (existing) {
		if (existing.url && existing.url !== url) deleteLocalUrl(existing.url);
		const { thumbnailUrl, size, ...rest } = metadata || {};
		// Move the new file onto the existing item's path
		const moved = createFileFromUrl(parentId, name, url, fileType, { thumbnailUrl, size, ...rest });
		db.deleteDoc(COL, moved.id);
		const item = db.setDoc(
			COL,
			existing.id,
			{
				url: moved.url,
				thumbnailUrl: thumbnailUrl || null,
				fileType,
				metadata: rest,
				size: moved.size
			},
			{ merge: true }
		);
		return { item, replaced: true };
	}
	return { item: createFileFromUrl(parentId, name, url, fileType, metadata), replaced: false };
}

export function updateItem(id, updates) {
	const item = db.getDoc(COL, id);
	if (!item) return null;
	const patch = {};
	if (updates.metadata && typeof updates.metadata === 'object') {
		patch.metadata = { ...(item.metadata || {}), ...updates.metadata };
	}
	if (typeof updates.url === 'string') patch.url = updates.url;
	if (typeof updates.thumbnailUrl === 'string' || updates.thumbnailUrl === null) {
		patch.thumbnailUrl = updates.thumbnailUrl;
	}
	if (typeof updates.fileType === 'string') patch.fileType = updates.fileType;
	if (Number.isFinite(updates.size)) patch.size = updates.size;
	return db.setDoc(COL, id, patch, { merge: true });
}

export function renameItem(id, newName) {
	const item = db.getDoc(COL, id);
	if (!item) return null;
	const name = safeName(newName);
	if (name === item.name) return item;
	const parentRel = folderRelPath(item.parentId);
	const fromRel = parentRel ? `${parentRel}/${item.name}` : item.name;
	const toRel = parentRel ? `${parentRel}/${name}` : name;
	const fromAbs = relPathToAbs(fromRel);
	const toAbs = relPathToAbs(toRel);
	if (fs.existsSync(fromAbs)) {
		if (fs.existsSync(toAbs)) throw new Error('A file or folder with that name already exists');
		fs.renameSync(fromAbs, toAbs);
	}
	const patch = { name };
	if (!item.isFolder) patch.url = relPathToUrl(toRel);
	const updated = db.setDoc(COL, id, patch, { merge: true });
	if (item.isFolder) refreshUrlsUnder(id);
	return updated;
}

export function moveItem(id, newParentId) {
	const item = db.getDoc(COL, id);
	if (!item) return null;
	if (item.isFolder && isDescendant(newParentId, id)) throw new Error('Cannot move a folder into itself');
	const fromParentRel = folderRelPath(item.parentId);
	const toParentRel = folderRelPath(newParentId);
	const fromRel = fromParentRel ? `${fromParentRel}/${item.name}` : item.name;
	let name = item.name;
	const toDirAbs = relPathToAbs(toParentRel || '.');
	fs.mkdirSync(toDirAbs, { recursive: true });
	name = uniqueFileName(toDirAbs, name);
	const toRel = toParentRel ? `${toParentRel}/${name}` : name;
	const fromAbs = relPathToAbs(fromRel);
	if (fs.existsSync(fromAbs)) fs.renameSync(fromAbs, relPathToAbs(toRel));
	const patch = { parentId: newParentId || null, name };
	if (!item.isFolder) patch.url = relPathToUrl(toRel);
	const updated = db.setDoc(COL, id, patch, { merge: true });
	if (item.isFolder) refreshUrlsUnder(id);
	return updated;
}

function isDescendant(candidateId, ancestorId) {
	let cur = candidateId ? db.getDoc(COL, candidateId) : null;
	let guard = 0;
	while (cur && guard++ < 64) {
		if (cur.id === ancestorId) return true;
		cur = cur.parentId ? db.getDoc(COL, cur.parentId) : null;
	}
	return false;
}

function refreshUrlsUnder(folderId) {
	const rel = folderRelPath(folderId);
	for (const child of getChildren(folderId)) {
		if (child.isFolder) refreshUrlsUnder(child.id);
		else db.setDoc(COL, child.id, { url: relPathToUrl(`${rel}/${child.name}`) }, { merge: true });
	}
}

export function deleteItem(id) {
	const item = db.getDoc(COL, id);
	if (!item) return false;
	if (item.isFolder) {
		for (const child of getChildren(id)) deleteItem(child.id);
		const rel = folderRelPath(id);
		try {
			const abs = relPathToAbs(rel);
			if (rel && fs.existsSync(abs)) fs.rmSync(abs, { recursive: true, force: true });
		} catch (err) {
			console.warn('[library] folder delete failed:', err?.message);
		}
	} else {
		if (item.url) deleteLocalUrl(item.url);
		if (item.thumbnailUrl) deleteLocalUrl(item.thumbnailUrl);
	}
	return db.deleteDoc(COL, id);
}

/** Overwrite the bytes of an existing library file in place. */
export function replaceFileContents(url, dataUrl) {
	const rel = urlToRelPath(url);
	if (!rel) throw new Error('Not a local library URL');
	const saved = saveDataUrl(dataUrl, rel, { overwrite: true });
	const item = db.listDocs(COL, (i) => i.url === url)[0];
	if (item) db.setDoc(COL, item.id, { size: saved.size }, { merge: true });
	return saved;
}

/** Store a thumbnail (data URL) and return its URL. */
export function saveThumbnail(dataUrl) {
	return saveDataUrl(dataUrl, `${THUMB_DIR}/${db.newId()}`).url;
}

export { getLibraryDir, sanitizeRelPath, saveBuffer };
