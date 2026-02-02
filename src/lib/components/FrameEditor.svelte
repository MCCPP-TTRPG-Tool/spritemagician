<script>
	import { projectStore, reorderFrames, removeFrame } from '$lib/stores/project.js';
	
	let project = $state({ frames: [], fps: 12 });
	
	projectStore.subscribe(value => {
		project = value;
	});
	
	let draggedIndex = $state(null);
	let dragOverIndex = $state(null);

	function handleDragStart(index) {
		draggedIndex = index;
	}

	function handleDragOver(event, index) {
		event.preventDefault();
		dragOverIndex = index;
	}

	function handleDrop(event, dropIndex) {
		event.preventDefault();
		if (draggedIndex !== null && draggedIndex !== dropIndex) {
			reorderFrames(draggedIndex, dropIndex);
		}
		draggedIndex = null;
		dragOverIndex = null;
	}

	function handleDragEnd() {
		draggedIndex = null;
		dragOverIndex = null;
	}
</script>

<div class="space-y-2">
	<h3 class="text-sm font-semibold">Frames ({project.frames.length})</h3>
	
	{#if project.frames.length === 0}
		<p class="text-gray-500 text-center py-4 text-xs">No frames yet</p>
	{:else}
		<div class="grid grid-cols-5 gap-2">
			{#each project.frames as frame, index}
				<div
					class="relative border rounded overflow-hidden cursor-move transition-all aspect-square {draggedIndex === index
						? 'opacity-50 scale-95'
						: ''} {dragOverIndex === index ? 'border-blue-500 scale-105' : 'border-gray-300'}"
					draggable="true"
					ondragstart={() => handleDragStart(index)}
					ondragover={(e) => handleDragOver(e, index)}
					ondrop={(e) => handleDrop(e, index)}
					ondragend={handleDragEnd}
					role="listitem"
				>
					<img src={frame} alt="Frame {index + 1}" class="w-full h-full object-contain" />
					<div class="absolute top-1 left-1 bg-black/70 text-white text-[10px] px-1 py-0.5 rounded">
						{index + 1}
					</div>
					<button
						class="absolute top-1 right-1 bg-red-500 text-white rounded-full w-4 h-4 flex items-center justify-center text-[10px] hover:bg-red-600 leading-none"
						onclick={() => removeFrame(index)}
						type="button"
					>
						×
					</button>
				</div>
			{/each}
		</div>
	{/if}
</div>

