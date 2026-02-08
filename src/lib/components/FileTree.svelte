<script>
	import { userFiles } from '$lib/stores/userFiles.js';
	import { projectStore } from '$lib/stores/project.js';
	import {
		createFolder,
		createFile,
		renameItem,
		deleteItem,
		deleteFolderRecursive
	} from '$lib/firebase/firestore.js';

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
	let fileInputEl;

	const folders = $derived(fs.items.filter(i => i.isFolder));
	const files   = $derived(fs.items.filter(i => !i.isFolder));

	// ── actions ─────────────────────────────────────────────

	async function doCreateFolder() {
		const name = newFolderName.trim();
		if (!name) {
			alert('Please enter a folder name');
			return;
		}
		
		try {
			// Use server-side API (works with session cookie auth, doesn't need client-side Firebase auth)
			const res = await fetch('/api/create-folder', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					name,
					parentId: fs.currentFolderId || null
				})
			});

			if (!res.ok) {
				const data = await res.json();
				throw new Error(data.error || 'Failed to create folder');
			}

			const result = await res.json();
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

	function clickItem(item) {
		selectedId = selectedId === item.id ? null : item.id;
	}

	function dblClickItem(item) {
		if (item.isFolder) {
			selectedId = null;
			userFiles.openFolder(item.id, item.name);
		} else {
			previewItem = item;
		}
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

				await createFile(fs.uid, fs.currentFolderId, file.name, url, ft, {
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

	function useAsReference(item) {
		if (!item.url) return;
		projectStore.update(p => ({ ...p, firstFrame: item.url }));
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
</script>

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

	<!-- ═══ BREADCRUMB BAR ═══ -->
	<div class="flex items-center gap-1 px-2 py-1.5 bg-gray-100 border-b rounded-t text-[11px] flex-shrink-0 min-h-[32px]">
		<!-- Back -->
		<button
			class="p-1 rounded hover:bg-gray-200 disabled:opacity-30"
			disabled={fs.breadcrumbs.length === 0}
			onclick={() => userFiles.goBack()}
			title="Back"
		>←</button>
		<!-- Up -->
		<button
			class="p-1 rounded hover:bg-gray-200 disabled:opacity-30"
			disabled={fs.breadcrumbs.length === 0}
			onclick={() => userFiles.goToRoot()}
			title="Root"
		>⬆</button>

		<span class="mx-1 text-gray-300">|</span>

		<!-- Crumbs -->
		<button class="px-1 py-0.5 rounded hover:bg-gray-200 font-medium text-blue-600" onclick={() => userFiles.goToBreadcrumb(-1)}>
			📁 My Files
		</button>
		{#each fs.breadcrumbs as crumb, i}
			<span class="text-gray-400">&gt;</span>
			<button class="px-1 py-0.5 rounded hover:bg-gray-200 font-medium text-blue-600 truncate max-w-[100px]"
				onclick={() => userFiles.goToBreadcrumb(i)}
			>{crumb.name}</button>
		{/each}

		<div class="flex-1"></div>

		<!-- View toggle -->
		<button class="p-1 rounded {viewMode === 'grid' ? 'bg-blue-100 text-blue-700' : 'hover:bg-gray-200'}"
			onclick={() => viewMode = 'grid'} title="Grid view">⊞</button>
		<button class="p-1 rounded {viewMode === 'list' ? 'bg-blue-100 text-blue-700' : 'hover:bg-gray-200'}"
			onclick={() => viewMode = 'list'} title="List view">≡</button>
	</div>

	<!-- ═══ TOOLBAR ═══ -->
	<div class="flex items-center gap-1.5 px-2 py-1.5 bg-white border-b flex-shrink-0">
		<button class="px-2 py-1 rounded bg-blue-50 text-blue-700 hover:bg-blue-100 font-medium"
			onclick={() => { showNewFolder = true; newFolderName = ''; }}>
			📁 New Folder
		</button>
		<button class="px-2 py-1 rounded bg-green-50 text-green-700 hover:bg-green-100 font-medium {uploading ? 'opacity-50 pointer-events-none' : ''}"
			onclick={triggerUpload}>
			{uploading ? '⏳ Uploading…' : '⬆ Upload'}
		</button>
		{#if selectedId}
			{@const sel = fs.items.find(i => i.id === selectedId)}
			{#if sel}
				<span class="mx-1 text-gray-300">|</span>
				<button class="px-2 py-1 rounded hover:bg-gray-100" onclick={() => doRename(sel)} title="Rename">✏️</button>
				{#if !sel.isFolder && sel.url}
					<button class="px-2 py-1 rounded hover:bg-gray-100" onclick={() => useAsReference(sel)} title="Use as reference">🎯</button>
				{/if}
				<button class="px-2 py-1 rounded hover:bg-red-50 text-red-600" onclick={() => doDelete(sel)} title="Delete">🗑</button>
			{/if}
		{/if}
	</div>

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
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div
						class="relative group rounded-lg border-2 overflow-hidden cursor-pointer transition-all
							{selectedId === item.id ? 'border-blue-500 bg-blue-50' : 'border-transparent hover:border-gray-300 bg-white'}"
						onclick={() => clickItem(item)}
						ondblclick={() => dblClickItem(item)}
					>
						<div class="aspect-square flex items-center justify-center bg-gray-50 relative">
							{#if item.isFolder}
								<span class="text-5xl select-none">📁</span>
							{:else if item.url}
								<img src={item.url} alt={item.name} class="w-full h-full object-contain" loading="lazy" />
							{:else}
								<span class="text-4xl select-none">{icon(item)}</span>
							{/if}

							<!-- Hover overlay -->
							<div class="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors"></div>

							<!-- Quick actions (top-right) -->
							<div class="absolute top-1 right-1 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
								<button class="w-5 h-5 rounded-full bg-white/90 shadow text-[10px] flex items-center justify-center hover:scale-110"
									onclick={(e) => { e.stopPropagation(); doRename(item); }} title="Rename">✏️</button>
								<button class="w-5 h-5 rounded-full bg-red-500 text-white shadow text-[10px] flex items-center justify-center hover:scale-110"
									onclick={(e) => { e.stopPropagation(); doDelete(item); }} title="Delete">×</button>
							</div>
						</div>
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
						<th class="py-1 px-2 font-medium">Name</th>
						<th class="py-1 px-2 font-medium w-20">Type</th>
						<th class="py-1 px-2 font-medium w-20">Date</th>
						<th class="py-1 px-2 font-medium w-16 text-right">Size</th>
					</tr>
				</thead>
				<tbody>
					{#each fs.items as item (item.id)}
						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<tr
							class="border-b border-gray-100 cursor-pointer transition-colors
								{selectedId === item.id ? 'bg-blue-50' : 'hover:bg-gray-50'}"
							onclick={() => clickItem(item)}
							ondblclick={() => dblClickItem(item)}
						>
							<td class="py-1.5 px-2 flex items-center gap-2">
								<span class="text-sm">{icon(item)}</span>
								<span class="truncate font-medium">{item.name}</span>
							</td>
							<td class="py-1.5 px-2 text-gray-500">{item.isFolder ? 'Folder' : (item.fileType || 'File')}</td>
							<td class="py-1.5 px-2 text-gray-500">{fmtDate(item.createdAt)}</td>
							<td class="py-1.5 px-2 text-gray-500 text-right">{item.isFolder ? '—' : fmtSize(item.size)}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}
	</div>

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
			<div class="flex justify-center gap-2 mt-3">
				{#if previewItem.url}
					<button class="px-3 py-1.5 bg-blue-500 text-white rounded hover:bg-blue-600 text-sm"
						onclick={() => { useAsReference(previewItem); previewItem = null; }}>
						🎯 Use as Reference
					</button>
					<a href={previewItem.url} download={previewItem.name}
						class="px-3 py-1.5 bg-green-500 text-white rounded hover:bg-green-600 text-sm">
						📥 Download
					</a>
				{/if}
			</div>
		</div>
	</div>
{/if}
