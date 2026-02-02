<script>
	import { projectStore, reorderFrames, removeFrame } from '$lib/stores/project.js';
	import { animationStore } from '$lib/stores/animations.js';
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	
	let project = $state({ frames: [], fps: 12 });
	let animations = $state({ animations: [] });
	let showAnimationLibrary = $state(true);
	
	projectStore.subscribe(value => {
		project = value;
	});
	
	animationStore.subscribe(value => {
		animations = value;
	});
	
	// Save current animation to library
	function saveCurrentAnimation() {
		if (project.frames.length === 0) {
			alert('No frames to save. Generate an animation first.');
			return;
		}
		
		const name = prompt('Name this animation:', `Animation ${animations.animations.length + 1}`);
		if (name) {
			animationStore.addAnimation({
				name: name,
				frames: [...project.frames],
				fps: project.fps,
				prompt: project.prompt || '',
				animationType: project.animationType || 'custom',
				frameCount: project.frames.length
			});
		}
	}
	
	// Load animation from library
	function loadAnimation(animation) {
		projectStore.update(p => ({
			...p,
			frames: [...animation.frames],
			fps: animation.fps,
			prompt: animation.prompt
		}));
	}
	
	// Delete animation from library
	function deleteAnimation(id, name) {
		if (confirm(`Delete animation "${name}"? This cannot be undone.`)) {
			animationStore.removeAnimation(id);
		}
	}
	
	let draggedIndex = $state(null);
	let dragOverIndex = $state(null);
	let previewPose = $state(null);
	
	function handlePoseSelected(event) {
		previewPose = event.detail;
	}
	
	onMount(() => {
		if (browser) {
			window.addEventListener('poseSelected', handlePoseSelected);
			return () => {
				window.removeEventListener('poseSelected', handlePoseSelected);
			};
		}
	});

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

<div class="space-y-4 h-full flex flex-col">
	<!-- Current Frames Section -->
	<div class="flex-shrink-0">
		<div class="flex items-center justify-between mb-2">
			<h3 class="text-sm font-semibold">Frames ({project.frames.length})</h3>
			{#if project.frames.length > 0}
				<button
					class="px-2 py-1 text-xs bg-green-500 text-white rounded hover:bg-green-600 flex items-center gap-1"
					onclick={saveCurrentAnimation}
				>
					💾 Save to Library
				</button>
			{/if}
		</div>
		
		<!-- Pose Preview -->
		{#if previewPose}
			<div class="mb-4 p-3 bg-purple-50 border-2 border-purple-300 rounded-lg">
				<div class="flex items-center justify-between mb-2">
					<p class="text-sm font-medium text-purple-800">Pose Preview: {previewPose.name}</p>
					<button
						class="text-xs text-purple-600 hover:text-purple-800"
						onclick={() => previewPose = null}
					>
						✕ Close
					</button>
				</div>
				<img 
					src={previewPose.imageData} 
					alt={previewPose.name} 
					class="w-full max-h-64 object-contain bg-white rounded border border-purple-200"
				/>
				{#if previewPose.prompt}
					<p class="text-xs text-gray-600 mt-2 italic">"{previewPose.prompt}"</p>
				{/if}
			</div>
		{/if}
		
		{#if project.frames.length === 0 && !previewPose}
			<p class="text-gray-500 text-center py-4 text-xs">No frames yet</p>
		{:else if project.frames.length > 0}
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
	
	<!-- Animation Library Section -->
	<div class="flex-1 border-t pt-4 overflow-y-auto">
		<div class="flex items-center justify-between mb-2">
			<h3 class="text-sm font-semibold">🎬 Animation Library ({animations.animations.length})</h3>
			<button
				class="text-xs text-gray-500 hover:text-gray-700"
				onclick={() => showAnimationLibrary = !showAnimationLibrary}
			>
				{showAnimationLibrary ? '▼' : '▶'}
			</button>
		</div>
		
		{#if showAnimationLibrary}
			{#if animations.animations.length > 0}
				<p class="text-xs text-gray-500 mb-2">Click to load</p>
				<div class="grid grid-cols-4 gap-2">
					{#each animations.animations as anim}
						<div 
							class="relative group border-2 border-gray-200 rounded-lg overflow-hidden hover:border-blue-400 transition-all cursor-pointer bg-gray-50"
							onclick={() => loadAnimation(anim)}
							onkeydown={(e) => { if (e.key === 'Enter') loadAnimation(anim); }}
							tabindex="0"
							role="button"
							title="Click to load"
						>
							<!-- Thumbnail -->
							<div class="aspect-square bg-gray-100 relative">
								{#if anim.frames && anim.frames.length > 0}
									<img 
										src={anim.frames[0]} 
										alt={anim.name}
										class="w-full h-full object-contain"
									/>
								{:else}
									<div class="w-full h-full flex items-center justify-center text-gray-400 text-xl">🎬</div>
								{/if}
								
								<!-- Frame count -->
								<span class="absolute bottom-1 right-1 bg-black/70 text-white text-[9px] px-1 rounded">
									{anim.frames?.length || 0}f
								</span>
								
								<!-- Delete -->
								<button
									class="absolute -top-1 -right-1 bg-red-500 text-white text-xs w-4 h-4 rounded-full opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center shadow z-10"
									onclick={(e) => {
										e.stopPropagation();
										deleteAnimation(anim.id, anim.name);
									}}
									title="Delete"
								>×</button>
							</div>
							
							<!-- Name -->
							<p class="text-[10px] text-center truncate px-1 py-1">{anim.name}</p>
						</div>
					{/each}
				</div>
			{:else}
				<p class="text-gray-400 text-center py-3 text-xs">
					No saved animations yet
				</p>
			{/if}
		{/if}
	</div>
</div>

