/**
 * Client-side Firestore CRUD for file tree and jobs
 *
 * ┌──────────────────────────────────────────────────────────────┐
 * │  IMPORTANT — Deploy these Firestore security rules:          │
 * │                                                              │
 * │  rules_version = '2';                                        │
 * │  service cloud.firestore {                                   │
 * │    match /databases/{database}/documents {                   │
 * │      match /users/{userId}/{document=**} {                   │
 * │        allow read, write:                                    │
 * │          if request.auth != null                             │
 * │          && request.auth.uid == userId;                      │
 * │      }                                                       │
 * │    }                                                         │
 * │  }                                                           │
 * └──────────────────────────────────────────────────────────────┘
 */
import { db } from './client.js';
import {
	collection, doc, addDoc, updateDoc, deleteDoc,
	getDocs, getDoc, query, where, orderBy, setDoc,
	onSnapshot, serverTimestamp, writeBatch
} from 'firebase/firestore';

// ═══════════════════════════════════════════════════════════════
// FILE TREE
// ═══════════════════════════════════════════════════════════════

const filesCol = (uid) => collection(db, 'users', uid, 'files');
const fileDoc  = (uid, id) => doc(db, 'users', uid, 'files', id);

/**
 * Create a folder
 * @returns {Promise<string>} New document ID
 */
export async function createFolder(uid, parentId, name) {
	const ref = await addDoc(filesCol(uid), {
		name,
		parentId: parentId || null,
		isFolder: true,
		url: null,
		thumbnailUrl: null,
		fileType: null,
		metadata: {},
		size: null,
		createdAt: serverTimestamp(),
		updatedAt: serverTimestamp()
	});
	return ref.id;
}

/**
 * Create a file entry (call after uploading binary to Storage)
 * @param {string} uid
 * @param {string|null} parentId
 * @param {string} name
 * @param {string} url       Public Storage URL
 * @param {'image'|'animation'|'video'} fileType
 * @param {object} metadata  Extra fields (prompt, style, fps …)
 * @returns {Promise<string>} New document ID
 */
export async function createFile(uid, parentId, name, url, fileType = 'image', metadata = {}) {
	const { thumbnailUrl, size, ...rest } = metadata;
	const ref = await addDoc(filesCol(uid), {
		name,
		parentId: parentId || null,
		isFolder: false,
		url,
		thumbnailUrl: thumbnailUrl || null,
		fileType,
		metadata: { ...rest },
		size: size || null,
		createdAt: serverTimestamp(),
		updatedAt: serverTimestamp()
	});
	return ref.id;
}

/**
 * Upsert a file by (parentId + exact name).
 * If a file with same name exists in the same folder, update its URL/metadata.
 * Otherwise create a new file document.
 * @returns {Promise<{id: string, replaced: boolean}>}
 */
export async function upsertFileByName(uid, parentId, name, url, fileType = 'image', metadata = {}) {
	const { thumbnailUrl, size, ...rest } = metadata;
	const q = query(
		filesCol(uid),
		where('parentId', '==', parentId || null),
		where('name', '==', name),
		where('isFolder', '==', false)
	);
	const snap = await getDocs(q);
	if (!snap.empty) {
		const existing = snap.docs[0];
		await updateDoc(existing.ref, {
			url,
			thumbnailUrl: thumbnailUrl || null,
			fileType,
			metadata: { ...rest },
			size: size || null,
			updatedAt: serverTimestamp()
		});
		return { id: existing.id, replaced: true };
	}

	const id = await createFile(uid, parentId, name, url, fileType, metadata);
	return { id, replaced: false };
}

/**
 * One-shot fetch of children (sorted folders-first, then A-Z)
 */
export async function getChildren(uid, parentId = null) {
	const q = query(filesCol(uid), where('parentId', '==', parentId));
	const snap = await getDocs(q);
	return sortItems(snap.docs.map(d => ({ id: d.id, ...d.data() })));
}

/**
 * Real-time listener for children.  Returns unsubscribe function.
 */
