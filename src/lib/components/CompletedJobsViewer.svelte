<script>
	import { completedJobs } from '$lib/stores/completedJobs.js';
	import { projectStore } from '$lib/stores/project.js';
	import { animationStore } from '$lib/stores/animations.js';
	import { onDestroy } from 'svelte';
	
	let jobs = $state({ jobs: [], activeIndex: 0, loaded: false });
	let selectedJob = $state(null);
	let showFullPreview = $state(false);
	let animFrame = $state(0);
	let animIntervalId = null;
	
	completedJobs.subscribe(value => { jobs = value; });
	
	// Animation preview
	$effect(() => {
		if (animIntervalId) {
			clearInterval(animIntervalId);
			animIntervalId = null;
		}
		animFrame = 0;
		
		if (selectedJob?.type === 'animation' && selectedJob.frames?.length > 1) {
			const fps = selectedJob.fps || 12;
			const frameCount = selectedJob.frames.length;
			let frame = 0;
			animIntervalId = setInterval(() => {
				frame = (frame + 1) % frameCount;
				animFrame = frame;
			}, 1000 / fps);
		}
	});
	
	onDestroy(() => {
		if (animIntervalId) clearInterval(animIntervalId);
	});
	
	function selectJob(job) {
		selectedJob = selectedJob?.id === job.id ? null : job;
	}
	
	function openFullPreview(job) {
		selectedJob = job;
		showFullPreview = true;
	}
	
	function useJob(job) {
		if (job.type === 'sprite') {
			projectStore.update(p => ({ ...p, firstFrame: job.image }));
		} else if (job.frames?.length > 0) {
			projectStore.update(p => ({ ...p, frames: job.frames }));
		}
		completedJobs.removeJob(job.id);
		selectedJob = null;
		showFullPreview = false;
	}
	
	function saveJob(job) {
		if (job.type === 'sprite') {
			window.dispatchEvent(new CustomEvent('saveSpriteToGallery', {
				detail: { image: job.image, description: job.name }
			}));
		} else if (job.type === 'animation' && job.frames?.length > 0) {
			animationStore.addAnimation({
				name: job.name,
				frames: job.frames,
				fps: job.fps
			});
		}
		completedJobs.removeJob(job.id);
		selectedJob = null;
		showFullPreview = false;
	}
	
	function downloadJob(job) {
		const link = document.createElement('a');
		if (job.type === 'sprite') {
			link.href = job.image;
			link.download = `${job.name}-${Date.now()}.png`;
		} else if (job.videoUrl) {
			link.href = job.videoUrl;
			link.download = `${job.name}-${Date.now()}.mp4`;
		} else if (job.frames?.length > 0) {
			link.href = job.frames[0];
			link.download = `${job.name}-frame1-${Date.now()}.png`;
		}
		link.click();
	}
	
	function deleteJob(job) {
		completedJobs.removeJob(job.id);
		if (selectedJob?.id === job.id) {
			selectedJob = null;
			showFullPreview = false;
		}
	}
</script>

