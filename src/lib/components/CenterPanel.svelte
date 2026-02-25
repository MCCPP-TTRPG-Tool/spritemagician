<script>
	import FileTree from './FileTree.svelte';
	import JobsPanel from './JobsPanel.svelte';
	import FramesPanel from './FramesPanel.svelte';
	import { browser } from '$app/environment';
import { userFiles } from '$lib/stores/userFiles.js';
import { updateFolderChromaKey } from '$lib/firebase/firestore.js';
	import {
		activeAssetStore,
		clearActiveAssetContext,
	setActiveAssetAutoSave,
	setActiveAssetChromaKeyHex
	} from '$lib/stores/activeAsset.js';

	let activeTab = $state('files'); // 'files' | 'jobs' | 'frames'
let isSavingChroma = $state(false);
let chromaUiNote = $state('');

	// ── Event bridges ──────────────────────────────────────
	// Keep lightweight listeners that other panels dispatch so we
	// react appropriately (e.g. switch to frames tab after animation finishes,
	// auto-save sprites to Firebase file tree, etc.)

	if (browser) {
		// When an animation completes, flip to the Frames tab
		window.addEventListener('animationCompleted', () => {
			activeTab = 'frames';
		});

		// Auto-save disabled - users should explicitly save from Jobs panel
		// Removed autoSaveSprite and saveSpriteToGallery listeners to prevent unwanted saves to root folder
	}

	async function saveAssetChromaKey(hex) {
		if (!$activeAssetStore?.folderId || !/^#[0-9A-Fa-f]{6}$/.test(hex)) return;
		const uid = userFiles.getUid();
		if (!uid) return;
		isSavingChroma = true;
		chromaUiNote = '';
		try {
			const normalized = hex.toUpperCase();
			await updateFolderChromaKey(uid, $activeAssetStore.folderId, normalized);
			setActiveAssetChromaKeyHex(normalized);
			chromaUiNote = 'Saved';
		} catch (err) {
			chromaUiNote = 'Save failed';
		} finally {
			isSavingChroma = false;
		}
	}
</script>

<div class="h-full flex flex-col relative">
	{#if $activeAssetStore.folderId}
		<div class="px-2 py-1.5 border-b bg-emerald-50 text-[11px] text-emerald-800 flex items-center justify-between gap-2">
			<div class="min-w-0">
				<p class="font-semibold truncate">🎯 Active Asset: {$activeAssetStore.folderName}</p>
				<p class="text-emerald-700/80 truncate">{$activeAssetStore.folderPath}</p>
			</div>
			<div class="flex items-center gap-2 shrink-0">
				<label class="flex items-center gap-1">
					<input
						type="checkbox"
						checked={$activeAssetStore.autoSave}
						onchange={(e) => setActiveAssetAutoSave(e.target.checked)}
					/>
					<span>Auto-save</span>
				</label>
				<label class="flex items-center gap-1">
					<span>BG</span>
					<input
						type="color"
						value={$activeAssetStore.chromaKeyHex || '#00FF00'}
						class="w-7 h-6 p-0 border rounded cursor-pointer"
						onchange={(e) => saveAssetChromaKey(e.target.value)}
						title="Background chroma key color"
					/>
				</label>
				{#if isSavingChroma}
					<span class="text-[10px] text-emerald-700">Saving...</span>
				{:else if chromaUiNote}
					<span class="text-[10px] text-emerald-700">{chromaUiNote}</span>
				{/if}
				<button
					class="px-2 py-1 rounded border border-emerald-300 bg-white hover:bg-emerald-100"
					onclick={clearActiveAssetContext}
				>
					Clear
				</button>
			</div>
		</div>
	{/if}

	<!-- ═══ TAB BAR ═══ -->
	<div class="flex border-b flex-shrink-0">
		<button
			class="flex-1 px-2 py-2.5 text-xs font-semibold tracking-wide transition-colors
				{activeTab === 'files'
					? 'bg-emerald-50 text-emerald-700 border-b-2 border-emerald-600'
					: 'text-gray-500 hover:bg-gray-50 hover:text-gray-700'}"
			onclick={() => activeTab = 'files'}
		>
			📁 File Tree
		</button>
		<button
			class="flex-1 px-2 py-2.5 text-xs font-semibold tracking-wide transition-colors
				{activeTab === 'jobs'
					? 'bg-purple-50 text-purple-700 border-b-2 border-purple-600'
					: 'text-gray-500 hover:bg-gray-50 hover:text-gray-700'}"
			onclick={() => activeTab = 'jobs'}
		>
			⚡ Jobs
		</button>
		<button
			class="flex-1 px-2 py-2.5 text-xs font-semibold tracking-wide transition-colors
				{activeTab === 'frames'
					? 'bg-blue-50 text-blue-700 border-b-2 border-blue-600'
					: 'text-gray-500 hover:bg-gray-50 hover:text-gray-700'}"
			onclick={() => activeTab = 'frames'}
		>
			🎞️ Frames
		</button>
	</div>

	<!-- ═══ CONTENT ═══ -->
	<div class="flex-1 overflow-hidden">
		{#if activeTab === 'files'}
			<FileTree />
		{:else if activeTab === 'jobs'}
			<JobsPanel />
		{:else if activeTab === 'frames'}
			<FramesPanel />
		{/if}
	</div>
</div>