export function subscribeToChildren(uid, parentId, callback) {
	if (!uid) { callback([]); return () => {}; }
	const q = query(filesCol(uid), where('parentId', '==', parentId ?? null));
	return onSnapshot(q, (snap) => {
		callback(sortItems(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
	}, (err) => {
		console.error('[Firestore] subscribeToChildren error:', err);
		callback([]);
	});
}

/** Rename */
export async function renameItem(uid, fileId, newName) {
	await updateDoc(fileDoc(uid, fileId), { name: newName, updatedAt: serverTimestamp() });
}

/** Move to another parent */
export async function moveItem(uid, fileId, newParentId) {
	await updateDoc(fileDoc(uid, fileId), { parentId: newParentId || null, updatedAt: serverTimestamp() });
}

/** Update folder chroma key metadata */
export async function updateFolderChromaKey(uid, fileId, chromaKeyHex) {
	await updateDoc(fileDoc(uid, fileId), {
		'metadata.chromaKeyHex': chromaKeyHex,
		updatedAt: serverTimestamp()
	});
}

/** Delete a single file */
export async function deleteItem(uid, fileId) {
	await deleteDoc(fileDoc(uid, fileId));
}

/** Recursively delete a folder and everything inside it */
export async function deleteFolderRecursive(uid, folderId) {
	const children = await getChildren(uid, folderId);
	for (const child of children) {
		if (child.isFolder) {
			await deleteFolderRecursive(uid, child.id);
		} else {
			await deleteDoc(fileDoc(uid, child.id));
		}
	}
	await deleteDoc(fileDoc(uid, folderId));
}

/** Fetch a single item */
export async function getItem(uid, fileId) {
	const snap = await getDoc(fileDoc(uid, fileId));
	return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

/**
 * Create default top-level folders for brand-new users.
 * No-ops if any root children already exist.
 */
export async function initializeDefaultFolders(uid) {
	const existing = await getChildren(uid, null);
	if (existing.length > 0) return;

	const names = ['Characters', 'Creatures', 'Items', 'Scenery', 'Effects', 'Props'];
	for (const n of names) await createFolder(uid, null, n);
	console.log('[Firestore] Default folders created for', uid);
}

// ═══════════════════════════════════════════════════════════════
// JOBS
// ═══════════════════════════════════════════════════════════════

const jobsCol = (uid) => collection(db, 'users', uid, 'jobs');
const jobDoc  = (uid, id) => doc(db, 'users', uid, 'jobs', id);
const editClustersCol = (uid) => collection(db, 'users', uid, 'edit_clusters');
const editClusterDoc = (uid, clusterId) => doc(db, 'users', uid, 'edit_clusters', clusterId);
const editClusterJobsDoc = (uid, clusterId, jobId) =>
	doc(db, 'users', uid, 'edit_clusters', clusterId, 'jobs', jobId);

/** Create a generation job */
export async function createJob(uid, data) {
	const ref = await addDoc(jobsCol(uid), {
		type:           data.type           || 'sprite',
		status:         'queued',
		name:           data.name           || 'Generation',
		prompt:         data.prompt         || '',
		model:          data.model          || null,
		progress:       0,
		message:        null,
		resultUrl:      null,
		resultFrames:   [],
		videoUrl:       null,
		error:          null,
		targetFolderId: data.targetFolderId || null,
		createdAt:      serverTimestamp(),
		updatedAt:      serverTimestamp(),
		completedAt:    null
	});
	return ref.id;
}

/** Update arbitrary job fields */
export async function updateJob(uid, jobId, updates) {
	await updateDoc(jobDoc(uid, jobId), { ...updates, updatedAt: serverTimestamp() });
}

/** Mark completed */
export async function completeJob(uid, jobId, result = {}) {
	await updateDoc(jobDoc(uid, jobId), {
		status: 'completed', progress: 100,
		resultUrl:    result.url    || null,
		resultFrames: result.frames || [],
		videoUrl:     result.videoUrl || null,
		completedAt:  serverTimestamp(),
		updatedAt:    serverTimestamp()
	});
}

/** Mark failed */
export async function failJob(uid, jobId, error) {
	await updateDoc(jobDoc(uid, jobId), {
		status: 'failed',
		error: typeof error === 'string' ? error : error?.message || 'Unknown error',
		completedAt: serverTimestamp(),
		updatedAt:   serverTimestamp()
	});
}

/** Delete one job */
export async function deleteJob(uid, jobId) {
	await deleteDoc(jobDoc(uid, jobId));
}

/** Real-time listener for all user jobs (newest first) */
export function subscribeToJobs(uid, callback) {
	if (!uid) { callback([]); return () => {}; }
	// Simple query — sort client-side to avoid composite-index requirement
	const q = query(jobsCol(uid));
	return onSnapshot(q, (snap) => {
		const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
		items.sort((a, b) => {
			const ta = a.createdAt?.toMillis?.() || 0;
			const tb = b.createdAt?.toMillis?.() || 0;
			return tb - ta; // newest first
		});
		callback(items);
	}, (err) => {
		console.error('[Firestore] subscribeToJobs error:', err);
		callback([]);
	});
}

/** Batch-delete finished jobs */
export async function clearFinishedJobs(uid) {
	const q = query(jobsCol(uid), where('status', 'in', ['completed', 'failed']));
	const snap = await getDocs(q);
	const batch = writeBatch(db);
	snap.docs.forEach(d => batch.delete(d.ref));
	await batch.commit();
}

/**
 * Upsert a lightweight job log document by deterministic job id.
 * Designed for resilient client-side logging (works with retry queues).
 */
export async function upsertJobLog(uid, jobId, payload = {}) {
	if (!uid || !jobId) return;
	await setDoc(
		jobDoc(uid, jobId),
		{
			jobId,
			...payload,
			updatedAt: serverTimestamp()
		},
		{ merge: true }
	);
}

/** Remove a job log document by id. */
export async function deleteJobLog(uid, jobId) {
	if (!uid || !jobId) return;
	await deleteDoc(jobDoc(uid, jobId));
}

/** Persist cluster summary + individual edit snapshot (best effort). */
export async function saveEditClusterJob(uid, clusterId, job) {
	if (!uid || !clusterId || !job?.id) return;
	await setDoc(
		editClusterDoc(uid, clusterId),
		{
			clusterId,
			lastJobId: job.id,
			lastImage: job.image || null,
			updatedAt: serverTimestamp()
		},
		{ merge: true }
	);
	await setDoc(
		editClusterJobsDoc(uid, clusterId, job.id),
		{
			jobId: job.id,
			image: job.image || null,
			name: job.name || 'Edit Result',
			promptJson: job.promptJson || null,
			editHistoryId: job.editHistoryId || null,
			editParentHistoryId: job.editParentHistoryId || null,
			sourceFileId: job.sourceFileId || null,
			createdAt: job.createdAt || new Date().toISOString(),
			updatedAt: serverTimestamp()
		},
		{ merge: true }
	);
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function sortItems(items) {
	return items.sort((a, b) => {
		if (a.isFolder && !b.isFolder) return -1;
		if (!a.isFolder && b.isFolder) return 1;
		return (a.name || '').localeCompare(b.name || '');
	});
}
