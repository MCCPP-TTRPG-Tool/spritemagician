/**
 * Reactive store for the Firebase-backed file tree.
 *
 * Tracks:
 *   - current folder + breadcrumbs
 *   - real-time children via Firestore onSnapshot
 *   - loading / error states
 */
import { writable, get } from 'svelte/store';
import { browser } from '$app/environment';
import { auth } from '$lib/firebase/client.js';
import { onAuthStateChanged } from 'firebase/auth';
import {
	subscribeToChildren,
	initializeDefaultFolders
} from '$lib/firebase/firestore.js';

function createUserFilesStore() {
	const { subscribe, set, update } = writable({
		items: [],
		currentFolderId: null,
		breadcrumbs: [],     // [{ id, name }, …]
		loading: true,
		error: null,
		uid: null
	});

	let unsubChildren = null;
	let unsubAuth = null;

	// ── helpers ──────────────────────────────────────────────

	function cleanup() {
		if (unsubChildren) { unsubChildren(); unsubChildren = null; }
	}

	function listenTo(uid, folderId) {
		// Don't subscribe if client-side auth isn't ready (Firestore security rules require it)
		if (!auth.currentUser) {
			console.warn('[UserFiles] Cannot subscribe - client-side auth not ready yet. Current user:', auth.currentUser);
			update(s => ({ ...s, loading: false, error: 'Waiting for authentication...' }));
			return;
		}
		// Verify UID matches
		if (auth.currentUser.uid !== uid) {
			console.warn('[UserFiles] UID mismatch - auth.uid:', auth.currentUser.uid, 'requested uid:', uid);
			update(s => ({ ...s, loading: false, error: 'Authentication mismatch' }));
			return;
		}
		console.log('[UserFiles] Subscribing to folder:', { uid, folderId, authUid: auth.currentUser.uid });
		cleanup();
		update(s => ({ ...s, loading: true, error: null }));
		unsubChildren = subscribeToChildren(uid, folderId, (items) => {
			update(s => ({ ...s, items, loading: false }));
		});
	}

	// ── bootstrap ───────────────────────────────────────────

	function init() {
		if (!browser) return;

		// Note: We don't subscribe to authStore anymore - we wait for client-side
		// Firebase auth to be ready (via onAuthStateChanged) because Firestore
		// security rules require client-side auth to be signed in.
		// The authStore is only used as a fallback to show UID in the UI.

		// Also listen to Firebase client auth (for Firestore security rules)
		// This is the PRIMARY source - only subscribe when client auth is ready
		unsubAuth = onAuthStateChanged(auth, async (user) => {
			if (user) {
				const uid = user.uid;
				const current = get({ subscribe });
				// Always update UID and re-subscribe when client auth is ready
				update(s => ({ ...s, uid, loading: true, error: null }));
				try { 
					await initializeDefaultFolders(uid);
				} catch (e) { 
					console.warn('[UserFiles] init folders:', e.message);
				}
				// Subscribe to current folder (or root if at root)
				const targetFolderId = current.currentFolderId || null;
				listenTo(uid, targetFolderId);
			} else {
				// Client auth signed out - clear everything
				cleanup();
				set({ items: [], currentFolderId: null, breadcrumbs: [], loading: false, error: null, uid: null });
			}
		});
	}

	if (browser) init();

	// ── public API ──────────────────────────────────────────

	return {
		subscribe,

		/** Open a sub-folder */
		openFolder(folderId, folderName) {
			const s = get({ subscribe });
			if (!s.uid) return;
			update(st => ({
				...st,
				currentFolderId: folderId,
				breadcrumbs: [...st.breadcrumbs, { id: folderId, name: folderName }]
			}));
			listenTo(s.uid, folderId);
		},

		/** Go up one level */
		goBack() {
			const s = get({ subscribe });
			if (!s.uid || s.breadcrumbs.length === 0) return;
			const bc = s.breadcrumbs.slice(0, -1);
			const parentId = bc.length > 0 ? bc[bc.length - 1].id : null;
			update(st => ({ ...st, currentFolderId: parentId, breadcrumbs: bc }));
			listenTo(s.uid, parentId);
		},

		/** Jump to a specific breadcrumb index (-1 = root) */
		goToBreadcrumb(index) {
			const s = get({ subscribe });
			if (!s.uid) return;
			if (index < 0) {
				update(st => ({ ...st, currentFolderId: null, breadcrumbs: [] }));
				listenTo(s.uid, null);
			} else {
				const bc = s.breadcrumbs.slice(0, index + 1);
				const target = bc[bc.length - 1];
				update(st => ({ ...st, currentFolderId: target.id, breadcrumbs: bc }));
				listenTo(s.uid, target.id);
			}
		},

		/** Jump straight to root */
		goToRoot() {
			const s = get({ subscribe });
			if (!s.uid) return;
			update(st => ({ ...st, currentFolderId: null, breadcrumbs: [] }));
			listenTo(s.uid, null);
		},

		/** Expose UID for external callers */
		getUid() { return get({ subscribe }).uid; },

		/** Refresh current folder (re-trigger listener) */
		refreshCurrentFolder() {
			const s = get({ subscribe });
			if (s.uid) {
				listenTo(s.uid, s.currentFolderId);
			}
		},

		/** Tear down all listeners */
		destroy() {
			cleanup();
			if (unsubAuth) unsubAuth();
		}
	};
}

export const userFiles = createUserFilesStore();
