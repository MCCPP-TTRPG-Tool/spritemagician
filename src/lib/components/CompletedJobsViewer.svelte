<script>
	import { completedJobs } from '$lib/stores/completedJobs.js';
	import { projectStore } from '$lib/stores/project.js';
	import { assetStore } from '$lib/stores/assets.js';
	import { animationStore } from '$lib/stores/animations.js';
	import { onDestroy } from 'svelte';
	
	let jobs = $state({ jobs: [], activeIndex: 0 });
	let animFrame = $state(0);
	let animIntervalId = null;
	let lastJobId = null;
	
	completedJobs.subscribe(value => { jobs = value; });
	
	const activeJob = $derived(jobs.jobs.length > 0 ? jobs.jobs[jobs.activeIndex] : null);
	
	// Watch for job changes and update animation
	$effect(() => {
		const job = activeJob;
		const jobId = job?.id || null;
		
		// Only restart animation if the job changed
		if (jobId !== lastJobId) {
			lastJobId = jobId;
			
			// Clear any existing interval
			if (animIntervalId) {
				clearInterval(animIntervalId);
				animIntervalId = null;
			}
			animFrame = 0;
			
			// Start new animation if needed
			if (job?.type === 'animation' && job.frames?.length > 1) {
				const fps = job.fps || 12;
				const frameCount = job.frames.length;
				let frame = 0;
				animIntervalId = setInterval(() => {
					frame = (frame + 1) % frameCount;
					animFrame = frame;
				}, 1000 / fps);
			}
		}
	});
	
	onDestroy(() => {
		if (animIntervalId) clearInterval(animIntervalId);
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

{#if jobs.jobs.length > 0 || !jobs.loaded}
	<div class="bg-gradient-to-b from-purple-50 to-blue-50 border-2 border-purple-300 rounded-lg p-3 mb-3">
		<!-- Header -->
		<div class="flex items-center justify-between mb-2">
			<div class="flex items-center gap-2">
				<span class="text-lg">📦</span>
				<span class="font-bold text-purple-800">Completed Jobs</span>
				<span class="px-2 py-0.5 bg-purple-200 text-purple-800 text-xs rounded-full font-medium">
					{jobs.jobs.length} saved
				</span>
				<span class="text-[10px] text-purple-500">💾 Auto-saved to browser</span>
			</div>
			{#if jobs.jobs.length > 0}
				<button
					class="text-xs text-red-500 hover:text-red-700"
					onclick={() => completedJobs.clearAll()}
				>Clear All</button>
			{/if}
		</div>
		
		{#if !jobs.loaded}
			<div class="text-center py-4 text-purple-600">
				<span class="animate-pulse">Loading saved jobs...</span>
			</div>
		{:else if jobs.jobs.length === 0}
			<div class="text-center py-2 text-gray-500 text-xs">
				No completed jobs yet. Generate something!
			</div>
		{/if}
		
		{#if jobs.jobs.length > 0}
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
					{:else if activeJob.type === 'animation' && activeJob.videoUrl}
						<!-- Video preview when frames failed to extract -->
						<video 
							src={activeJob.videoUrl}
							class="w-full h-full object-contain"
							autoplay
							loop
							muted
							playsinline
						></video>
						<div class="absolute bottom-2 left-2 px-2 py-1 bg-red-600 text-white text-xs rounded">
							⚠️ Frame extraction failed - showing video
						</div>
					{:else if activeJob.type === 'animation'}
						<div class="w-full h-full flex items-center justify-center text-gray-400">
							<div class="text-center">
								<p class="text-2xl">⚠️</p>
								<p class="text-xs">No frames available</p>
								{#if activeJob.error}
									<p class="text-[10px] text-red-500 mt-1">{activeJob.error}</p>
								{/if}
							</div>
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
				{:else if activeJob.frames?.length > 0}
					<button
						class="px-3 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 text-sm font-medium"
						onclick={useAsReference}
					>📥 Load Frames</button>
					<button
						class="px-3 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 text-sm font-medium"
						onclick={saveAnimation}
					>💾 Save Animation</button>
				{:else if activeJob.videoUrl}
					<!-- Video-only actions -->
					<a
						href={activeJob.videoUrl}
						target="_blank"
						class="px-3 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 text-sm font-medium text-center"
					>🎬 Open Video</a>
					<a
						href={activeJob.videoUrl}
						download="animation.mp4"
						class="px-3 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 text-sm font-medium text-center"
					>📥 Download Video</a>
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
		{/if}
	</div>
{/if}
