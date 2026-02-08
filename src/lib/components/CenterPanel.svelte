<script>
	import FileTree from './FileTree.svelte';
	import JobsPanel from './JobsPanel.svelte';
	import FramesPanel from './FramesPanel.svelte';
	import { browser } from '$app/environment';
	import { projectStore } from '$lib/stores/project.js';
	import { userFiles } from '$lib/stores/userFiles.js';
	import { createFile } from '$lib/firebase/firestore.js';

	let activeTab = $state('files'); // 'files' | 'jobs' | 'frames'

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
</script>

<div class="h-full flex flex-col">
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
