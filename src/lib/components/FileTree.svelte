<script>
	import { userFiles } from '$lib/stores/userFiles.js';
	import { projectStore } from '$lib/stores/project.js';
	import {
		createFolder,
		upsertFileByName,
		renameItem,
		deleteItem,
		deleteFolderRecursive,
		moveItem,
		getChildren
	} from '$lib/firebase/firestore.js';
	import { cleanupBackground } from '$lib/utils/backgroundCleanup.js';
	import { addToQueue, resetInitialState } from '$lib/stores/animationQueue.js';
	import FolderPicker from './FolderPicker.svelte';
	import { CHROMA_KEY_HEX, CHROMA_KEY_TOLERANCE } from '$lib/constants/chromaKey.js';
	import { activeAssetStore } from '$lib/stores/activeAsset.js';

	// ── reactive state ──────────────────────────────────────
	let fs = $state({
		items: [], currentFolderId: null, breadcrumbs: [],
		loading: true, error: null, uid: null
	});
	userFiles.subscribe(v => { fs = v; });

	let viewMode     = $state('grid');      // 'grid' | 'list'
	let showNewFolder = $state(false);
	let newFolderName = $state('');
	let selectedId    = $state(null);
	let previewItem   = $state(null);
	let uploading     = $state(false);
	let menuItemId    = $state(null);     // which item's dropdown is open
	let fileInputEl;
	
	// Multi-select
	let selectedItemIds = $state(new Set());
	let isSelectionMode = $derived(selectedItemIds.size > 0);
	let showMoveFolderPicker = $state(false);
	let movingItemIds = $state(null);
	let listSortKey = $state('name'); // 'name' | 'type' | 'modified' | 'size'
	let listSortDir = $state('asc'); // 'asc' | 'desc'
	
	// Background removal progress
	let bgRemovalProgress = $state(null); // { status: string, message: string, progress?: number }
	let expandedInfoIds = $state(new Set());
	let editHistoryCountByFile = $state({});

	const folders = $derived(fs.items.filter(i => i.isFolder));
	const files   = $derived(fs.items.filter(i => !i.isFolder));
	const sortedListItems = $derived.by(() => {
		const dir = listSortDir === 'desc' ? -1 : 1;
		const items = [...fs.items];
		return items.sort((a, b) => {
			if (a.isFolder && !b.isFolder) return -1;
			if (!a.isFolder && b.isFolder) return 1;
			let cmp = 0;
			if (listSortKey === 'type') {
				const aType = a.isFolder ? 'folder' : String(a.fileType || 'file');
				const bType = b.isFolder ? 'folder' : String(b.fileType || 'file');
				cmp = aType.localeCompare(bType);
			} else if (listSortKey === 'modified') {
				const aTime = getTimestampValue(a.updatedAt || a.createdAt);
				const bTime = getTimestampValue(b.updatedAt || b.createdAt);
				cmp = aTime - bTime;
			} else if (listSortKey === 'size') {
				const aSize = a.isFolder ? -1 : Number(a.size || 0);
				const bSize = b.isFolder ? -1 : Number(b.size || 0);
				cmp = aSize - bSize;
			} else {
				cmp = String(a.name || '').localeCompare(String(b.name || ''));
			}
			if (cmp === 0) {
				cmp = String(a.name || '').localeCompare(String(b.name || ''));
			}
			return cmp * dir;
		});
	});

	// ── actions ─────────────────────────────────────────────

	async function doCreateFolder() {
		const name = newFolderName.trim();
		if (!name) {
			alert('Please enter a folder name');
			return;
		}
		
		try {
			const result = await createFolderViaApi(name, fs.currentFolderId || null);
			console.log('[FileTree] Folder created:', result);
			newFolderName = '';
			showNewFolder = false;
			// The real-time listener will automatically update, but refresh just in case
			setTimeout(() => userFiles.refreshCurrentFolder(), 500);
		} catch (e) {
			console.error('[FileTree] Create folder error:', e);
			alert('Create folder failed: ' + (e.message || String(e)));
		}
	}

	async function createFolderViaApi(name, parentId = null, metadata = null) {
		const res = await fetch('/api/create-folder', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				name,
				parentId,
				metadata
			})
		});
		if (!res.ok) {
			const data = await res.json();
			throw new Error(data.error || 'Failed to create folder');
		}
		return res.json();
	}

	async function freshStartFileTree() {
		if (!fs.uid) return;
		const first = confirm(
			'Fresh Start will permanently delete ALL folders and files in your file tree. Continue?'
		);
		if (!first) return;
		const guard = prompt('Type DELETE to confirm full file tree wipe.');
		if (guard !== 'DELETE') return;

		try {
			const rootItems = await getChildren(fs.uid, null);
			for (const item of rootItems) {
				if (item.isFolder) {
					await deleteFolderRecursive(fs.uid, item.id);
				} else {
					await deleteItem(fs.uid, item.id);
				}
			}
			userFiles.goToRoot();
			alert('Fresh start complete. File tree is now empty.');
		} catch (e) {
			alert('Fresh start failed: ' + (e.message || String(e)));
		}
	}

	function clickItem(item) {
		// If selection mode is active, toggle selection instead of single selection
		if (isSelectionMode) {
			toggleSelect(item.id);
		} else if (item.isFolder) {
			// Single-click opens folders for faster navigation.
			selectedId = null;
			userFiles.openFolder(item.id, item.name);
		} else {
			selectedId = selectedId === item.id ? null : item.id;
			previewFileInRightPanel(item);
		}
	}

	function isImagePreviewCandidate(item) {
		if (!item || item.isFolder || !item.url) return false;
		if (item.fileType === 'video') return false;
		if (item.fileType === 'image') return true;
		const lowerName = String(item.name || '').toLowerCase();
		return (
			lowerName.endsWith('.png') ||
			lowerName.endsWith('.jpg') ||
			lowerName.endsWith('.jpeg') ||
			lowerName.endsWith('.webp') ||
			lowerName.endsWith('.gif')
		);
	}

	function previewFileInRightPanel(item) {
		if (typeof window === 'undefined') return;
		if (!isImagePreviewCandidate(item)) return;
		window.dispatchEvent(
			new CustomEvent('jobsPreviewSelected', {
				detail: {
					image: item.url,
					label: item.name || 'File Preview',
					jobId: item.id || null
				}
			})
		);
	}
	
	function toggleSelect(itemId, e) {
		if (e) e.stopPropagation();
		if (selectedItemIds.has(itemId)) {
			selectedItemIds.delete(itemId);
		} else {
			selectedItemIds.add(itemId);
		}
		selectedItemIds = new Set(selectedItemIds); // Trigger reactivity
	}
	
	function selectAll() {
		selectedItemIds = new Set(fs.items.map(i => i.id));
	}
	
	function deselectAll() {
		selectedItemIds = new Set();
	}
	
	function getSelectedItems() {
		return fs.items.filter(i => selectedItemIds.has(i.id));
	}
	
	async function batchDelete() {
		const selected = getSelectedItems();
		if (selected.length === 0) return;
		
		const folders = selected.filter(i => i.isFolder);
		const files = selected.filter(i => !i.isFolder);
		
		let msg = `Delete ${selected.length} item${selected.length !== 1 ? 's' : ''}?`;
		if (folders.length > 0) {
			msg += `\n\nThis includes ${folders.length} folder${folders.length !== 1 ? 's' : ''} and all their contents.`;
		}
		
		if (!confirm(msg)) return;
		
		try {
			for (const item of selected) {
				if (item.isFolder) {
					await deleteFolderRecursive(fs.uid, item.id);
				} else {
					await deleteItem(fs.uid, item.id);
				}
			}
			deselectAll();
		} catch (e) {
			alert('Delete failed: ' + e.message);
		}
	}
	
	async function batchMoveToFolder() {
		const selected = getSelectedItems();
		if (selected.length === 0) return;
		
		movingItemIds = selected.map(i => i.id);
		showMoveFolderPicker = true;
	}
	
	async function onMoveFolderSelect(folderId, folderPath) {
		showMoveFolderPicker = false;
		
		if (!movingItemIds || movingItemIds.length === 0) return;
		
		const selected = fs.items.filter(i => movingItemIds.includes(i.id));
		if (selected.length === 0) return;
		
		try {
			for (const item of selected) {
				// Don't move into itself
				if (item.id === folderId) {
					continue;
				}
				
				await moveItem(fs.uid, item.id, folderId || null);
			}
			
			// Refresh the file tree
			userFiles.refreshCurrentFolder();
			deselectAll();
			movingItemIds = null;
		} catch (e) {
			alert('Move failed: ' + e.message);
			movingItemIds = null;
		}
	}
	
	async function batchDownload() {
		const selected = getSelectedItems().filter(i => !i.isFolder && i.url);
		if (selected.length === 0) return;
		
		for (const item of selected) {
			const a = document.createElement('a');
			a.href = item.url;
			a.download = item.name;
			a.click();
			// Small delay to prevent browser blocking multiple downloads
			await new Promise(resolve => setTimeout(resolve, 100));
		}
		deselectAll();
	}

	async function doRename(item) {
		if (!fs.uid) return;
		const n = prompt('Rename:', item.name);
		if (n && n.trim() && n !== item.name) {
			try { await renameItem(fs.uid, item.id, n.trim()); }
			catch (e) { alert('Rename failed: ' + e.message); }
		}
	}

	async function doDelete(item) {
		if (!fs.uid) return;
		const msg = item.isFolder
			? `Delete folder "${item.name}" and ALL contents inside?`
			: `Delete "${item.name}"?`;
		if (!confirm(msg)) return;
		try {
			if (item.isFolder) await deleteFolderRecursive(fs.uid, item.id);
			else await deleteItem(fs.uid, item.id);
			if (selectedId === item.id) selectedId = null;
		} catch (e) { alert('Delete failed: ' + e.message); }
	}

	function triggerUpload() { fileInputEl?.click(); }

	async function onFilePicked(e) {
		const picked = e.target.files;
		if (!picked?.length || !fs.uid) return;
		uploading = true;
		try {
			for (const file of picked) {
				const dataUrl = await readAsDataUrl(file);
				const res = await fetch('/api/upload-file', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						imageData: dataUrl,
						filename: file.name,
						folder: fs.currentFolderId || 'root'
					})
				});
				if (!res.ok) throw new Error((await res.json()).error || 'Upload failed');
				const { url } = await res.json();

				const ft = file.type.startsWith('video/') ? 'video'
					: file.type === 'image/gif' ? 'animation' : 'image';

				await upsertFileByName(fs.uid, fs.currentFolderId, file.name, url, ft, {
					sourceType: 'upload', size: file.size, mimeType: file.type
				});
			}
		} catch (err) {
			console.error('Upload error:', err);
			alert('Upload failed: ' + err.message);
		} finally {
			uploading = false;
			e.target.value = '';
		}
	}

	function useAsStartFrame(item) {
		if (!item.url) return;
		projectStore.update(p => ({ ...p, firstFrame: item.url }));
		menuItemId = null;
	}

	function useAsEndFrame(item) {
		if (!item.url) return;
		projectStore.update(p => ({ ...p, lastFrame: item.url }));
		menuItemId = null;
	}

	function loadIntoEdit(item) {
		if (!item.url) return;
		projectStore.update(p => ({ ...p, editImage: item.url, editFileId: item.id || null }));
		menuItemId = null;
	}

	function loadIntoStyle(item) {
		if (!item.url) return;
		projectStore.update(p => ({ ...p, styleImage: item.url }));
		menuItemId = null;
	}

	function useFor3DGenerate(item) {
		if (!item.url) return;
		projectStore.update(p => ({ ...p, threeDReferenceImage: item.url }));
		menuItemId = null;
		if (typeof window !== 'undefined') {
			window.dispatchEvent(new CustomEvent('open3DMode'));
			window.dispatchEvent(new CustomEvent('open3DLeftTab', { detail: { tab: 'generate' } }));
			window.dispatchEvent(new CustomEvent('open3DRightTab', { detail: { tab: 'generate' } }));
		}
	}

	function useAs3DModel(item) {
		if (!item.url) return;
		projectStore.update(p => ({ ...p, threeDModelUrl: item.url }));
		menuItemId = null;
		if (typeof window !== 'undefined') {
			window.dispatchEvent(new CustomEvent('open3DMode'));
			window.dispatchEvent(new CustomEvent('open3DLeftTab', { detail: { tab: 'rigging' } }));
			window.dispatchEvent(new CustomEvent('open3DRightTab', { detail: { tab: 'rigging' } }));
		}
	}

	async function loadAnimation(item) {
		if (!item.url) return;
		menuItemId = null;
		try {
			// Use server-side proxy to avoid CORS issues with Firebase Storage
			const res = await fetch(`/api/load-animation?url=${encodeURIComponent(item.url)}`);
			if (!res.ok) {
				const errData = await res.json().catch(() => ({}));
				throw new Error(errData.error || 'Failed to fetch animation file');
			}
			const data = await res.json();
			if (data.type === 'animation' && data.frames?.length) {
				// Reset initial state when loading a new animation (so it becomes the new initial)
				resetInitialState();
				projectStore.update(p => ({
					...p,
					frames: data.frames,
					fps: data.fps || 12,
					currentFrame: 0,
					prompt: data.prompt || p.prompt,
					projectName: data.name || p.projectName,
					_animationLoaded: true   // Signal +page.svelte to switch to Preview tab
				}));
				console.log(`[FileTree] Loaded animation: ${data.frames.length} frames, ${data.fps || 12} fps`);
			} else {
				alert('Invalid animation file');
			}
		} catch (err) {
			console.error('[FileTree] Load animation error:', err);
			alert('Failed to load animation: ' + err.message);
		}
	}
	
	async function addAnimationToQueue(item) {
		if (!item.url) return;
		menuItemId = null;
		try {
			// Use server-side proxy to avoid CORS issues with Firebase Storage
			const res = await fetch(`/api/load-animation?url=${encodeURIComponent(item.url)}`);
			if (!res.ok) {
				const errData = await res.json().catch(() => ({}));
				throw new Error(errData.error || 'Failed to fetch animation file');
			}
			const data = await res.json();
			if (data.type === 'animation' && data.frames?.length) {
				addToQueue({
					id: item.id,
					name: item.name,
					frames: data.frames,
					fps: data.fps || 12,
					url: item.url
				});
				console.log(`[FileTree] Added to queue: ${item.name} (${data.frames.length} frames)`);
			} else {
				alert('Invalid animation file');
			}
		} catch (err) {
			console.error('[FileTree] Add to queue error:', err);
			alert('Failed to add animation to queue: ' + err.message);
		}
	}

	function isAnimFile(item) {
		return !item.isFolder && (item.fileType === 'animation' || item.name?.endsWith('.anim.json'));
	}

	function toggleMenu(itemId, e) {
		e.stopPropagation();
		menuItemId = menuItemId === itemId ? null : itemId;
	}

	function toggleItemInfo(itemId, e) {
		e?.stopPropagation?.();
		if (expandedInfoIds.has(itemId)) {
			expandedInfoIds.delete(itemId);
		} else {
			expandedInfoIds.add(itemId);
		}
		expandedInfoIds = new Set(expandedInfoIds);
	}
	
	async function removeBackgroundFromFile(item) {
		if (!item.url || item.isFolder) return;
		
		if (!confirm(`Remove background from "${item.name}"?`)) return;
		
		menuItemId = null;
		bgRemovalProgress = { status: 'processing', message: 'Removing background...', progress: 0 };
		
		try {
			// Load source image as data URL and chroma-key remove the configured lime background.
			let imageDataUrl = item.url;
			if (!imageDataUrl.startsWith('data:')) {
				bgRemovalProgress = { status: 'processing', message: 'Loading source image...', progress: 25 };
				const proxyRes = await fetch('/api/proxy-image', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ url: imageDataUrl })
				});
				if (!proxyRes.ok) {
					const proxyData = await proxyRes.json().catch(() => ({}));
					throw new Error(proxyData.error || 'Failed to load source image');
				}
				const { dataUrl } = await proxyRes.json();
				imageDataUrl = dataUrl;
			}

			const activeChroma = $activeAssetStore?.chromaKeyHex || CHROMA_KEY_HEX;
			bgRemovalProgress = { status: 'processing', message: `Removing chroma key ${activeChroma}...`, progress: 55 };
			const cleanedImage = await cleanupBackground(imageDataUrl, 70, true, true, false, {
				chromaKeyHex: activeChroma,
				chromaTolerance: CHROMA_KEY_TOLERANCE,
				chromaOnly: true
			});
			
			if (!cleanedImage || cleanedImage.length < 100) {
				throw new Error('Background cleanup failed - invalid image data');
			}
			
			// Replace the existing file in Firebase Storage (overwrite instead of creating new)
			bgRemovalProgress = { status: 'processing', message: 'Uploading updated file...', progress: 80 };
			const replaceRes = await fetch('/api/replace-file', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					imageData: cleanedImage,
					existingUrl: item.url
				})
			});
			
			if (!replaceRes.ok) {
				const replaceData = await replaceRes.json();
				throw new Error(replaceData.error || 'File replacement failed');
			}
			
			const { url: newUrl } = await replaceRes.json();
			
			// Update the file in Firestore with the new URL (should be same URL, but update timestamp)
			bgRemovalProgress = { status: 'processing', message: 'Updating file record...', progress: 90 };
			const { updateDoc, doc, serverTimestamp } = await import('firebase/firestore');
			const { db } = await import('$lib/firebase/client.js');
			const fileRef = doc(db, 'users', fs.uid, 'files', item.id);
			await updateDoc(fileRef, { url: newUrl, updatedAt: serverTimestamp() });
			
			// Refresh the file tree
			bgRemovalProgress = { status: 'processing', message: 'Refreshing...', progress: 95 };
			userFiles.refreshCurrentFolder();
			
			bgRemovalProgress = { status: 'completed', message: 'Background removed successfully!', progress: 100 };
			setTimeout(() => {
				bgRemovalProgress = null;
			}, 2000);
		} catch (err) {
			bgRemovalProgress = { status: 'error', message: 'Failed: ' + err.message, progress: 0 };
			setTimeout(() => {
				bgRemovalProgress = null;
			}, 3000);
		}
	}

	// ── helpers ─────────────────────────────────────────────

	function readAsDataUrl(file) {
		return new Promise((resolve, reject) => {
			const r = new FileReader();
			r.onload = () => resolve(r.result);
			r.onerror = () => reject(r.error);
			r.readAsDataURL(file);
		});
	}

	function icon(item) {
		if (item.isFolder) return '📁';
		switch (item.fileType) {
			case 'animation': return '🎬';
			case 'video':     return '🎥';
			default:          return '🖼️';
		}
	}

	function getTimestampValue(ts) {
		if (!ts) return 0;
		if (typeof ts?.toMillis === 'function') return ts.toMillis();
		const value = new Date(ts).getTime();
		return Number.isFinite(value) ? value : 0;
	}

	function setListSort(nextKey) {
		if (listSortKey === nextKey) {
			listSortDir = listSortDir === 'asc' ? 'desc' : 'asc';
			return;
		}
		listSortKey = nextKey;
		listSortDir = nextKey === 'modified' || nextKey === 'size' ? 'desc' : 'asc';
	}

	function sortIndicator(key) {
		if (listSortKey !== key) return '';
		return listSortDir === 'asc' ? '▲' : '▼';
	}
	
	function getFileTypeLabel(item) {
		if (item.isFolder) return null;
		if (item.fileType === 'animation' || item.name?.endsWith('.anim.json')) return 'ANIMATION';
		if (item.fileType === 'video') return 'VIDEO';
		return 'IMG';
	}

	function fmtDate(ts) {
		if (!ts) return '';
		const d = ts.toDate ? ts.toDate() : new Date(ts);
		return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
	}

	function fmtSize(bytes) {
		if (!bytes) return '—';
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
		return `${(bytes / 1048576).toFixed(1)} MB`;
	}

	function getEditHistoryCount(item) {
		if (!item || item.isFolder) return 0;
		const localCount = Number(editHistoryCountByFile[item.id] || 0);
		const metadataCount = Number(item?.metadata?.editCount || 0);
		return Number.isFinite(localCount) && localCount > 0 ? localCount : metadataCount;
	}

	function loadEditHistoryCountMap() {
		if (typeof window === 'undefined') return;
		try {
			const raw = localStorage.getItem('spritemagician.editHistory.byFile.v1');
			if (!raw) {
				editHistoryCountByFile = {};
				return;
			}
			const parsed = JSON.parse(raw);
			const next = {};
			for (const [fileId, entry] of Object.entries(parsed || {})) {
				const count = Array.isArray(entry?.nodes) ? entry.nodes.length : 0;
				if (count > 0) next[fileId] = count;
			}
			editHistoryCountByFile = next;
		} catch {
			editHistoryCountByFile = {};
		}
	}

	$effect(() => {
		if (typeof window === 'undefined') return;
		loadEditHistoryCountMap();
		const onEditHistoryUpdated = (event) => {
			const fileId = event?.detail?.fileId;
			const count = Number(event?.detail?.count || 0);
			if (!fileId) return;
			editHistoryCountByFile = { ...editHistoryCountByFile, [fileId]: Math.max(0, count) };
		};
		window.addEventListener('fileEditHistoryUpdated', onEditHistoryUpdated);
		return () => window.removeEventListener('fileEditHistoryUpdated', onEditHistoryUpdated);
	});

