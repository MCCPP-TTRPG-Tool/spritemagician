<script>
	import { projectStore } from '$lib/stores/project.js';
	import { generateSpriteSheet, loadImage, downloadBlob } from '$lib/utils/spriteSheet.js';
	import { generateGif } from '$lib/utils/gifEncoder.js';
	import { userFiles } from '$lib/stores/userFiles.js';
	import { createFile } from '$lib/firebase/firestore.js';
	import FolderPicker from './FolderPicker.svelte';
	
	let project = $state({ frames: [], fps: 12 });
	
	projectStore.subscribe(value => {
		project = value;
	});
	
	let isExporting = $state(false);
	let isGeneratingPreview = $state(false);
	let isGeneratingGif = $state(false);
	let spriteSheetPreview = $state(null);
	let gifPreview = $state(null);
	let showGifModal = $state(false);
	let previewColumns = $state(4);
	let frameSize = $state(128);
	let showFullSize = $state(false);

	// Save to folder state
	let showFolderPicker = $state(false);
	let saveFolderId = $state(null);
	let saveFolderPath = $state(null);
	let isSaving = $state(false);

	function closePreview() {
		if (spriteSheetPreview) {
			URL.revokeObjectURL(spriteSheetPreview);
		}
		spriteSheetPreview = null;
		showFullSize = false;
	}
	
	function openFullSize() {
		showFullSize = true;
	}
	
	function closeFullSize() {
		showFullSize = false;
	}
	
	async function generatePreview() {
		if (project.frames.length === 0) return;
		isGeneratingPreview = true;
		try {
			const images = await Promise.all(project.frames.map(loadImage));
			const columns = Math.min(previewColumns, project.frames.length);
			const blob = await generateSpriteSheet(images, frameSize, frameSize, columns);
			
			// Clean up old preview URL
			if (spriteSheetPreview) {
				URL.revokeObjectURL(spriteSheetPreview);
			}
			spriteSheetPreview = URL.createObjectURL(blob);
		} catch (e) {
			console.error('Preview error:', e);
			spriteSheetPreview = null;
		} finally {
			isGeneratingPreview = false;
		}
	}

	async function handleExportFrames() {
		if (project.frames.length === 0) return;
		isExporting = true;
		try {
			for (let i = 0; i < project.frames.length; i++) {
				const frame = project.frames[i];
				const img = await loadImage(frame);
				
				const canvas = document.createElement('canvas');
				canvas.width = frameSize;
				canvas.height = frameSize;
				const ctx = canvas.getContext('2d');
				ctx.clearRect(0, 0, canvas.width, canvas.height);
				ctx.drawImage(img, 0, 0, frameSize, frameSize);
				
				canvas.toBlob((blob) => {
					downloadBlob(blob, `frame_${String(i).padStart(3, '0')}.png`);
				}, 'image/png');
				
				await new Promise(resolve => setTimeout(resolve, 100));
			}
		} finally {
			isExporting = false;
		}
	}

	async function handleExportSpriteSheet() {
		if (project.frames.length === 0) return;
		isExporting = true;
		try {
			const images = await Promise.all(project.frames.map(loadImage));
			const columns = Math.min(previewColumns, project.frames.length);
			const blob = await generateSpriteSheet(images, frameSize, frameSize, columns);
			downloadBlob(blob, 'sprite_sheet.png');
		} finally {
			isExporting = false;
		}
	}
	
	async function handlePreviewGif() {
		if (project.frames.length === 0) return;
		isGeneratingGif = true;
		try {
			const blob = await generateGif(project.frames, frameSize, project.fps || 12);
			// Clean up old preview
			if (gifPreview) {
				URL.revokeObjectURL(gifPreview);
			}
			gifPreview = URL.createObjectURL(blob);
			showGifModal = true;
		} catch (e) {
			console.error('GIF generation error:', e);
			alert('Failed to generate GIF: ' + e.message);
		} finally {
			isGeneratingGif = false;
		}
	}
	
	async function handleDownloadGif() {
		if (project.frames.length === 0) return;
		isGeneratingGif = true;
		try {
			const blob = await generateGif(project.frames, frameSize, project.fps || 12);
			downloadBlob(blob, 'animation.gif');
		} catch (e) {
			console.error('GIF generation error:', e);
			alert('Failed to generate GIF: ' + e.message);
		} finally {
			isGeneratingGif = false;
		}
	}
	
	function closeGifModal() {
		showGifModal = false;
	}
	
	function downloadGifFromModal() {
		if (gifPreview) {
			const a = document.createElement('a');
			a.href = gifPreview;
			a.download = 'animation.gif';
			a.click();
		}
	}

	async function onFolderSelect(folderId, folderPath) {
		saveFolderId = folderId;
		saveFolderPath = folderPath;
		showFolderPicker = false;
		// Auto-save after selecting folder
		if (project.frames.length > 0) {
			await performSave();
		}
	}

	async function performSave() {
		if (!project.frames.length) return;

		isSaving = true;
		try {
			const uid = userFiles.getUid();
			if (!uid) throw new Error('Not signed in');

			const animationName = project.prompt || `animation_${Date.now()}`;
			const sanitizedName = animationName.slice(0, 30).replace(/[^a-zA-Z0-9_-]/g, '_');

			// Use the dedicated save-animation endpoint (avoids double-base64 overhead)
			const res = await fetch('/api/save-animation', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					name: sanitizedName,
					frames: project.frames,
					fps: project.fps || 12,
					prompt: project.prompt || ''
				})
			});
			if (!res.ok) {
				const errData = await res.json().catch(() => ({}));
				throw new Error(errData.error || 'Upload failed');
			}
			const { url, frameCount } = await res.json();

			// Create a Firestore file entry so it appears in the file tree
			const fname = `${sanitizedName}.anim.json`;
			await createFile(uid, saveFolderId, fname, url, 'animation', {
				sourceType: 'animation',
				frameCount,
				fps: project.fps || 12,
				animationName: sanitizedName,
				prompt: project.prompt || ''
			});

			alert(`Animation saved! ${frameCount} frames → ${saveFolderPath || 'root'}`);
		} catch (err) {
			console.error('Save error:', err);
			alert('Failed to save animation: ' + err.message);
		} finally {
			isSaving = false;
		}
	}

	async function saveToFolder() {
		if (!project.frames.length) {
			alert('No frames to save');
			return;
		}
		
		if (!saveFolderId) {
			showFolderPicker = true;
			return;
		}

		await performSave();
	}
