<script>
	import { projectStore } from '$lib/stores/project.js';
	import { exportIndividualFrames, exportSpriteSheet } from '$lib/utils/projectExport.js';
	
	let project = $state({ frames: [], fps: 12 });
	
	projectStore.subscribe(value => {
		project = value;
	});
	
	let isExporting = $state(false);

	async function handleExportFrames() {
		if (project.frames.length === 0) return;
		isExporting = true;
		try {
			await exportIndividualFrames(project.frames);
		} finally {
			isExporting = false;
		}
	}

	async function handleExportSpriteSheet() {
		if (project.frames.length === 0) return;
		isExporting = true;
		try {
			await exportSpriteSheet(project.frames, project.frames.length);
		} finally {
			isExporting = false;
		}
	}
</script>

<div class="space-y-2">
	<h2 class="text-sm font-bold">Export</h2>
	
	<div class="grid grid-cols-2 gap-2">
		<button
			class="px-2 py-1.5 text-xs bg-green-500 text-white rounded hover:bg-green-600 disabled:bg-gray-400 disabled:cursor-not-allowed"
			onclick={handleExportFrames}
			disabled={isExporting || project.frames.length === 0}
		>
			{isExporting ? '...' : 'Frames'}
		</button>
		
		<button
			class="px-2 py-1.5 text-xs bg-purple-500 text-white rounded hover:bg-purple-600 disabled:bg-gray-400 disabled:cursor-not-allowed"
			onclick={handleExportSpriteSheet}
			disabled={isExporting || project.frames.length === 0}
		>
			{isExporting ? '...' : 'Sheet'}
		</button>
	</div>

	{#if project.frames.length > 0}
		<p class="text-xs text-gray-600">
			{project.frames.length} frames ready
		</p>
	{/if}
</div>

