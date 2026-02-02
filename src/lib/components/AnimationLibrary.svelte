<script>
	import { animationStore } from '$lib/stores/animations.js';
	import { projectStore } from '$lib/stores/project.js';
	
	let animations = $state({ animations: [] });
	let selectedAnimation = $state(null);
	let showPreviewModal = $state(false);
	let previewFrame = $state(0);
	let previewInterval = $state(null);
	
	animationStore.subscribe(value => {
		animations = value;
	});
	
	let project = $state({ frames: [], fps: 12 });
	projectStore.subscribe(value => {
		project = value;
	});
	
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
	
	function loadAnimation(animation) {
		projectStore.update(p => ({
			...p,
			frames: [...animation.frames],
			fps: animation.fps,
			prompt: animation.prompt
		}));
	}
	
	function deleteAnimation(id, name) {
		if (confirm(`Delete animation "${name}"? This cannot be undone.`)) {
			animationStore.removeAnimation(id);
			if (selectedAnimation?.id === id) {
				selectedAnimation = null;
				stopPreview();
			}
		}
	}
	
	function previewAnimation(animation, event) {
		event.stopPropagation();
		selectedAnimation = animation;
		previewFrame = 0;
		showPreviewModal = true;
		startPreview();
	}
	
	function startPreview() {
		stopPreview();
		if (selectedAnimation && selectedAnimation.frames.length > 0) {
			const fps = selectedAnimation.fps || 12;
			previewInterval = setInterval(() => {
				previewFrame = (previewFrame + 1) % selectedAnimation.frames.length;
			}, 1000 / fps);
		}
	}
	
	function stopPreview() {
		if (previewInterval) {
			clearInterval(previewInterval);
			previewInterval = null;
		}
	}
	
	function closePreview() {
		stopPreview();
		showPreviewModal = false;
		selectedAnimation = null;
	}
</script>

<div class="h-full flex flex-col">
	<div class="flex items-center justify-between mb-3">
		<h3 class="text-sm font-semibold">Animation Library</h3>
		{#if project.frames.length > 0}
			<button
				class="px-3 py-1.5 text-xs bg-green-500 text-white rounded hover:bg-green-600 flex items-center gap-1"
				onclick={saveCurrentAnimation}
			>
				💾 Save Current
			</button>
		{/if}
	</div>
	
	<!-- Saved Animations Grid -->
	{#if animations.animations.length > 0}
		<div class="flex-1 overflow-y-auto">
			<p class="text-xs text-gray-500 mb-2">Saved Animations ({animations.animations.length}) - Click to load</p>
			<div class="grid grid-cols-3 gap-3">
				{#each animations.animations as anim}
					<div class="relative group border-2 border-gray-200 rounded-lg overflow-hidden hover:border-blue-400 transition-all cursor-pointer bg-gray-50"
						onclick={() => loadAnimation(anim)}
						onkeydown={(e) => { if (e.key === 'Enter') loadAnimation(anim); }}
						tabindex="0"
						role="button"
						title="Click to load animation"
					>
						<!-- Thumbnail (first frame) -->
						<div class="aspect-square bg-gray-100 relative">
							{#if anim.frames && anim.frames.length > 0}
								<img 
									src={anim.frames[0]} 
									alt={anim.name}
									class="w-full h-full object-contain"
								/>
							{:else}
								<div class="w-full h-full flex items-center justify-center text-gray-400">
									<span class="text-2xl">🎬</span>
								</div>
							{/if}
							
							<!-- Frame count badge -->
							<span class="absolute bottom-1 right-1 bg-black/70 text-white text-[10px] px-1.5 py-0.5 rounded">
								{anim.frameCount || anim.frames?.length || 0}f
							</span>
							
							<!-- Preview button (magnifying glass) -->
							<button
								class="absolute top-1 left-1 bg-white/90 text-gray-700 w-6 h-6 rounded-full opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center shadow hover:bg-white hover:scale-110 text-xs"
								onclick={(e) => previewAnimation(anim, e)}
								title="Preview animation"
							>▶</button>
							
							<!-- Delete button -->
							<button
								class="absolute -top-1 -right-1 bg-red-500 text-white text-xs w-5 h-5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center shadow z-10"
								onclick={(e) => {
									e.stopPropagation();
									deleteAnimation(anim.id, anim.name);
								}}
								title="Delete animation"
							>×</button>
						</div>
						
						<!-- Info -->
						<div class="p-2">
							<p class="text-xs font-medium truncate">{anim.name}</p>
							<p class="text-[10px] text-gray-500">{anim.fps || 12} FPS</p>
						</div>
					</div>
				{/each}
			</div>
		</div>
	{:else}
		<div class="flex-1 flex items-center justify-center text-gray-400">
			<div class="text-center">
				<p class="text-4xl mb-2">🎬</p>
				<p class="text-sm">No animations saved yet</p>
				<p class="text-xs mt-1">Generate an animation and click "Save Current"</p>
			</div>
		</div>
	{/if}
</div>

<!-- Preview Modal -->
{#if showPreviewModal && selectedAnimation}
	<div 
		class="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
		onclick={closePreview}
		onkeydown={(e) => { if (e.key === 'Escape') closePreview(); }}
		tabindex="0"
		role="dialog"
	>
		<div class="relative bg-gray-900 rounded-lg p-4 max-w-lg" onclick={(e) => e.stopPropagation()}>
			<button
				onclick={closePreview}
				class="absolute -top-10 right-0 text-white hover:text-gray-300 text-2xl"
				title="Close"
			>✕</button>
			
			<div class="aspect-square bg-gray-800 rounded overflow-hidden mb-3 max-w-md">
				{#if selectedAnimation.frames && selectedAnimation.frames.length > 0}
					<img 
						src={selectedAnimation.frames[previewFrame]} 
						alt={`Frame ${previewFrame + 1}`}
						class="w-full h-full object-contain"
					/>
				{/if}
			</div>
			
			<div class="text-center">
				<p class="text-white text-sm font-medium">{selectedAnimation.name}</p>
				<p class="text-gray-400 text-xs mt-1">
					Frame {previewFrame + 1} / {selectedAnimation.frames?.length || 0} • {selectedAnimation.fps || 12} FPS
				</p>
				{#if selectedAnimation.prompt}
					<p class="text-gray-500 text-xs mt-2 italic">"{selectedAnimation.prompt}"</p>
				{/if}
			</div>
			
			<button
				class="mt-4 w-full px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 text-sm"
				onclick={() => { loadAnimation(selectedAnimation); closePreview(); }}
			>
				Load This Animation
			</button>
		</div>
	</div>
{/if}