</script>

<!-- Close dropdown when clicking anywhere -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<svelte:window onclick={() => { menuItemId = null; }} />

<!-- hidden file input -->
<input
	bind:this={fileInputEl}
	type="file"
	accept="image/*,video/*"
	multiple
	class="hidden"
	onchange={onFilePicked}
/>

<div class="flex flex-col h-full text-xs">

	<!-- ═══ PATH BAR ═══ -->
	<div class="flex items-center gap-0.5 px-2 py-1.5 bg-white border-b flex-shrink-0 min-h-[34px]">
		<!-- Back / Up -->
		<button
			class="p-1 rounded hover:bg-gray-100 disabled:opacity-25 text-gray-500"
			disabled={fs.breadcrumbs.length === 0}
			onclick={() => userFiles.goBack()}
			title="Back"
		>←</button>
		<button
			class="p-1 rounded hover:bg-gray-100 disabled:opacity-25 text-gray-500"
			disabled={fs.breadcrumbs.length === 0}
			onclick={() => userFiles.goToRoot()}
			title="Root"
		>⬆</button>

		<!-- Path -->
		<div class="flex-1 flex items-center gap-0.5 min-w-0 ml-1 px-2 py-1 bg-gray-50 rounded border text-[11px] overflow-x-auto">
			<button class="shrink-0 text-gray-500 hover:text-blue-600 hover:underline" onclick={() => userFiles.goToBreadcrumb(-1)}>
				📁
			</button>
			{#if fs.breadcrumbs.length > 3}
				<span class="text-gray-300 shrink-0">/</span>
				<button class="text-gray-400 hover:text-blue-600 shrink-0" onclick={() => userFiles.goToBreadcrumb(0)} title={fs.breadcrumbs[0].name}>
					…
				</button>
			{/if}
			{#each fs.breadcrumbs.length > 3 ? fs.breadcrumbs.slice(-3) : fs.breadcrumbs as crumb, i}
				{@const realIdx = fs.breadcrumbs.length > 3 ? fs.breadcrumbs.length - 3 + i : i}
				<span class="text-gray-300 shrink-0">/</span>
				<button
					class="shrink-0 font-medium hover:text-blue-600 hover:underline
						{realIdx === fs.breadcrumbs.length - 1 ? 'text-gray-800' : 'text-gray-500'}"
					onclick={() => userFiles.goToBreadcrumb(realIdx)}
				>{crumb.name}</button>
			{/each}
		</div>

		<!-- View toggle -->
		<div class="flex gap-0.5 ml-1 shrink-0">
			<button class="p-1 rounded text-sm {viewMode === 'grid' ? 'bg-blue-100 text-blue-600' : 'text-gray-400 hover:bg-gray-100'}"
				onclick={() => viewMode = 'grid'} title="Grid view">⊞</button>
			<button class="p-1 rounded text-sm {viewMode === 'list' ? 'bg-blue-100 text-blue-600' : 'text-gray-400 hover:bg-gray-100'}"
				onclick={() => viewMode = 'list'} title="List view">≡</button>
		</div>
	</div>

	<!-- ═══ TOOLBAR ═══ -->
	<div class="flex items-center gap-1.5 px-2 py-1.5 bg-white border-b flex-shrink-0">
		<button class="px-2 py-1 rounded bg-blue-50 text-blue-700 hover:bg-blue-100 font-medium"
			onclick={() => { showNewFolder = true; newFolderName = ''; }}>
			📁 New
		</button>
		<button class="px-2 py-1 rounded bg-green-50 text-green-700 hover:bg-green-100 font-medium {uploading ? 'opacity-50 pointer-events-none' : ''}"
			onclick={triggerUpload}>
			{uploading ? '⏳…' : '⬆ Upload'}
		</button>
		<button class="px-2 py-1 rounded bg-red-50 text-red-700 hover:bg-red-100 font-medium"
			onclick={freshStartFileTree}
			title="Delete all file-tree folders and files for a clean start">
			🧹 Fresh Start
		</button>
		{#if !isSelectionMode}
			<button class="px-2 py-1 rounded bg-gray-50 text-gray-700 hover:bg-gray-100 font-medium text-xs ml-auto"
				onclick={selectAll}>
				☑ Select All
			</button>
		{/if}
	</div>
	
	<!-- ═══ SELECTION TOOLBAR ═══ -->
	{#if isSelectionMode}
		<div class="flex items-center justify-between px-2 py-1 bg-blue-100 text-blue-800 text-[11px] flex-shrink-0">
			<span class="font-medium">{selectedItemIds.size} selected</span>
			<div class="flex gap-2">
				<button class="px-2 py-1 rounded hover:bg-blue-200" onclick={batchMoveToFolder}>📁 Move</button>
				<button class="px-2 py-1 rounded hover:bg-blue-200" onclick={batchDownload}>📥 Download</button>
				<button class="px-2 py-1 rounded hover:bg-blue-200 text-red-700 hover:bg-red-200" onclick={batchDelete}>🗑 Delete</button>
				<button class="px-2 py-1 rounded hover:bg-blue-200" onclick={deselectAll}>✕ Cancel</button>
			</div>
		</div>
	{/if}

	<!-- ═══ NEW FOLDER INPUT (inline) ═══ -->
	{#if showNewFolder}
		<div class="flex items-center gap-2 px-2 py-2 bg-yellow-50 border-b">
			<span>📁</span>
			<input
				type="text"
				bind:value={newFolderName}
				placeholder="Folder name…"
				class="flex-1 px-2 py-1 border rounded text-xs"
				onkeydown={(e) => { if (e.key === 'Enter') doCreateFolder(); if (e.key === 'Escape') showNewFolder = false; }}
			/>
			<button class="px-2 py-1 bg-blue-500 text-white rounded hover:bg-blue-600 text-xs" onclick={doCreateFolder}>Create</button>
			<button class="px-2 py-1 bg-gray-200 rounded hover:bg-gray-300 text-xs" onclick={() => showNewFolder = false}>Cancel</button>
		</div>
	{/if}

	<!-- ═══ CONTENT AREA ═══ -->
	<div class="flex-1 overflow-y-auto p-2">
		{#if fs.loading}
			<div class="flex items-center justify-center h-full text-gray-400">
				<span class="animate-pulse">Loading…</span>
			</div>
		{:else if fs.items.length === 0}
			<div class="flex flex-col items-center justify-center h-full text-gray-400 gap-2">
				<span class="text-4xl">📂</span>
				<p class="text-sm">Empty folder</p>
				<p class="text-[10px]">Create a sub-folder or upload files</p>
			</div>

		<!-- ═ GRID VIEW ═ -->
		{:else if viewMode === 'grid'}
			<div class="grid grid-cols-4 gap-2">
				{#each fs.items as item (item.id)}
					{@const isSelected = selectedItemIds.has(item.id)}
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div
						class="relative group rounded-lg border-2 cursor-pointer transition-all
							{isSelected ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-300' : selectedId === item.id ? 'border-blue-500 bg-blue-50' : 'border-transparent hover:border-gray-300 bg-white'}"
						onclick={() => clickItem(item)}
					>
						<!-- Selection checkbox -->
						<button
							class="absolute top-1 left-1 z-20 w-4 h-4 rounded border-2 flex items-center justify-center transition-all
								{isSelected ? 'bg-blue-500 border-blue-500' : 'bg-white border-gray-300 hover:border-blue-400'}"
							onclick={(e) => toggleSelect(item.id, e)}
							title={isSelected ? 'Deselect' : 'Select'}
						>
							{#if isSelected}
								<span class="text-white text-[8px] leading-none">✓</span>
							{/if}
						</button>
						
						<div class="aspect-square flex items-center justify-center bg-gray-50 rounded-t-md overflow-hidden relative">
							{#if item.isFolder}
								<span class="text-5xl select-none">📁</span>
							{:else if item.thumbnailUrl}
								<img src={item.thumbnailUrl} alt={item.name} class="w-full h-full object-contain" loading="lazy" />
							{:else if item.url && item.fileType !== 'animation'}
								<img src={item.url} alt={item.name} class="w-full h-full object-contain" loading="lazy" />
							{:else}
								<span class="text-4xl select-none">{icon(item)}</span>
							{/if}
							
							<!-- File type label -->
							{#if !item.isFolder && getFileTypeLabel(item)}
								<div class="absolute bottom-0 left-0 right-0 bg-black/70 text-white text-[8px] font-bold px-1 py-0.5 text-center">
									{getFileTypeLabel(item)}
								</div>
							{/if}
						</div>

						<!-- Menu trigger (top-right, outside overflow-hidden) -->
						<button
							class="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/40 text-white text-xs flex items-center justify-center
								opacity-0 group-hover:opacity-100 hover:bg-black/60 transition-all z-10"
							onclick={(e) => toggleMenu(item.id, e)}
							title="Actions"
						>⋯</button>

						<!-- Dropdown menu -->
						{#if menuItemId === item.id}
							<!-- svelte-ignore a11y_no_static_element_interactions -->
							<div
								class="absolute top-8 left-1 z-50 w-36 bg-white rounded-lg shadow-xl border py-1 text-[11px]"
								onclick={(e) => e.stopPropagation()}
							>
								{#if isAnimFile(item)}
									<button class="w-full text-left px-3 py-1.5 hover:bg-green-50 text-gray-700 flex items-center gap-2"
										onclick={() => loadAnimation(item)}>
										🎬 <span>Open Animation</span>
									</button>
									<button class="w-full text-left px-3 py-1.5 hover:bg-blue-50 text-gray-700 flex items-center gap-2"
										onclick={() => { addAnimationToQueue(item); menuItemId = null; }}>
										➕ <span>Add to Queue</span>
									</button>
									<div class="border-t my-0.5"></div>
								{:else if !item.isFolder && item.url}
									<button class="w-full text-left px-3 py-1.5 hover:bg-blue-50 text-gray-700 flex items-center gap-2"
										onclick={() => loadIntoEdit(item)}>
										✏️ <span>Edit</span>
									</button>
									<button class="w-full text-left px-3 py-1.5 hover:bg-purple-50 text-gray-700 flex items-center gap-2"
										onclick={() => loadIntoStyle(item)}>
										✨ <span>Stylize</span>
									</button>
									<button class="w-full text-left px-3 py-1.5 hover:bg-orange-50 text-gray-700 flex items-center gap-2"
										onclick={() => { removeBackgroundFromFile(item); menuItemId = null; }}>
										🎭 <span>Remove Background</span>
									</button>
									<div class="border-t my-0.5"></div>
									<button class="w-full text-left px-3 py-1.5 hover:bg-indigo-50 text-gray-700 flex items-center gap-2"
										onclick={() => useFor3DGenerate(item)}>
										🧊 <span>3D Generate</span>
									</button>
									<button class="w-full text-left px-3 py-1.5 hover:bg-cyan-50 text-gray-700 flex items-center gap-2"
										onclick={() => useAs3DModel(item)}>
										📦 <span>3D Model</span>
									</button>
									<div class="border-t my-0.5"></div>
									<button class="w-full text-left px-3 py-1.5 hover:bg-blue-50 text-gray-700 flex items-center gap-2"
										onclick={() => useAsStartFrame(item)}>
										▶ <span>Start Frame</span>
									</button>
									<button class="w-full text-left px-3 py-1.5 hover:bg-green-50 text-gray-700 flex items-center gap-2"
										onclick={() => useAsEndFrame(item)}>
										⏹ <span>End Frame</span>
									</button>
									<div class="border-t my-0.5"></div>
								{/if}
								<button class="w-full text-left px-3 py-1.5 hover:bg-gray-50 text-gray-700 flex items-center gap-2"
									onclick={() => { doRename(item); menuItemId = null; }}>
									📝 <span>Rename</span>
								</button>
								<button class="w-full text-left px-3 py-1.5 hover:bg-red-50 text-red-600 flex items-center gap-2"
									onclick={() => { doDelete(item); menuItemId = null; }}>
									🗑 <span>Delete</span>
								</button>
							</div>
						{/if}

						<div class="px-1.5 py-1">
							<p class="text-[11px] truncate text-center font-medium">{item.name}</p>
						</div>
					</div>
				{/each}
			</div>

		<!-- ═ LIST VIEW ═ -->
		{:else}
			<table class="w-full text-[11px]">
				<thead>
					<tr class="text-left text-gray-500 border-b">
						<th class="py-1 px-2 font-medium">
							<button class="inline-flex items-center gap-1 hover:text-blue-600" onclick={() => setListSort('name')}>
								<span>Name</span><span class="text-[9px] w-2 inline-block">{sortIndicator('name')}</span>
							</button>
						</th>
						<th class="py-1 px-2 font-medium w-20">
							<button class="inline-flex items-center gap-1 hover:text-blue-600" onclick={() => setListSort('type')}>
								<span>Type</span><span class="text-[9px] w-2 inline-block">{sortIndicator('type')}</span>
							</button>
						</th>
						<th class="py-1 px-2 font-medium w-24">
							<button class="inline-flex items-center gap-1 hover:text-blue-600" onclick={() => setListSort('modified')}>
								<span>Modified</span><span class="text-[9px] w-2 inline-block">{sortIndicator('modified')}</span>
							</button>
						</th>
						<th class="py-1 px-2 font-medium w-16 text-right">
							<button class="inline-flex items-center gap-1 hover:text-blue-600" onclick={() => setListSort('size')}>
								<span>Size</span><span class="text-[9px] w-2 inline-block">{sortIndicator('size')}</span>
							</button>
						</th>
						<th class="py-1 px-2 font-medium w-8"></th>
					</tr>
				</thead>
				<tbody>
					{#each sortedListItems as item (item.id)}
						{@const isSelected = selectedItemIds.has(item.id)}
						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<tr
							class="border-b border-gray-100 cursor-pointer transition-colors relative group
								{isSelected ? 'bg-blue-50 ring-1 ring-blue-300' : selectedId === item.id ? 'bg-blue-50' : 'hover:bg-gray-50'}"
							onclick={() => clickItem(item)}
						>
							<td class="py-1.5 px-2 flex items-center gap-2">
								<button
									class="w-4 h-4 rounded border border-gray-300 bg-white text-[9px] text-gray-600 flex items-center justify-center hover:bg-gray-100"
									onclick={(e) => toggleItemInfo(item.id, e)}
									title={expandedInfoIds.has(item.id) ? 'Hide details' : 'Show details'}
								>
									{expandedInfoIds.has(item.id) ? '▾' : '▸'}
								</button>
								<!-- Selection checkbox -->
								<button
									class="w-4 h-4 rounded border-2 flex items-center justify-center transition-all flex-shrink-0
										{isSelected ? 'bg-blue-500 border-blue-500' : 'bg-white border-gray-300 hover:border-blue-400'}"
									onclick={(e) => toggleSelect(item.id, e)}
									title={isSelected ? 'Deselect' : 'Select'}
								>
									{#if isSelected}
										<span class="text-white text-[8px] leading-none">✓</span>
									{/if}
								</button>
								<span class="text-sm">{icon(item)}</span>
								<span class="truncate font-medium">{item.name}</span>
							</td>
							<td class="py-1.5 px-2 text-gray-500">{item.isFolder ? 'Folder' : (item.fileType || 'File')}</td>
							<td class="py-1.5 px-2 text-gray-500">{fmtDate(item.updatedAt || item.createdAt)}</td>
							<td class="py-1.5 px-2 text-gray-500 text-right">{item.isFolder ? '—' : fmtSize(item.size)}</td>
							<td class="py-1.5 px-2 relative">
								<button
									class="w-5 h-5 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-200 flex items-center justify-center text-xs
										opacity-0 group-hover:opacity-100 transition-opacity"
									onclick={(e) => toggleMenu(item.id, e)}
									title="Actions"
								>⋯</button>

								{#if menuItemId === item.id}
									<!-- svelte-ignore a11y_no_static_element_interactions -->
									<div
										class="absolute top-full right-0 z-50 w-36 bg-white rounded-lg shadow-xl border py-1 text-[11px]"
										onclick={(e) => e.stopPropagation()}
									>
										{#if isAnimFile(item)}
											<button class="w-full text-left px-3 py-1.5 hover:bg-green-50 text-gray-700 flex items-center gap-2"
												onclick={() => loadAnimation(item)}>
												🎬 <span>Open Animation</span>
											</button>
											<button class="w-full text-left px-3 py-1.5 hover:bg-blue-50 text-gray-700 flex items-center gap-2"
												onclick={() => { addAnimationToQueue(item); menuItemId = null; }}>
												➕ <span>Add to Queue</span>
											</button>
											<div class="border-t my-0.5"></div>
								{:else if !item.isFolder && item.url}
									<button class="w-full text-left px-3 py-1.5 hover:bg-blue-50 text-gray-700 flex items-center gap-2"
										onclick={() => loadIntoEdit(item)}>
										✏️ <span>Edit</span>
									</button>
									<button class="w-full text-left px-3 py-1.5 hover:bg-purple-50 text-gray-700 flex items-center gap-2"
										onclick={() => loadIntoStyle(item)}>
										✨ <span>Stylize</span>
									</button>
									<button class="w-full text-left px-3 py-1.5 hover:bg-orange-50 text-gray-700 flex items-center gap-2"
										onclick={() => { removeBackgroundFromFile(item); menuItemId = null; }}>
										🎭 <span>Remove Background</span>
									</button>
									<div class="border-t my-0.5"></div>
									<button class="w-full text-left px-3 py-1.5 hover:bg-indigo-50 text-gray-700 flex items-center gap-2"
										onclick={() => useFor3DGenerate(item)}>
										🧊 <span>3D Generate</span>
									</button>
									<button class="w-full text-left px-3 py-1.5 hover:bg-cyan-50 text-gray-700 flex items-center gap-2"
										onclick={() => useAs3DModel(item)}>
										📦 <span>3D Model</span>
									</button>
									<div class="border-t my-0.5"></div>
									<button class="w-full text-left px-3 py-1.5 hover:bg-blue-50 text-gray-700 flex items-center gap-2"
										onclick={() => useAsStartFrame(item)}>
										▶ <span>Start Frame</span>
									</button>
									<button class="w-full text-left px-3 py-1.5 hover:bg-green-50 text-gray-700 flex items-center gap-2"
										onclick={() => useAsEndFrame(item)}>
										⏹ <span>End Frame</span>
											</button>
											<div class="border-t my-0.5"></div>
										{/if}
										<button class="w-full text-left px-3 py-1.5 hover:bg-gray-50 text-gray-700 flex items-center gap-2"
											onclick={() => { doRename(item); menuItemId = null; }}>
											📝 <span>Rename</span>
										</button>
										<button class="w-full text-left px-3 py-1.5 hover:bg-red-50 text-red-600 flex items-center gap-2"
											onclick={() => { doDelete(item); menuItemId = null; }}>
											🗑 <span>Delete</span>
										</button>
									</div>
								{/if}
							</td>
						</tr>
						{#if expandedInfoIds.has(item.id)}
							<tr class="border-b border-gray-100 bg-gray-50/80">
								<td class="px-2 py-2 text-[10px] text-gray-600" colspan="5">
									<div class="grid grid-cols-2 gap-2">
										<div><span class="text-gray-500">Name:</span> {item.name}</div>
										<div><span class="text-gray-500">Type:</span> {item.isFolder ? 'Folder' : (item.fileType || 'File')}</div>
										<div><span class="text-gray-500">Created:</span> {fmtDate(item.createdAt) || '—'}</div>
										<div><span class="text-gray-500">Modified:</span> {fmtDate(item.updatedAt) || '—'}</div>
										<div><span class="text-gray-500">Size:</span> {item.isFolder ? '—' : fmtSize(item.size)}</div>
										<div><span class="text-gray-500">ID:</span> <span class="font-mono">{item.id}</span></div>
											<div><span class="text-gray-500">Edits:</span> {getEditHistoryCount(item)}</div>
									</div>
								</td>
							</tr>
						{/if}
					{/each}
				</tbody>
			</table>
		{/if}
	</div>

	<!-- ═══ BACKGROUND REMOVAL PROGRESS BAR ═══ -->
	{#if bgRemovalProgress}
		<div class="flex-shrink-0 border-t bg-teal-50 px-3 py-2">
			<div class="flex items-center gap-2 mb-1">
				{#if bgRemovalProgress.status === 'processing'}
					<svg class="animate-spin h-4 w-4 text-teal-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
						<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
						<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
					</svg>
				{:else if bgRemovalProgress.status === 'completed'}
					<span class="text-sm">✅</span>
				{:else if bgRemovalProgress.status === 'error'}
					<span class="text-sm">❌</span>
				{/if}
				<span class="text-xs font-medium text-teal-800">Removing Background</span>
				{#if bgRemovalProgress.progress !== undefined}
					<span class="ml-auto text-xs font-bold text-teal-700 tabular-nums">{bgRemovalProgress.progress}%</span>
				{/if}
			</div>
			<p class="text-[10px] text-teal-600 mb-1.5">{bgRemovalProgress.message}</p>
			{#if bgRemovalProgress.progress !== undefined}
				<div class="w-full bg-teal-200 rounded-full h-1.5">
					<div 
						class="bg-teal-600 h-1.5 rounded-full transition-all duration-300"
						style="width: {bgRemovalProgress.progress}%"
					></div>
				</div>
			{/if}
		</div>
	{/if}

	<!-- ═══ STATUS BAR ═══ -->
	<div class="flex items-center justify-between px-2 py-1 bg-gray-50 border-t text-[10px] text-gray-500 flex-shrink-0">
		<span>{fs.items.length} item{fs.items.length !== 1 ? 's' : ''} ({folders.length} folder{folders.length !== 1 ? 's' : ''}, {files.length} file{files.length !== 1 ? 's' : ''})</span>
		{#if uploading}
			<span class="text-blue-600 animate-pulse">Uploading…</span>
		{/if}
	</div>
</div>

<!-- ═══ FULL-SIZE PREVIEW MODAL ═══ -->
{#if previewItem}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
		onclick={() => previewItem = null}
		onkeydown={(e) => { if (e.key === 'Escape') previewItem = null; }}
		tabindex="0"
		role="dialog"
	>
		<div class="relative max-w-3xl max-h-[90vh] w-full" onclick={(e) => e.stopPropagation()}>
			<button onclick={() => previewItem = null}
				class="absolute -top-9 right-0 text-white hover:text-gray-300 text-xl">✕</button>

			{#if previewItem.fileType === 'video'}
				<video src={previewItem.url} class="max-w-full max-h-[80vh] mx-auto rounded-lg"
					autoplay loop muted playsinline controls></video>
			{:else}
				<img src={previewItem.url} alt={previewItem.name}
					class="max-w-full max-h-[80vh] mx-auto object-contain bg-gray-900 rounded-lg border-2 border-gray-700" />
			{/if}

			<div class="text-center mt-3">
				<p class="text-white font-medium">{previewItem.name}</p>
				{#if previewItem.metadata?.prompt}
					<p class="text-gray-400 text-sm mt-1">"{previewItem.metadata.prompt}"</p>
				{/if}
			</div>

			<!-- Actions -->
			{#if previewItem.url}
				<div class="flex justify-center gap-2 mt-3 flex-wrap">
					<button class="px-3 py-1.5 bg-teal-500 text-white rounded hover:bg-teal-600 text-sm font-medium"
						onclick={() => { loadIntoEdit(previewItem); previewItem = null; }}>
						✏️ Edit
					</button>
					<button class="px-3 py-1.5 bg-purple-500 text-white rounded hover:bg-purple-600 text-sm font-medium"
						onclick={() => { loadIntoStyle(previewItem); previewItem = null; }}>
						✨ Stylize
					</button>
					<button class="px-3 py-1.5 bg-blue-500 text-white rounded hover:bg-blue-600 text-sm font-medium"
						onclick={() => { useAsStartFrame(previewItem); previewItem = null; }}>
						▶ Start
					</button>
					<button class="px-3 py-1.5 bg-green-500 text-white rounded hover:bg-green-600 text-sm font-medium"
						onclick={() => { useAsEndFrame(previewItem); previewItem = null; }}>
						⏹ End
					</button>
					<a href={previewItem.url} download={previewItem.name}
						class="px-3 py-1.5 bg-gray-600 text-white rounded hover:bg-gray-700 text-sm">
						📥
					</a>
		</div>
	{/if}

</div>
	</div>
{/if}

<!-- ═══ MOVE FOLDER PICKER ═══ -->
{#if showMoveFolderPicker}
	<FolderPicker
		onSelect={onMoveFolderSelect}
		onClose={() => { showMoveFolderPicker = false; movingItemIds = null; }}
	/>
{/if}
