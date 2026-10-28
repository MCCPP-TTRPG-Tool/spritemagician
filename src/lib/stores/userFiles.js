/**
 * Reactive store for the local file library.
 *
 * Tracks:
 *   - current folder + breadcrumbs
 *   - children of the current folder (refreshed on change + slow poll)
 *   - loading / error states
 */
import { writable, get } from 'svelte/store';
import { browser } from '$app/environment';
import { subscribeToChildren, initializeDefaultFolders } from '$lib/library/client.js';

const LOCAL_UID = 'local';

function createUserFilesStore() {
	const { subscribe, set, update } = writable({
		items: [],
		currentFolderId: null,
		breadcrumbs: [], // [{ id, name }, …]
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
		update((s) => ({ ...s, loading: true, error: null }));
		unsubChildren = subscribeToChildren(LOCAL_UID, folderId, (items) => {
			update((s) => ({ ...s, items, loading: false }));
		});
	}

	async function init() {
		if (!browser) return;
		try {
			await initializeDefaultFolders();
		} catch (e) {
			console.warn('[UserFiles] init folders:', e.message);
		}
		listenTo(get({ subscribe }).currentFolderId || null);
	}

	if (browser) init();

	return {
		subscribe,

		openFolder(folderId, folderName) {
			update((st) => ({
				...st,
				currentFolderId: folderId,
				breadcrumbs: [...st.breadcrumbs, { id: folderId, name: folderName }]
			}));
			listenTo(folderId);
		},

		goBack() {
			const s = get({ subscribe });
			if (s.breadcrumbs.length === 0) return;
			const bc = s.breadcrumbs.slice(0, -1);
			const parentId = bc.length > 0 ? bc[bc.length - 1].id : null;
			update((st) => ({ ...st, currentFolderId: parentId, breadcrumbs: bc }));
			listenTo(parentId);
		},

		goToBreadcrumb(index) {
			const s = get({ subscribe });
			if (index < 0) {
				update((st) => ({ ...st, currentFolderId: null, breadcrumbs: [] }));
				listenTo(null);
			} else {
				const bc = s.breadcrumbs.slice(0, index + 1);
				const target = bc[bc.length - 1];
				update((st) => ({ ...st, currentFolderId: target.id, breadcrumbs: bc }));
				listenTo(target.id);
			}
		},

		goToRoot() {
			update((st) => ({ ...st, currentFolderId: null, breadcrumbs: [] }));
			listenTo(null);
		},

		getUid() { return LOCAL_UID; },

		refreshCurrentFolder() {
			listenTo(get({ subscribe }).currentFolderId);
		},

		destroy() {
			cleanup();
		}
	};
}

export const userFiles = createUserFilesStore();
