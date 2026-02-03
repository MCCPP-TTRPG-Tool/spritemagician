<script>
	import { completedJobs } from '$lib/stores/completedJobs.js';
	import { projectStore } from '$lib/stores/project.js';
	import { animationStore } from '$lib/stores/animations.js';
	import { onDestroy } from 'svelte';
	
	let jobs = $state({ jobs: [], activeIndex: 0, loaded: false });
	let selectedJob = $state(null);
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
	
	function useJob(job) {
		if (job.type === 'sprite') {
			projectStore.update(p => ({ ...p, firstFrame: job.image }));
		} else if (job.frames?.length > 0) {
			projectStore.update(p => ({ ...p, frames: job.frames }));
		}
		completedJobs.removeJob(job.id);
		selectedJob = null;
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
		if (selectedJob?.id === job.id) selectedJob = null;
	}
</script>

{#if jobs.jobs.length > 0}
	<div class="bg-gray-50 border border-gray-200 rounded-lg p-2 mb-3">
		<div class="flex items-center justify-between mb-2">
			<span class="text-xs font-medium text-gray-700">📦 Saved ({jobs.jobs.length})</span>
			<button class="text-[10px] text-red-500 hover:text-red-700" onclick={() => completedJobs.clearAll()}>Clear All</button>
		</div>
		
		<!-- Thumbnail Grid -->
		<div class="grid grid-cols-6 gap-1 mb-2">
			{#each jobs.jobs as job}
				<button
					class="aspect-square rounded border-2 overflow-hidden transition-all {selectedJob?.id === job.id ? 'border-purple-500 ring-2 ring-purple-300' : 'border-gray-200 hover:border-purple-300'}"
					onclick={() => selectJob(job)}
					title={job.name}
				>
					{#if job.type === 'sprite' && job.image}
						<img src={job.image} alt={job.name} class="w-full h-full object-contain bg-white" />
					{:else if job.type === 'animation' && job.frames?.length > 0}
						<img src={job.frames[0]} alt={job.name} class="w-full h-full object-contain bg-white" />
					{:else if job.videoUrl}
						<div class="w-full h-full bg-gray-200 flex items-center justify-center text-lg">🎬</div>
					{:else}
						<div class="w-full h-full bg-gray-200 flex items-center justify-center text-lg">❓</div>
					{/if}
				</button>
			{/each}
		</div>
		
		<!-- Selected Job Detail -->
		{#if selectedJob}
			<div class="bg-white rounded border border-purple-200 p-2">
				<div class="flex gap-2">
					<!-- Preview -->
					<div class="w-24 h-24 flex-shrink-0 bg-gray-100 rounded overflow-hidden">
						{#if selectedJob.type === 'sprite'}
							<img src={selectedJob.image} alt={selectedJob.name} class="w-full h-full object-contain" />
						{:else if selectedJob.frames?.length > 0}
							<img src={selectedJob.frames[animFrame]} alt={selectedJob.name} class="w-full h-full object-contain" />
						{:else if selectedJob.videoUrl}
							<video src={selectedJob.videoUrl} class="w-full h-full object-contain" autoplay loop muted playsinline></video>
						{/if}
					</div>
					
					<!-- Info & Actions -->
					<div class="flex-1 min-w-0">
						<p class="text-xs font-medium truncate">{selectedJob.type === 'sprite' ? '🖼️' : '🎬'} {selectedJob.name}</p>
						{#if selectedJob.type === 'animation'}
							<p class="text-[10px] text-gray-500">{selectedJob.frames?.length || 0} frames</p>
						{/if}
						
						<div class="flex flex-wrap gap-1 mt-2">
							<button class="px-2 py-1 text-[10px] bg-blue-500 text-white rounded hover:bg-blue-600" onclick={() => useJob(selectedJob)}>
								{selectedJob.type === 'sprite' ? '🎬 Animate' : '📥 Load'}
							</button>
							<button class="px-2 py-1 text-[10px] bg-green-500 text-white rounded hover:bg-green-600" onclick={() => saveJob(selectedJob)}>
								💾 Save
							</button>
							<button class="px-2 py-1 text-[10px] bg-purple-500 text-white rounded hover:bg-purple-600" onclick={() => downloadJob(selectedJob)}>
								📥
							</button>
							<button class="px-2 py-1 text-[10px] bg-red-100 text-red-700 rounded hover:bg-red-200" onclick={() => deleteJob(selectedJob)}>
								🗑️
							</button>
						</div>
					</div>
				</div>
			</div>
		{/if}
	</div>
{/if}
