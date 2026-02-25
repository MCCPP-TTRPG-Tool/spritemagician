<script>
	import { getChildren } from '$lib/firebase/firestore.js';
	import { userFiles } from '$lib/stores/userFiles.js';

	let {
		onSelect = null,
		onClose = null,
		startFolderId = null,
		startFolderName = 'Root'
	} = $props();

	let folders = $state([]);
	let breadcrumbs = $state([]);
	let loading = $state(true);
	let newFolderName = $state('');
	let showNewFolder = $state(false);
	let creating = $state(false);
	let currentCrumb = $derived(breadcrumbs.length ? breadcrumbs[breadcrumbs.length - 1] : { id: null, name: 'Root' });

	$effect(() => {
		const initialId = startFolderId || null;
		const initialName = initialId ? (startFolderName || 'Asset') : 'Root';
		breadcrumbs = [{ id: initialId, name: initialName }];
		loadFolders(initialId);
	});

	async function loadFolders(parentId) {
		loading = true;
		try {
			const uid = userFiles.getUid();
			if (!uid) {
				console.warn('[FolderPicker] No uid available — cannot load folders');
				return;
			}
			const items = await getChildren(uid, parentId);
			folders = items.filter(i => i.isFolder);
		} catch (e) {
			console.error('[FolderPicker] loadFolders error:', e);
		} finally {
			loading = false;
		}
	}

	async function navigateInto(folder) {
		breadcrumbs = [...breadcrumbs, { id: folder.id, name: folder.name }];
		await loadFolders(folder.id);
	}

	async function navigateTo(index) {
		breadcrumbs = breadcrumbs.slice(0, index + 1);
		await loadFolders(breadcrumbs[index].id);
	}

	function selectCurrent() {
		const current = currentCrumb;
		const pathStr = breadcrumbs.map(p => p.name).join(' / ');
		onSelect?.(current.id, pathStr);
	}

	async function doCreateFolder() {
		const name = newFolderName.trim();
		if (!name) return;
		creating = true;
		try {
			const parentId = breadcrumbs[breadcrumbs.length - 1]?.id ?? null;
			const res = await fetch('/api/create-folder', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name, parentId })
			});
			if (!res.ok) {
				const err = await res.json().catch(() => ({}));
				throw new Error(err.error || `Server returned ${res.status}`);
			}
			const result = await res.json();

			// Optimistic update — add new folder to list immediately
			folders = [...folders, {
				id: result.id,
				name: result.name,
				isFolder: true,
				parentId
			}].sort((a, b) => a.name.localeCompare(b.name));

			newFolderName = '';
			showNewFolder = false;

			// Also refresh from Firestore in background (in case of inconsistencies)
			setTimeout(() => loadFolders(parentId), 600);
		} catch (e) {
			console.error('[FolderPicker] Create folder error:', e);
			alert('Create folder failed: ' + e.message);
		} finally {
			creating = false;
		}
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
	onclick={onClose}
	onkeydown={(e) => { if (e.key === 'Escape') onClose?.(); }}
>
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="bg-white rounded-xl shadow-2xl w-full max-w-md" onclick={(e) => e.stopPropagation()}>
		<!-- Header -->
		<div class="flex items-center justify-between px-4 py-3 border-b">
			<h3 class="text-sm font-bold text-gray-800">📁 Save to Folder</h3>
			<button class="text-gray-400 hover:text-gray-600 text-lg" onclick={onClose}>✕</button>
		</div>

		<!-- Breadcrumbs -->
		<div class="px-4 py-2 flex items-center gap-1 text-xs text-gray-500 overflow-x-auto border-b bg-gray-50">
			{#each breadcrumbs as crumb, i}
				{#if i > 0}<span class="text-gray-300">/</span>{/if}
				<button class="hover:text-blue-600 font-medium whitespace-nowrap" onclick={() => navigateTo(i)}>
					{crumb.name}
				</button>
			{/each}
		</div>

		<!-- Folder List -->
		<div class="max-h-60 overflow-y-auto p-2 min-h-[120px]">
			{#if loading}
				<p class="text-xs text-gray-400 text-center py-4">Loading...</p>
			{:else if folders.length === 0}
				<p class="text-xs text-gray-400 text-center py-4 italic">No subfolders</p>
			{:else}
				{#each folders as folder}
					<button
						class="w-full flex items-center gap-2 px-3 py-2 text-xs text-left rounded-lg hover:bg-blue-50 transition-colors"
						onclick={() => navigateInto(folder)}
					>
						<span class="text-base">📁</span>
						<span class="font-medium text-gray-700">{folder.name}</span>
					</button>
				{/each}
			{/if}
		</div>

		<!-- New Folder -->
		<div class="px-4 py-2 border-t">
			{#if showNewFolder}
				<div class="flex gap-2">
					<!-- svelte-ignore a11y_autofocus -->
					<input
						bind:value={newFolderName}
						placeholder="Folder name..."
						autofocus
						disabled={creating}
						class="flex-1 px-2 py-1.5 text-xs border rounded focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none disabled:opacity-50"
						onkeydown={(e) => { if (e.key === 'Enter') doCreateFolder(); if (e.key === 'Escape') { showNewFolder = false; newFolderName = ''; } }}
					/>
					<button
						class="px-3 py-1.5 text-xs bg-blue-500 text-white rounded hover:bg-blue-600 font-medium disabled:opacity-50 disabled:cursor-wait"
						onclick={doCreateFolder}
						disabled={creating || !newFolderName.trim()}
					>
						{creating ? '⏳' : 'Create'}
					</button>
					<button
						class="px-2 py-1.5 text-xs text-gray-500 hover:text-gray-700"
						onclick={() => { showNewFolder = false; newFolderName = ''; }}
						disabled={creating}
					>✕</button>
				</div>
			{:else}
				<button class="text-xs text-blue-600 hover:text-blue-800 font-medium" onclick={() => showNewFolder = true}>
					+ New Folder
				</button>
			{/if}
		</div>

		<!-- Actions -->
		<div class="flex justify-end gap-2 px-4 py-3 border-t bg-gray-50 rounded-b-xl">
			<button class="px-4 py-1.5 text-xs text-gray-600 hover:bg-gray-200 rounded-lg" onclick={onClose}>
				Cancel
			</button>
			<button
				class="px-4 py-1.5 text-xs bg-blue-500 text-white rounded-lg hover:bg-blue-600 font-medium"
				onclick={selectCurrent}
			>
				💾 Save to: {currentCrumb?.name || 'Root'}
			</button>
		</div>
	</div>
</div>
