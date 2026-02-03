<script>
	import { completedJobs } from '$lib/stores/completedJobs.js';
	import { projectStore } from '$lib/stores/project.js';
	import { assetStore } from '$lib/stores/assets.js';
	import { animationStore } from '$lib/stores/animations.js';
	
	let jobs = $state({ jobs: [], activeIndex: 0 });
	let animFrame = $state(0);
	let animInterval = $state(null);
	
	completedJobs.subscribe(value => { jobs = value; });
	
	const activeJob = $derived(jobs.jobs.length > 0 ? jobs.jobs[jobs.activeIndex] : null);
	
	// Animate the preview for animations
	$effect(() => {
		if (animInterval) {
			clearInterval(animInterval);
			animInterval = null;
		}
		
		if (activeJob?.type === 'animation' && activeJob.frames?.length > 1) {
			const fps = activeJob.fps || 12;
			animInterval = setInterval(() => {
				animFrame = (animFrame + 1) % activeJob.frames.length;
			}, 1000 / fps);
		}
		
		return () => {
			if (animInterval) clearInterval(animInterval);
		};
	});
	
	function useAsReference() {
		if (!activeJob) return;
		
		if (activeJob.type === 'sprite') {
			projectStore.update(p => ({ ...p, firstFrame: activeJob.image }));
		} else if (activeJob.type === 'animation' && activeJob.frames?.length > 0) {
			projectStore.update(p => ({ ...p, frames: activeJob.frames }));
		}
		
		completedJobs.removeJob(activeJob.id);
	}
	
	function saveToAssets() {
		if (!activeJob) return;
		
		if (activeJob.type === 'sprite') {
			// Dispatch event to open save modal
			window.dispatchEvent(new CustomEvent('saveSpriteToGallery', {
				detail: {
					image: activeJob.image,
					description: activeJob.description || activeJob.name
				}
			}));
		}
		
		completedJobs.removeJob(activeJob.id);
	}
	
	function saveAnimation() {
		if (!activeJob || activeJob.type !== 'animation') return;
		
		animationStore.addAnimation({
			name: activeJob.name,
			frames: activeJob.frames,
			fps: activeJob.fps
		});
		
		completedJobs.removeJob(activeJob.id);
	}
	
	function discard() {
		if (!activeJob) return;
		completedJobs.removeJob(activeJob.id);
	}
	
	function download() {
		if (!activeJob) return;
		
		const link = document.createElement('a');
		if (activeJob.type === 'sprite') {
			link.href = activeJob.image;
			link.download = `${activeJob.name || 'sprite'}-${Date.now()}.png`;
		} else if (activeJob.type === 'animation' && activeJob.frames?.length > 0) {
			link.href = activeJob.frames[0];
			link.download = `${activeJob.name || 'animation'}-frame1-${Date.now()}.png`;
		}
		link.click();
	}
</script>

{#if jobs.jobs.length > 0}
	<div class="bg-gradient-to-b from-purple-50 to-blue-50 border-2 border-purple-300 rounded-lg p-3 mb-3">
		<!-- Header -->
		<div class="flex items-center justify-between mb-2">
			<div class="flex items-center gap-2">
				<span class="text-lg">📦</span>
				<span class="font-bold text-purple-800">Completed Jobs</span>
				<span class="px-2 py-0.5 bg-purple-200 text-purple-800 text-xs rounded-full font-medium">
					{jobs.jobs.length}
				</span>
			</div>
			<button
				class="text-xs text-red-500 hover:text-red-700"
				onclick={() => completedJobs.clearAll()}
			>Clear All</button>
		</div>
		
		<!-- Navigation -->
		<div class="flex items-center gap-2 mb-3">
			<button
				class="px-3 py-1.5 bg-purple-200 rounded-lg hover:bg-purple-300 font-bold text-purple-800 disabled:opacity-40"
				onclick={() => completedJobs.prev()}
				disabled={jobs.jobs.length <= 1}
			>◀</button>
			
			<div class="flex-1 flex gap-1 overflow-x-auto py-1">
				{#each jobs.jobs as job, i}
					<button
						class="flex-shrink-0 px-2 py-1 text-[10px] rounded border-2 transition-all {i === jobs.activeIndex 
							? 'bg-purple-500 border-purple-600 text-white font-bold' 
							: 'bg-white border-purple-200 text-purple-700 hover:border-purple-400'}"
						onclick={() => completedJobs.setActiveIndex(i)}
					>
						{job.type === 'sprite' ? '🖼️' : '🎬'} {job.name}
					</button>
				{/each}
			</div>
			
			<button
				class="px-3 py-1.5 bg-purple-200 rounded-lg hover:bg-purple-300 font-bold text-purple-800 disabled:opacity-40"
				onclick={() => completedJobs.next()}
				disabled={jobs.jobs.length <= 1}
			>▶</button>
		</div>
		
		<!-- Preview -->
		{#if activeJob}
			<div class="bg-white rounded-lg border-2 border-purple-200 p-2 mb-3">
				<div class="flex items-center gap-2 mb-2">
					<span class="text-sm">{activeJob.type === 'sprite' ? '🖼️ Sprite' : '🎬 Animation'}</span>
					<span class="font-medium text-sm">{activeJob.name}</span>
					{#if activeJob.type === 'animation'}
						<span class="text-xs text-gray-500">({activeJob.frames?.length || 0} frames)</span>
					{/if}
				</div>
				
				<div class="relative bg-gray-100 rounded-lg overflow-hidden" style="aspect-ratio: 1;">
					{#if activeJob.type === 'sprite'}
						<img 
							src={activeJob.image} 
							alt={activeJob.name}
							class="w-full h-full object-contain"
						/>
					{:else if activeJob.type === 'animation' && activeJob.frames?.length > 0}
						<img 
							src={activeJob.frames[animFrame]} 
							alt={activeJob.name}
							class="w-full h-full object-contain"
						/>
						<div class="absolute bottom-2 left-2 px-2 py-1 bg-black/60 text-white text-xs rounded">
							Frame {animFrame + 1}/{activeJob.frames.length}
						</div>
					{/if}
				</div>
			</div>
			
			<!-- Actions -->
			<div class="grid grid-cols-2 gap-2">
				{#if activeJob.type === 'sprite'}
					<button
						class="px-3 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 text-sm font-medium"
						onclick={useAsReference}
					>🎬 Use for Animation</button>
					<button
						class="px-3 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 text-sm font-medium"
						onclick={saveToAssets}
					>💾 Save to Assets</button>
				{:else}
					<button
						class="px-3 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 text-sm font-medium"
						onclick={useAsReference}
					>📥 Load Frames</button>
					<button
						class="px-3 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 text-sm font-medium"
						onclick={saveAnimation}
					>💾 Save Animation</button>
				{/if}
			</div>
			
			<div class="flex gap-2 mt-2">
				<button
					class="flex-1 px-3 py-1.5 bg-purple-100 text-purple-700 rounded hover:bg-purple-200 text-xs"
					onclick={download}
				>📥 Download</button>
				<button
					class="flex-1 px-3 py-1.5 bg-red-100 text-red-700 rounded hover:bg-red-200 text-xs"
					onclick={discard}
				>🗑️ Discard</button>
			</div>
		{/if}
	</div>
{/if}