{#if jobs.jobs.length > 0}
	<div class="border border-gray-300 rounded-lg p-3 mb-3 bg-white">
		<div class="flex items-center justify-between mb-3">
			<span class="text-sm font-bold text-gray-800">📦 Saved ({jobs.jobs.length})</span>
			<button class="text-xs text-red-500 hover:text-red-700 hover:underline" onclick={() => completedJobs.clearAll()}>Clear All</button>
		</div>
		
		<!-- Job List -->
		<div class="space-y-2 max-h-80 overflow-y-auto">
			{#each jobs.jobs as job}
				<div 
					class="flex items-center gap-3 p-2 rounded-lg border-2 transition-all cursor-pointer {selectedJob?.id === job.id ? 'border-purple-500 bg-purple-50' : 'border-gray-200 hover:border-purple-300 hover:bg-gray-50'}"
					onclick={() => selectJob(job)}
					role="button"
					tabindex="0"
				>
					<!-- Thumbnail -->
					<div class="w-16 h-16 flex-shrink-0 rounded-lg overflow-hidden bg-gray-100 border border-gray-200">
						{#if job.type === 'sprite' && job.image}
							<img src={job.image} alt={job.name} class="w-full h-full object-contain" />
						{:else if job.type === 'animation' && job.frames?.length > 0}
							<img src={job.frames[0]} alt={job.name} class="w-full h-full object-contain" />
						{:else if job.videoUrl}
							<div class="w-full h-full flex items-center justify-center bg-gradient-to-br from-blue-100 to-purple-100">
								<span class="text-2xl">🎬</span>
							</div>
						{:else}
							<div class="w-full h-full flex items-center justify-center bg-gray-200">
								<span class="text-xl">❓</span>
							</div>
						{/if}
					</div>
					
					<!-- Info -->
					<div class="flex-1 min-w-0">
						<p class="text-sm font-medium truncate">
							{job.type === 'sprite' ? '🖼️' : '🎬'} {job.name}
						</p>
						<p class="text-xs text-gray-500">
							{#if job.type === 'animation'}
								{job.frames?.length || 0} frames {job.videoUrl && !job.frames?.length ? '• Video only' : ''}
							{:else}
								Sprite
							{/if}
						</p>
					</div>
					
					<!-- Quick Actions -->
					<div class="flex gap-1">
						<button 
							class="p-1.5 bg-blue-100 text-blue-700 rounded hover:bg-blue-200 text-xs"
							onclick={(e) => { e.stopPropagation(); openFullPreview(job); }}
							title="Full Preview"
						>🔍</button>
						<button 
							class="p-1.5 bg-green-100 text-green-700 rounded hover:bg-green-200 text-xs"
							onclick={(e) => { e.stopPropagation(); useJob(job); }}
							title="Load"
						>📥</button>
						<button 
							class="p-1.5 bg-red-100 text-red-700 rounded hover:bg-red-200 text-xs"
							onclick={(e) => { e.stopPropagation(); deleteJob(job); }}
							title="Delete"
						>🗑️</button>
					</div>
				</div>
			{/each}
		</div>
		
		<!-- Selected Job Preview -->
		{#if selectedJob && !showFullPreview}
			<div class="mt-3 pt-3 border-t border-gray-200">
				<div class="flex gap-3">
					<!-- Preview -->
					<div class="w-32 h-32 flex-shrink-0 bg-gray-100 rounded-lg overflow-hidden border-2 border-purple-300">
						{#if selectedJob.type === 'sprite'}
							<img src={selectedJob.image} alt={selectedJob.name} class="w-full h-full object-contain" />
						{:else if selectedJob.frames?.length > 0}
							<img src={selectedJob.frames[animFrame]} alt={selectedJob.name} class="w-full h-full object-contain" />
						{:else if selectedJob.videoUrl}
							<video src={selectedJob.videoUrl} class="w-full h-full object-contain" autoplay loop muted playsinline></video>
						{/if}
					</div>
					
					<!-- Actions -->
					<div class="flex-1 flex flex-col justify-center gap-2">
						<button class="w-full px-3 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 text-sm font-medium" onclick={() => openFullPreview(selectedJob)}>
							🔍 Full Preview
						</button>
						<button class="w-full px-3 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 text-sm font-medium" onclick={() => useJob(selectedJob)}>
							{selectedJob.type === 'sprite' ? '🎬 Use for Animation' : '📥 Load Frames'}
						</button>
						<button class="w-full px-3 py-2 bg-purple-500 text-white rounded-lg hover:bg-purple-600 text-sm font-medium" onclick={() => saveJob(selectedJob)}>
							💾 Save to Library
						</button>
						<button class="w-full px-3 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 text-sm" onclick={() => downloadJob(selectedJob)}>
							📥 Download
						</button>
					</div>
				</div>
			</div>
		{/if}
	</div>
{/if}

<!-- Full Preview Modal -->
{#if showFullPreview && selectedJob}
	<div 
		class="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-4"
		onclick={() => showFullPreview = false}
		onkeydown={(e) => { if (e.key === 'Escape') showFullPreview = false; }}
		tabindex="0"
		role="dialog"
	>
		<div class="relative max-w-4xl w-full max-h-[90vh] flex flex-col" onclick={(e) => e.stopPropagation()}>
			<!-- Close button -->
			<button
				onclick={() => showFullPreview = false}
				class="absolute -top-10 right-0 text-white hover:text-gray-300 text-2xl font-bold z-10"
				title="Close (ESC)"
			>✕</button>
			
			<!-- Preview -->
			<div class="flex-1 flex items-center justify-center bg-gray-900 rounded-t-lg overflow-hidden" style="min-height: 400px;">
				{#if selectedJob.type === 'sprite'}
					<img 
						src={selectedJob.image} 
						alt={selectedJob.name}
						class="max-w-full max-h-[70vh] object-contain"
						style="image-rendering: pixelated;"
					/>
				{:else if selectedJob.frames?.length > 0}
					<img 
						src={selectedJob.frames[animFrame]} 
						alt={selectedJob.name}
						class="max-w-full max-h-[70vh] object-contain"
						style="image-rendering: pixelated;"
					/>
				{:else if selectedJob.videoUrl}
					<video 
						src={selectedJob.videoUrl}
						class="max-w-full max-h-[70vh] object-contain"
						autoplay
						loop
						muted
						playsinline
						controls
					></video>
				{/if}
			</div>
			
			<!-- Info bar -->
			<div class="bg-gray-800 px-4 py-2 flex items-center justify-between">
				<div class="text-white">
					<span class="font-medium">{selectedJob.name}</span>
					{#if selectedJob.type === 'animation'}
						<span class="text-gray-400 text-sm ml-2">
							{selectedJob.frames?.length || 0} frames
							{#if selectedJob.frames?.length > 0}
								• Frame {animFrame + 1}/{selectedJob.frames.length}
							{/if}
						</span>
					{/if}
				</div>
			</div>
			
			<!-- Action buttons -->
			<div class="bg-gray-800 rounded-b-lg px-4 py-3 flex justify-center gap-3">
				<button class="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 font-medium" onclick={() => useJob(selectedJob)}>
					{selectedJob.type === 'sprite' ? '🎬 Use for Animation' : '📥 Load Frames'}
				</button>
				<button class="px-4 py-2 bg-purple-500 text-white rounded-lg hover:bg-purple-600 font-medium" onclick={() => saveJob(selectedJob)}>
					💾 Save to Library
				</button>
				<button class="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 font-medium" onclick={() => downloadJob(selectedJob)}>
					📥 Download
				</button>
				<button class="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 font-medium" onclick={() => deleteJob(selectedJob)}>
					🗑️ Delete
				</button>
			</div>
		</div>
	</div>
{/if}
