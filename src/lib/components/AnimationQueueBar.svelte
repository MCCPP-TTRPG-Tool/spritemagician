<script>
	import { animationQueue, removeFromQueue, reorderQueue, clearQueue } from '$lib/stores/animationQueue.js';
	import { projectStore } from '$lib/stores/project.js';
	
	let queue = $state([]);
	let draggedIndex = $state(null);
	let dragOverIndex = $state(null);
	
	animationQueue.subscribe(value => { queue = value; });
	
	function handleDragStart(e, index) {
		draggedIndex = index;
		e.dataTransfer.effectAllowed = 'move';
		e.dataTransfer.setData('text/html', e.target.outerHTML);
		e.target.style.opacity = '0.5';
	}
	
	function handleDragEnd(e) {
		e.target.style.opacity = '1';
		draggedIndex = null;
		dragOverIndex = null;
	}
	
	function handleDragOver(e, index) {
		e.preventDefault();
		e.dataTransfer.dropEffect = 'move';
		if (draggedIndex !== null && draggedIndex !== index) {
			dragOverIndex = index;
		}
	}
	
	function handleDrop(e, dropIndex) {
		e.preventDefault();
		if (draggedIndex !== null && draggedIndex !== dropIndex) {
			reorderQueue(draggedIndex, dropIndex);
		}
		draggedIndex = null;
		dragOverIndex = null;
	}
	
	function handleDragLeave() {
		dragOverIndex = null;
	}
	
	function selectAnimation(anim) {
		if (!anim.frames || anim.frames.length === 0) return;
		
		projectStore.update(p => ({
			...p,
			frames: anim.frames,
			fps: anim.fps || 12,
			currentFrame: 0,
			projectName: anim.name,
			_animationLoaded: true
		}));
	}
	
	function playQueue() {
		if (queue.length === 0) return;
		
		// Combine all frames from all animations in queue order
		const combinedFrames = queue.flatMap(anim => anim.frames || []);
		const firstAnim = queue[0];
		
		projectStore.update(p => ({
			...p,
			frames: combinedFrames,
			fps: firstAnim.fps || 12,
			currentFrame: 0,
			projectName: `Queue: ${queue.map(a => a.name).join(' → ')}`,
			_animationLoaded: true
		}));
	}
	
	function removeFromQueueById(id, e) {
		e.stopPropagation(); // Prevent triggering select when clicking remove
		removeFromQueue(id);
	}
</script>

{#if queue.length > 0}
	<div class="flex items-center gap-2 px-2 py-1.5 bg-gray-800 border-t border-gray-700 flex-shrink-0">
		<span class="text-[10px] text-gray-300 font-medium whitespace-nowrap">Queue ({queue.length}):</span>
		
		<div class="flex-1 flex items-center gap-1.5 overflow-x-auto scrollbar-thin scrollbar-thumb-gray-600 scrollbar-track-gray-800">
			{#each queue as anim, index (anim.id)}
				<div
					class="relative flex-shrink-0 group cursor-pointer
						{draggedIndex === index ? 'opacity-50' : ''}
						{dragOverIndex === index ? 'ring-2 ring-blue-400' : ''}
						{draggedIndex === null ? 'hover:ring-2 hover:ring-blue-500' : 'cursor-move'}"
					draggable="true"
					ondragstart={(e) => handleDragStart(e, index)}
					ondragend={handleDragEnd}
					ondragover={(e) => handleDragOver(e, index)}
					ondrop={(e) => handleDrop(e, index)}
					ondragleave={handleDragLeave}
					onclick={() => { if (draggedIndex === null) selectAnimation(anim); }}
					title={anim.name + ' (Click to preview, drag to reorder)'}
				>
					<!-- First frame thumbnail -->
					<div class="w-12 h-12 bg-gray-700 rounded border border-gray-600 overflow-hidden flex items-center justify-center">
						{#if anim.frames && anim.frames.length > 0}
							<img
								src={anim.frames[0]}
								alt={anim.name}
								class="w-full h-full object-contain"
								style="image-rendering: crisp-edges;"
							/>
						{:else}
							<span class="text-gray-500 text-xs">🎬</span>
						{/if}
					</div>
					
					<!-- Remove button -->
					<button
						class="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white rounded-full text-[8px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600 z-10"
						onclick={(e) => removeFromQueueById(anim.id, e)}
						title="Remove from queue"
					>
						✕
					</button>
					
					<!-- Animation name (truncated) -->
					<p class="text-[9px] text-gray-400 text-center mt-0.5 max-w-[48px] truncate" title={anim.name}>
						{anim.name}
					</p>
				</div>
			{/each}
		</div>
		
		<div class="flex items-center gap-1.5 flex-shrink-0">
			<button
				class="px-2 py-1 text-[10px] bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
				onclick={playQueue}
				title="Play all animations in sequence"
			>
				▶ Play Queue
			</button>
			<button
				class="px-2 py-1 text-[10px] bg-gray-600 text-white rounded hover:bg-gray-500 transition-colors"
				onclick={clearQueue}
				title="Clear queue"
			>
				✕ Clear
			</button>
		</div>
	</div>
{/if}

<style>
	.scrollbar-thin::-webkit-scrollbar {
		height: 4px;
	}
	.scrollbar-thin::-webkit-scrollbar-track {
		background: #1f2937;
	}
	.scrollbar-thin::-webkit-scrollbar-thumb {
		background: #4b5563;
		border-radius: 2px;
	}
	.scrollbar-thin::-webkit-scrollbar-thumb:hover {
		background: #6b7280;
	}
</style>
