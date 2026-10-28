<script>
	import FileTree from './FileTree.svelte';
	import JobsPanel from './JobsPanel.svelte';
	import FramesPanel from './FramesPanel.svelte';
	import CharactersPanel from './CharactersPanel.svelte';
	import FolderPicker from './FolderPicker.svelte';
	import { browser } from '$app/environment';
import { userFiles } from '$lib/stores/userFiles.js';
import { jobQueue } from '$lib/stores/jobQueue.js';
	import {
		activeAssetStore,
	setActiveAssetContext,
	setActiveAssetAutoSave
	} from '$lib/stores/activeAsset.js';

	let activeTab = $state('files'); // 'files' | 'jobs' | 'frames'
let showActiveAssetFolderPicker = $state(false);
let queue = $state([]);

jobQueue.subscribe((value) => {
	queue = value;
});

let activeGenerationJobs = $derived.by(() =>
	queue.filter((job) => job?.status === 'pending' || job?.status === 'processing')
);

let primaryGenerationJob = $derived.by(() => activeGenerationJobs[0] || null);

let primaryGenerationProgress = $derived.by(() => {
	const raw = primaryGenerationJob?.progress;
	if (!Number.isFinite(raw)) return 0;
	return Math.max(0, Math.min(100, Number(raw)));
});

let primaryGenerationText = $derived.by(() => {
	if (!primaryGenerationJob) return '';
	const origin = String(primaryGenerationJob?.origin || '').toLowerCase();
	const rawType = String(primaryGenerationJob?.type || '').toLowerCase();
	const sourceLabel = rawType.includes('genesis')
		? 'Genesis'
		: origin === 'edit'
			? rawType.includes('expand') ? 'Expand' : 'Edit'
			: origin === 'animate'
				? 'Animation'
				: origin === 'design'
					? 'Genesis'
					: rawType.includes('edit')
						? 'Edit'
						: rawType.includes('expand')
							? 'Expand'
							: rawType.includes('animation')
								? 'Animation'
								: 'Generation';
	const name = primaryGenerationJob?.name ? ` (${primaryGenerationJob.name})` : '';
	const msg = primaryGenerationJob?.message ? ` - ${primaryGenerationJob.message}` : '';
	return `${sourceLabel}${name}${msg}`;
});

let generationSummaryText = $derived.by(() => {
	if (!primaryGenerationJob) return '';
	const extra = activeGenerationJobs.length > 1 ? ` + ${activeGenerationJobs.length - 1} more` : '';
	return `${primaryGenerationText}${extra}`;
});

	// ── Event bridges ──────────────────────────────────────
	// Keep lightweight listeners that other panels dispatch so we
	// react appropriately (e.g. switch to frames tab after animation finishes,
	// auto-save sprites to the local library, etc.)

	if (browser) {
		// When an animation completes, flip to the Frames tab
		window.addEventListener('animationCompleted', () => {
			activeTab = 'frames';
		});

		// When an animation job card is selected, open Frames tab to inspect loaded frames.
		window.addEventListener('jobsAnimationSelected', () => {
			activeTab = 'frames';
		});

		// Auto-save disabled - users should explicitly save from Jobs panel
		// Removed autoSaveSprite and saveSpriteToGallery listeners to prevent unwanted saves to root folder
	}

	function onActiveAssetFolderSelect(folderId, folderPath) {
		if (!folderId) return;
		const folderName = String(folderPath || '')
			.split(' / ')
			.filter(Boolean)
			.pop() || 'Folder';
		setActiveAssetContext({
			folderId,
			folderName,
			folderPath,
			chromaKeyHex: $activeAssetStore?.chromaKeyHex || '#00FF00'
		});
		showActiveAssetFolderPicker = false;
	}
</script>

<div class="h-full flex flex-col relative">
	{#if showActiveAssetFolderPicker}
		<FolderPicker
			onSelect={onActiveAssetFolderSelect}
			onClose={() => showActiveAssetFolderPicker = false}
			startFolderId={$activeAssetStore.folderId}
			startFolderName={$activeAssetStore.folderName || 'Folder'}
			modalTitle="📁 Select Folder"
			confirmLabel="Use folder"
		/>
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
		<button
			class="flex-1 px-2 py-2.5 text-xs font-semibold tracking-wide transition-colors
				{activeTab === 'characters'
					? 'bg-amber-50 text-amber-700 border-b-2 border-amber-600'
					: 'text-gray-500 hover:bg-gray-50 hover:text-gray-700'}"
			onclick={() => activeTab = 'characters'}
		>
			🧙 Characters
		</button>
	</div>

	{#if $activeAssetStore.folderId}
		<div class="px-2 py-1.5 border-b bg-emerald-50 text-[11px] text-emerald-800 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
			<div class="min-w-0">
				<p class="font-semibold truncate">📁 Current Folder: {$activeAssetStore.folderName}</p>
				<p class="text-[10px] text-emerald-700/80">Selection is by folder.</p>
			</div>
			<div class="justify-self-center">
				<button
					class="px-3 py-1 rounded border border-emerald-300 bg-white hover:bg-emerald-100 font-medium"
					onclick={() => showActiveAssetFolderPicker = true}
					title="Select or create folder"
				>
					📁 Select Folder
				</button>
			</div>
			<div class="flex items-center gap-2 shrink-0 justify-self-end">
				<label class="flex items-center gap-1">
					<input
						type="checkbox"
						checked={$activeAssetStore.autoSave}
						onchange={(e) => setActiveAssetAutoSave(e.target.checked)}
					/>
					<span>Auto-save</span>
				</label>
			</div>
		</div>
	{/if}

	<!-- ═══ CONTENT ═══ -->
	<div class="flex-1 overflow-hidden">
		{#if activeTab === 'files'}
			<FileTree />
		{:else if activeTab === 'jobs'}
			<JobsPanel />
		{:else if activeTab === 'frames'}
			<FramesPanel />
		{:else if activeTab === 'characters'}
			<CharactersPanel />
		{/if}
	</div>

	{#if primaryGenerationJob}
		<div class="border-t bg-blue-50 px-2 py-1.5">
			<div class="flex items-center justify-between gap-2 text-[10px]">
				<p class="truncate text-blue-800 font-medium">
					⚡ Generating: {generationSummaryText}
				</p>
				<div class="shrink-0 text-blue-700 tabular-nums font-semibold">
					{primaryGenerationProgress}%
				</div>
			</div>
			<div class="mt-1 h-1.5 w-full rounded bg-blue-200 overflow-hidden">
				<div
					class="h-1.5 rounded bg-blue-600 transition-all duration-300"
					style="width: {primaryGenerationProgress}%"
				></div>
			</div>
		</div>
	{/if}
</div>
