/**
 * Client-side library API.
 *
 * Same function names the UI used with Firestore, now backed by
 * /api/library and /api/jobs. The `uid` argument is accepted and ignored
 * so call sites did not have to change.
 *
 * Change notifications: every mutation emits `libraryChanged`; the
 * userFiles store listens and refetches. A slow poll covers edits made
 * outside the app (e.g. dropping files into the folder).
 */
import { browser } from '$app/environment';

const listeners = new Set();

export function onLibraryChanged(fn) {
	listeners.add(fn);
	return () => listeners.delete(fn);
}

function emitChange() {
	for (const fn of listeners) {
		try { fn(); } catch { /* ignore */ }
	}
}

async function call(action, payload = {}) {
	const res = await fetch('/api/library', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ action, ...payload })
	});
	const data = await res.json().catch(() => ({}));
	if (!res.ok) throw new Error(data.error || `Library ${action} failed`);
	emitChange();
	return data;
}

async function jobsCall(action, payload = {}) {
	const res = await fetch('/api/jobs', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ action, ...payload })
	});
	const data = await res.json().catch(() => ({}));
	if (!res.ok) throw new Error(data.error || `Jobs ${action} failed`);
	return data;
}

// ═══════════════════════ FILE TREE ═══════════════════════

export async function createFolder(_uid, parentId, name, metadata = {}) {
	const { id } = await call('createFolder', { parentId, name, metadata });
	return id;
}

/** url may be a /local URL from an upload route or a data URL. */
export async function createFile(_uid, parentId, name, url, fileType = 'image', metadata = {}) {
	const { id } = await call('createFile', { parentId, name, url, fileType, metadata });
	return id;
}

export async function upsertFileByName(_uid, parentId, name, url, fileType = 'image', metadata = {}) {
	const { id, replaced } = await call('upsertFileByName', { parentId, name, url, fileType, metadata });
	return { id, replaced };
}

export async function getChildren(_uid, parentId = null) {
	const res = await fetch(`/api/library?parentId=${encodeURIComponent(parentId ?? 'null')}`);
	const data = await res.json();
	return data.items || [];
}

export async function getAllItems() {
	const res = await fetch('/api/library?all=1');
	const data = await res.json();
	return data.items || [];
}

/**
 * Pseudo real-time listener: fetch now, refetch on local changes and on a
 * slow poll. Returns an unsubscribe function.
 */
export function subscribeToChildren(_uid, parentId, callback, { pollMs = 4000 } = {}) {
	if (!browser) { callback([]); return () => {}; }
	let alive = true;
	let lastJson = '';
	const refresh = async () => {
		try {
			const items = await getChildren(null, parentId);
			if (!alive) return;
			const snapshot = JSON.stringify(items);
			if (snapshot !== lastJson) {
				lastJson = snapshot;
				callback(items);
			}
		} catch (err) {
			console.error('[library] subscribeToChildren error:', err);
			if (alive) callback([]);
		}
	};
	refresh();
	const off = onLibraryChanged(refresh);
	const timer = setInterval(refresh, pollMs);
	return () => {
		alive = false;
		off();
		clearInterval(timer);
	};
}

export async function renameItem(_uid, fileId, newName) {
	await call('rename', { id: fileId, name: newName });
}

export async function moveItem(_uid, fileId, newParentId) {
	await call('move', { id: fileId, parentId: newParentId });
}

export async function updateItem(_uid, fileId, updates) {
	await call('update', { id: fileId, updates });
}

export async function updateFolderChromaKey(_uid, fileId, chromaKeyHex) {
	await call('update', { id: fileId, updates: { metadata: { chromaKeyHex } } });
}

export async function deleteItem(_uid, fileId) {
	await call('delete', { id: fileId });
}

export async function deleteFolderRecursive(_uid, folderId) {
	await call('delete', { id: folderId });
}

export async function getItem(_uid, fileId) {
	const res = await fetch(`/api/library?id=${encodeURIComponent(fileId)}`);
	const data = await res.json();
	return data.item || null;
}

export async function initializeDefaultFolders() {
	await call('ensureDefaults');
}

export function notifyLibraryChanged() {
	emitChange();
}

// ═══════════════════════ JOBS ═══════════════════════

export async function upsertJobLog(_uid, jobId, payload = {}) {
	if (!jobId) return;
	await jobsCall('upsert', { jobId, payload });
}

export async function deleteJobLog(_uid, jobId) {
	if (!jobId) return;
	await jobsCall('delete', { jobId });
}

export async function clearFinishedJobs() {
	await jobsCall('clearFinished');
}

export async function saveEditClusterJob(_uid, clusterId, job) {
	if (!clusterId || !job?.id) return;
	await jobsCall('saveEditCluster', { clusterId, job });
}

export async function listJobs() {
	const res = await fetch('/api/jobs');
	const data = await res.json();
	return data.jobs || [];
}
