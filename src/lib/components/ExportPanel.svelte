<script>
	import { projectStore } from '$lib/stores/project.js';
	import { generateSpriteSheet, loadImage, downloadBlob } from '$lib/utils/spriteSheet.js';
	
	let project = $state({ frames: [], fps: 12 });
	
	projectStore.subscribe(value => {
		project = value;
	});
	
	let isExporting = $state(false);
	let isGeneratingPreview = $state(false);
	let spriteSheetPreview = $state(null);
	let previewColumns = $state(4);
	let frameSize = $state(128);
	let showFullSize = $state(false);

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
	
	<!-- Action Buttons -->
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

	{#if project.frames.length > 0}
		<p class="text-xs text-gray-600 text-center">
			{project.frames.length} frames • {previewColumns} cols • {frameSize}px
		</p>
	{:else}
		<p class="text-xs text-gray-500 text-center">Generate frames to export</p>
	{/if}
</div>
