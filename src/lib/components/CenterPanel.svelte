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

		// Auto-save a sprite into the Firebase file tree
		window.addEventListener('autoSaveSprite', async (e) => {
			const { image, description, type } = e.detail || {};
			if (!image) return;
			try {
				const uid = userFiles.getUid();
				if (!uid) { console.warn('[CenterPanel] No UID – cannot auto-save'); return; }

				// Upload via our existing endpoint
				const res = await fetch('/api/upload-file', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ imageData: image, filename: `${(description || 'sprite').slice(0, 30)}.png`, folder: 'root' })
				});
				if (!res.ok) throw new Error((await res.json()).error || 'Upload failed');
				const { url } = await res.json();

				// Record in Firestore under the current folder (or root)
				const state = /** @type {any} */ (null);
				// We don't have direct access to the store value here, so save to root
				await createFile(uid, null, `${(description || 'sprite').slice(0, 30)}.png`, url, 'image', {
					sourceType: 'generation', prompt: description, assetType: type
				});
				console.log('[CenterPanel] Auto-saved sprite to Firebase');
			} catch (err) {
				console.error('[CenterPanel] Auto-save error:', err);
			}
		});

		// Legacy: saveSpriteToGallery → also save to Firebase
		window.addEventListener('saveSpriteToGallery', async (e) => {
			const { image, description, type, style } = e.detail || {};
			if (!image) return;
			try {
				const uid = userFiles.getUid();
				if (!uid) return;

				const res = await fetch('/api/upload-file', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ imageData: image, filename: `${(description || 'sprite').slice(0, 30)}.png`, folder: 'root' })
				});
				if (!res.ok) throw new Error((await res.json()).error || 'Upload failed');
				const { url } = await res.json();

				await createFile(uid, null, `${(description || 'sprite').slice(0, 30)}.png`, url, 'image', {
					sourceType: 'generation', prompt: description, assetType: type, style
				});
				activeTab = 'files';
			} catch (err) {
				console.error('[CenterPanel] Save sprite error:', err);
			}
		});
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
