/**
 * Client-side library API.
 *
 * Library client for the UI, backed by
 * /api/library and /api/jobs. The `uid` argument is accepted and ignored
 * so call sites did not have to change.
 *
 * Change notifications: every mutation emits `libraryChanged`; the
 * userFiles store listens and refetches. A slow poll (paused while the
 * window is hidden) covers edits made outside the app, and a rescan runs
 * when the window regains focus so files dropped into the folder appear.
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

async function post(endpoint, action, payload = {}) {
	const res = await fetch(endpoint, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ action, ...payload })
	});
	const data = await res.json().catch(() => ({}));
	if (!res.ok) throw new Error(data.error || `${action} failed`);
	return data;
}

async function call(action, payload) {
	const data = await post('/api/library', action, payload);
	emitChange();
	return data;
}

const jobsCall = (action, payload) => post('/api/jobs', action, payload);

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
	if (!res.ok) throw new Error(`Library request failed (${res.status})`);
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
 * slow poll while the window is visible. Returns an unsubscribe function.
 * On a failed fetch the last good list is kept and `onError` is called.
 */
export function subscribeToChildren(_uid, parentId, callback, { pollMs = 5000, onError } = {}) {
	if (!browser) { callback([]); return () => {}; }
	let alive = true;
	let lastJson = null;
	const refresh = async () => {
		if (!alive) return;
		try {
			const items = await getChildren(null, parentId);
			if (!alive) return;
			const snapshot = JSON.stringify(items);
			if (snapshot !== lastJson) {
				lastJson = snapshot;
				callback(items);
			}
		} catch (err) {
			console.error('[library] refresh failed:', err);
			onError?.(err);
		}
	};
	const tick = () => {
		if (typeof document !== 'undefined' && document.hidden) return;
		refresh();
	};
	refresh();
	const off = onLibraryChanged(refresh);
	const timer = setInterval(tick, pollMs);
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

/** Reconcile the index with files added or removed outside the app. */
export async function rescanLibrary() {
	return call('rescan');
}

/** Open the file or folder in Explorer / Finder. */
export async function revealItem(_uid, fileId) {
	await post('/api/library', 'reveal', { id: fileId });
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