</script>

<div class="space-y-3">
	<h2 class="text-sm font-bold">Export</h2>
	
	{#if project.frames.length > 0}
		<!-- Settings -->
		<div class="grid grid-cols-2 gap-2">
			<div>
				<label class="block text-xs text-gray-600 mb-1">Columns</label>
				<select 
					bind:value={previewColumns}
					class="w-full px-2 py-1 text-xs border rounded"
				>
					<option value={2}>2</option>
					<option value={4}>4</option>
					<option value={6}>6</option>
					<option value={8}>8</option>
					<option value={project.frames.length}>1 Row ({project.frames.length})</option>
				</select>
			</div>
			<div>
				<label class="block text-xs text-gray-600 mb-1">Frame Size</label>
				<select 
					bind:value={frameSize}
					class="w-full px-2 py-1 text-xs border rounded"
				>
					<option value={64}>64px</option>
					<option value={128}>128px</option>
					<option value={256}>256px</option>
					<option value={512}>512px</option>
				</select>
			</div>
		</div>
		
		<!-- Spritesheet Preview -->
		{#if spriteSheetPreview}
			<div class="bg-gray-100 border rounded p-2 relative">
				<div class="flex items-center justify-between mb-2">
					<p class="text-xs text-gray-600">Spritesheet Preview <span class="text-gray-400">(click to enlarge)</span></p>
					<button
						onclick={closePreview}
						class="text-gray-500 hover:text-gray-700 text-sm px-1"
						title="Close preview"
					>
						✕
					</button>
				</div>
				<img 
					src={spriteSheetPreview} 
					alt="Spritesheet preview" 
					class="w-full max-h-48 object-contain bg-white border rounded cursor-pointer hover:opacity-80 transition-opacity"
					style="image-rendering: pixelated;"
					onclick={openFullSize}
					onkeydown={(e) => { if (e.key === 'Enter') openFullSize(); }}
					tabindex="0"
					role="button"
				/>
			</div>
		{/if}
	{/if}
	
	<!-- Full Size Modal -->
	{#if showFullSize && spriteSheetPreview}
		<div 
			class="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
			onclick={closeFullSize}
			onkeydown={(e) => { if (e.key === 'Escape') closeFullSize(); }}
			tabindex="0"
			role="dialog"
		>
			<div class="relative max-w-full max-h-full">
				<button
					onclick={closeFullSize}
					class="absolute -top-10 right-0 text-white hover:text-gray-300 text-2xl"
					title="Close"
				>
					✕
				</button>
				<img 
					src={spriteSheetPreview} 
					alt="Spritesheet full size" 
					class="max-w-full max-h-[90vh] object-contain bg-gray-900 border-2 border-gray-700 rounded"
					style="image-rendering: pixelated;"
					onclick={(e) => e.stopPropagation()}
				/>
				<p class="text-center text-gray-400 text-sm mt-2">
					{project.frames.length} frames • {previewColumns} cols • {frameSize}px
				</p>
			</div>
		</div>
	{/if}
	
	<!-- GIF Preview Modal -->
	{#if showGifModal && gifPreview}
		<div 
			class="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
			onclick={closeGifModal}
			onkeydown={(e) => { if (e.key === 'Escape') closeGifModal(); }}
			tabindex="0"
			role="dialog"
		>
			<div class="relative max-w-full max-h-full bg-gray-900 rounded-lg p-4" onclick={(e) => e.stopPropagation()}>
				<button
					onclick={closeGifModal}
					class="absolute top-2 right-2 text-white hover:text-gray-300 text-2xl z-10"
					title="Close"
				>
					✕
				</button>
				
				<h3 class="text-white text-lg font-bold mb-3 text-center">🎬 GIF Preview</h3>
				
				<div class="bg-gray-700 rounded-lg p-2 mb-3">
					<img 
						src={gifPreview} 
						alt="Animation GIF preview" 
						class="max-w-full max-h-[60vh] object-contain mx-auto"
						style="image-rendering: pixelated;"
					/>
				</div>
				
				<div class="flex justify-center gap-3">
					<button
						onclick={downloadGifFromModal}
						class="px-4 py-2 bg-pink-500 text-white rounded hover:bg-pink-600 font-medium"
					>
						⬇️ Download GIF
					</button>
					<button
						onclick={closeGifModal}
						class="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-500"
					>
						Close
					</button>
				</div>
				
				<p class="text-center text-gray-400 text-sm mt-3">
					{project.frames.length} frames • {project.fps || 12} fps • {frameSize}px
				</p>
			</div>
		</div>
	{/if}
	
	<!-- Action Buttons Row 1 -->
	<div class="grid grid-cols-3 gap-2">
		<button
			class="px-2 py-1.5 text-xs bg-blue-500 text-white rounded hover:bg-blue-600 disabled:bg-gray-400 disabled:cursor-not-allowed"
			onclick={generatePreview}
			disabled={isGeneratingPreview || project.frames.length === 0}
		>
			{isGeneratingPreview ? '...' : '👁️ Preview'}
		</button>
		
		<button
			class="px-2 py-1.5 text-xs bg-green-500 text-white rounded hover:bg-green-600 disabled:bg-gray-400 disabled:cursor-not-allowed"
			onclick={handleExportFrames}
			disabled={isExporting || project.frames.length === 0}
		>
			{isExporting ? '...' : '📁 Frames'}
		</button>
		
		<button
			class="px-2 py-1.5 text-xs bg-purple-500 text-white rounded hover:bg-purple-600 disabled:bg-gray-400 disabled:cursor-not-allowed"
			onclick={handleExportSpriteSheet}
			disabled={isExporting || project.frames.length === 0}
		>
			{isExporting ? '...' : '🖼️ Sheet'}
		</button>
	</div>
	
	<!-- GIF Buttons Row 2 -->
	<div class="grid grid-cols-2 gap-2">
		<button
			class="px-2 py-1.5 text-xs bg-orange-500 text-white rounded hover:bg-orange-600 disabled:bg-gray-400 disabled:cursor-not-allowed"
			onclick={handlePreviewGif}
			disabled={isGeneratingGif || project.frames.length === 0}
		>
			{isGeneratingGif ? 'Generating...' : '🎬 Preview GIF'}
		</button>
		
		<button
			class="px-2 py-1.5 text-xs bg-pink-500 text-white rounded hover:bg-pink-600 disabled:bg-gray-400 disabled:cursor-not-allowed"
			onclick={handleDownloadGif}
			disabled={isGeneratingGif || project.frames.length === 0}
		>
			{isGeneratingGif ? 'Generating...' : '⬇️ Download GIF'}
		</button>
	</div>

	<!-- Save to Folder -->
	{#if project.frames.length > 0}
		<div class="border-t pt-2 mt-2">
			<div class="flex items-center gap-2 p-2 bg-gray-50 rounded-lg border border-gray-200 mb-2">
				<span class="text-[10px] text-gray-500 font-medium whitespace-nowrap">Save to:</span>
				<button
					class="flex-1 text-left px-2 py-1 text-[11px] rounded border transition-colors truncate
						{saveFolderPath
							? 'bg-white border-blue-300 text-blue-700 hover:bg-blue-50 font-medium'
							: 'bg-white border-gray-300 text-gray-400 hover:bg-gray-100'}"
					onclick={() => showFolderPicker = true}
				>
					{saveFolderPath || '📁 Choose folder…'}
				</button>
				{#if saveFolderPath}
					<button
						class="text-[10px] text-gray-400 hover:text-red-500"
						onclick={() => { saveFolderId = null; saveFolderPath = null; }}
						title="Clear"
					>✕</button>
				{/if}
			</div>
			<button
				class="w-full px-2 py-1.5 text-xs bg-indigo-500 text-white rounded hover:bg-indigo-600 disabled:bg-gray-400 disabled:cursor-not-allowed font-medium"
				onclick={saveToFolder}
				disabled={isSaving || project.frames.length === 0}
			>
				{#if isSaving}
					<span class="inline-flex items-center gap-1.5">
						<span class="animate-spin">⏳</span> Saving {project.frames.length} frames...
					</span>
				{:else}
					💾 Save Animation to Folder
				{/if}
			</button>
		</div>
	{/if}

	{#if project.frames.length > 0}
		<p class="text-xs text-gray-600 text-center">
			{project.frames.length} frames • {previewColumns} cols • {frameSize}px
		</p>
	{:else}
		<p class="text-xs text-gray-500 text-center">Generate frames to export</p>
	{/if}
</div>

<!-- Folder Picker Modal -->
{#if showFolderPicker}
	<FolderPicker
		onSelect={onFolderSelect}
		onClose={() => showFolderPicker = false}
	/>
{/if}
