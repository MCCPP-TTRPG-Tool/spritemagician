/**
 * Reactive store for the local file library.
 *
 * Tracks:
 *   - current folder + breadcrumbs (persisted so a reload keeps your place)
 *   - children of the current folder (refreshed on change + slow poll)
 *   - loading / error states
 */
import { writable, get } from 'svelte/store';
import { browser } from '$app/environment';
import { subscribeToChildren, initializeDefaultFolders, rescanLibrary } from '$lib/library/client.js';

const LOCAL_UID = 'local';
const NAV_KEY = 'spritemagician_library_nav_v1';

function readNav() {
	if (!browser) return null;
	try {
		const raw = localStorage.getItem(NAV_KEY);
		const parsed = raw ? JSON.parse(raw) : null;
		if (parsed && Array.isArray(parsed.breadcrumbs)) return parsed;
	} catch { /* ignore */ }
	return null;
}

function writeNav(currentFolderId, breadcrumbs) {
	if (!browser) return;
	try {
		localStorage.setItem(NAV_KEY, JSON.stringify({ currentFolderId, breadcrumbs }));
	} catch { /* ignore */ }
}

function createUserFilesStore() {
	const saved = readNav();
	const { subscribe, update } = writable({
		items: [],
		currentFolderId: saved?.currentFolderId || null,
		breadcrumbs: saved?.breadcrumbs || [], // [{ id, name }, …]
		loading: true,
		error: null,
		uid: LOCAL_UID
	});

	let unsubChildren = null;

	function cleanup() {
		if (unsubChildren) { unsubChildren(); unsubChildren = null; }
	}

	function listenTo(folderId) {
		cleanup();
		// Only show the loading state when there is nothing to display yet.
		update((s) => ({ ...s, loading: s.items.length === 0, error: null }));
		unsubChildren = subscribeToChildren(
			LOCAL_UID,
			folderId,
			(items) => update((s) => ({ ...s, items, loading: false, error: null })),
			{ onError: (err) => update((s) => ({ ...s, loading: false, error: err?.message || 'Library unavailable' })) }
		);
	}

	function navigate(currentFolderId, breadcrumbs) {
		update((st) => ({ ...st, currentFolderId, breadcrumbs, items: [] }));
		writeNav(currentFolderId, breadcrumbs);
		listenTo(currentFolderId);
	}

	async function init() {
		if (!browser) return;
		try {
			await initializeDefaultFolders();
			await rescanLibrary();
		} catch (e) {
			console.warn('[UserFiles] init:', e.message);
		}
		const s = get({ subscribe });
		listenTo(s.currentFolderId || null);

		// Pick up files added in Explorer while the app was in the background.
		document.addEventListener('visibilitychange', async () => {
			if (document.hidden) return;
			try {
				await rescanLibrary();
			} catch { /* ignore */ }
		});
	}

	if (browser) init();

	return {
		subscribe,

		openFolder(folderId, folderName) {
			const s = get({ subscribe });
			navigate(folderId, [...s.breadcrumbs, { id: folderId, name: folderName }]);
		},

		goBack() {
			const s = get({ subscribe });
			if (s.breadcrumbs.length === 0) return;
			const bc = s.breadcrumbs.slice(0, -1);
			navigate(bc.length > 0 ? bc[bc.length - 1].id : null, bc);
		},

		goToBreadcrumb(index) {
			const s = get({ subscribe });
			if (index < 0) return navigate(null, []);
			const bc = s.breadcrumbs.slice(0, index + 1);
			navigate(bc[bc.length - 1].id, bc);
		},

		goToRoot() {
			navigate(null, []);
		},

		getUid() { return LOCAL_UID; },

		/** Re-fetch the current folder without tearing down the subscription. */
		refreshCurrentFolder() {
			listenTo(get({ subscribe }).currentFolderId);
		},

		destroy() {
			cleanup();
		}
	};
}

export const userFiles = createUserFilesStore();
