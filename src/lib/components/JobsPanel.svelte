<script>
	import { jobQueue } from '$lib/stores/jobQueue.js';
	import { completedJobs } from '$lib/stores/completedJobs.js';
	import { projectStore } from '$lib/stores/project.js';
	import { animationStore } from '$lib/stores/animations.js';
	import { onDestroy } from 'svelte';

	// ── local copies ────────────────────────────────────────
	let queue     = $state([]);
	let completed = $state({ jobs: [], activeIndex: 0, loaded: false });
	let animFrame = $state(0);
	let animInterval = null;
	let lastPreviewId = null;

	jobQueue.subscribe(v => { queue = v; });
	completedJobs.subscribe(v => { completed = v; });

	// ── derived ─────────────────────────────────────────────
	const activeJobs  = $derived(queue.filter(j => j.status === 'pending' || j.status === 'processing'));
	const doneJobs    = $derived(queue.filter(j => j.status === 'completed' || j.status === 'failed'));
	const activeCompleted = $derived(completed.jobs.length > 0 ? completed.jobs[completed.activeIndex] : null);

	// ── animation preview for completed animations ──────────
	$effect(() => {
		const job = activeCompleted;
		const jobId = job?.id || null;
		if (jobId !== lastPreviewId) {
			lastPreviewId = jobId;
			if (animInterval) { clearInterval(animInterval); animInterval = null; }
			animFrame = 0;
			if (job?.type === 'animation' && job.frames?.length > 1) {
				const fps = job.fps || 12;
				let f = 0;
				animInterval = setInterval(() => { f = (f + 1) % job.frames.length; animFrame = f; }, 1000 / fps);
			}
		}
	});
	onDestroy(() => { if (animInterval) clearInterval(animInterval); });

	// ── helpers ──────────────────────────────────────────────
	function statusIcon(s) {
		switch (s) {
			case 'pending':    return '⏳';
			case 'processing': return '⚡';
			case 'completed':  return '✅';
			case 'failed':     return '❌';
			case 'cancelled':  return '🚫';
			default:           return '❓';
		}
	}
	function statusColor(s) {
		switch (s) {
			case 'pending':    return 'text-yellow-700 bg-yellow-50';
			case 'processing': return 'text-blue-700 bg-blue-50';
			case 'completed':  return 'text-green-700 bg-green-50';
			case 'failed':     return 'text-red-700 bg-red-50';
			default:           return 'text-gray-600 bg-gray-50';
		}
	}
	function elapsed(job) {
		if (!job.createdAt) return '';
		const start = new Date(job.createdAt);
		const end = job.completedAt ? new Date(job.completedAt) : new Date();
		const s = Math.floor((end - start) / 1000);
		return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
	}

	// ── completed-job actions ───────────────────────────────
	function useAsReference() {
		const j = activeCompleted;
		if (!j) return;
		if (j.type === 'sprite') projectStore.update(p => ({ ...p, firstFrame: j.image }));
		else if (j.type === 'animation' && j.frames?.length) projectStore.update(p => ({ ...p, frames: j.frames }));
		completedJobs.removeJob(j.id);
	}
	function saveAnimation() {
		const j = activeCompleted;
		if (!j || j.type !== 'animation') return;
		animationStore.addAnimation({ name: j.name, frames: j.frames, fps: j.fps });
		completedJobs.removeJob(j.id);
	}
	function discard() {
		if (activeCompleted) completedJobs.removeJob(activeCompleted.id);
	}
	function download() {
		const j = activeCompleted;
		if (!j) return;
		const a = document.createElement('a');
		if (j.type === 'sprite') { a.href = j.image; a.download = `${j.name || 'sprite'}.png`; }
		else if (j.videoUrl) { a.href = j.videoUrl; a.download = `${j.name || 'anim'}.mp4`; }
		else if (j.frames?.length) { a.href = j.frames[0]; a.download = `${j.name || 'frame'}.png`; }
		a.click();
	}
</script>

<div class="flex flex-col h-full text-xs">
	<!-- ════════════════════════════════════════════════════════
	     QUEUED & ACTIVE JOBS
	     ════════════════════════════════════════════════════════ -->
	<div class="flex-shrink-0">
		<div class="flex items-center justify-between px-2 py-1.5 bg-gray-100 border-b rounded-t">
			<div class="flex items-center gap-2 font-medium text-gray-700">
				<span>⚡</span>
				<span>Active Jobs</span>
				{#if activeJobs.length > 0}
					<span class="px-1.5 py-0.5 bg-blue-500 text-white text-[10px] rounded-full animate-pulse">{activeJobs.length}</span>
				{/if}
			</div>
			{#if doneJobs.length > 0}
				<button class="text-[10px] text-gray-500 hover:text-red-500" onclick={() => jobQueue.clearFinished()}>Clear done</button>
			{/if}
		</div>

		{#if queue.length === 0}
			<div class="px-3 py-4 text-center text-gray-400 text-[11px]">No jobs in queue</div>
		{:else}
			<div class="max-h-48 overflow-y-auto">
				{#each queue as job (job.id)}
					<div class="flex items-center gap-2 px-3 py-1.5 border-b border-gray-100 {statusColor(job.status)}">
						<span class="text-sm">{statusIcon(job.status)}</span>
						<div class="flex-1 min-w-0">
							<div class="flex items-center gap-2">
								<span class="font-medium truncate">{job.type || 'Job'}</span>
								<span class="text-[10px] text-gray-400 truncate">{job.name || ''}</span>
							</div>
							{#if job.status === 'processing' && job.progress > 0}
								<div class="w-full bg-gray-200 rounded-full h-1 mt-1">
									<div class="bg-blue-500 h-1 rounded-full transition-all" style="width:{job.progress}%"></div>
								</div>
							{/if}
							{#if job.message}<p class="text-[10px] text-gray-500 truncate">{job.message}</p>{/if}
							{#if job.error}<p class="text-[10px] text-red-500 truncate">{job.error}</p>{/if}
						</div>
						<span class="text-[10px] text-gray-400 whitespace-nowrap">{elapsed(job)}</span>
						<button class="p-1 text-gray-400 hover:text-red-500"
							onclick={() => job.status === 'pending' || job.status === 'processing' ? jobQueue.cancelJob(job.id) : jobQueue.removeJob(job.id)}>✕</button>
					</div>
				{/each}
			</div>
		{/if}
	</div>

	<!-- ════════════════════════════════════════════════════════
	     COMPLETED GENERATIONS
	     ════════════════════════════════════════════════════════ -->
	<div class="flex-1 overflow-y-auto border-t">
		<div class="flex items-center justify-between px-2 py-1.5 bg-purple-50 border-b">
			<div class="flex items-center gap-2 font-medium text-purple-800">
				<span>📦</span>
				<span>Completed</span>
				<span class="px-1.5 py-0.5 bg-purple-200 text-purple-800 text-[10px] rounded-full">{completed.jobs.length}</span>
			</div>
			{#if completed.jobs.length > 0}
				<button class="text-[10px] text-red-500 hover:text-red-700" onclick={() => completedJobs.clearAll()}>Clear All</button>
			{/if}
		</div>

		{#if !completed.loaded}
			<div class="text-center py-4 text-purple-500 animate-pulse text-[11px]">Loading saved jobs…</div>
		{:else if completed.jobs.length === 0}
			<div class="px-3 py-8 text-center text-gray-400 text-[11px]">No completed jobs yet. Generate something!</div>
		{:else}
			<!-- Tabs for switching between completed jobs -->
			<div class="flex gap-1 px-2 py-1.5 overflow-x-auto border-b">
				{#each completed.jobs as cj, i (cj.id)}
					<button
						class="flex-shrink-0 px-2 py-1 text-[10px] rounded border-2 transition-all
							{i === completed.activeIndex
								? 'bg-purple-500 border-purple-600 text-white font-bold'
								: 'bg-white border-purple-200 text-purple-700 hover:border-purple-400'}"
						onclick={() => completedJobs.setActiveIndex(i)}
					>{cj.type === 'sprite' ? '🖼️' : '🎬'} {cj.name}</button>
				{/each}
			</div>

			<!-- Preview -->
			{#if activeCompleted}
				<div class="p-2">
					<div class="bg-white rounded-lg border-2 border-purple-200 p-2 mb-2">
						<div class="flex items-center gap-2 mb-2 text-[11px]">
							<span>{activeCompleted.type === 'sprite' ? '🖼️ Sprite' : '🎬 Animation'}</span>
							<span class="font-medium">{activeCompleted.name}</span>
							{#if activeCompleted.type === 'animation'}
								<span class="text-gray-500">({activeCompleted.frames?.length || 0} frames)</span>
							{/if}
						</div>

						<div class="relative bg-gray-100 rounded-lg overflow-hidden" style="aspect-ratio:1;">
							{#if activeCompleted.type === 'sprite'}
								<img src={activeCompleted.image} alt={activeCompleted.name} class="w-full h-full object-contain" />
							{:else if activeCompleted.type === 'animation' && activeCompleted.frames?.length > 0}
								<img src={activeCompleted.frames[animFrame]} alt={activeCompleted.name} class="w-full h-full object-contain" />
								<div class="absolute bottom-2 left-2 px-2 py-1 bg-black/60 text-white text-[10px] rounded">
									Frame {animFrame + 1}/{activeCompleted.frames.length}
								</div>
							{:else if activeCompleted.videoUrl}
								<video src={activeCompleted.videoUrl} class="w-full h-full object-contain" autoplay loop muted playsinline controls></video>
							{:else}
								<div class="w-full h-full flex items-center justify-center text-gray-400 text-2xl">⚠️</div>
							{/if}
						</div>
					</div>

					<!-- Actions -->
					<div class="grid grid-cols-2 gap-1.5">
						{#if activeCompleted.type === 'sprite'}
							<button class="px-2 py-1.5 bg-blue-500 text-white rounded hover:bg-blue-600 text-[11px] font-medium" onclick={useAsReference}>🎬 Use for Anim</button>
							<button class="px-2 py-1.5 bg-green-500 text-white rounded hover:bg-green-600 text-[11px] font-medium" onclick={() => {
								window.dispatchEvent(new CustomEvent('saveSpriteToGallery', { detail: { image: activeCompleted.image, description: activeCompleted.name } }));
								completedJobs.removeJob(activeCompleted.id);
							}}>💾 Save to Files</button>
						{:else if activeCompleted.frames?.length > 0}
							<button class="px-2 py-1.5 bg-blue-500 text-white rounded hover:bg-blue-600 text-[11px] font-medium" onclick={useAsReference}>📥 Load Frames</button>
							<button class="px-2 py-1.5 bg-green-500 text-white rounded hover:bg-green-600 text-[11px] font-medium" onclick={saveAnimation}>💾 Save Anim</button>
						{:else if activeCompleted.videoUrl}
							<a href={activeCompleted.videoUrl} target="_blank" class="px-2 py-1.5 bg-blue-500 text-white rounded hover:bg-blue-600 text-[11px] font-medium text-center">🎬 Open Video</a>
							<a href={activeCompleted.videoUrl} download="animation.mp4" class="px-2 py-1.5 bg-green-500 text-white rounded hover:bg-green-600 text-[11px] font-medium text-center">📥 Download</a>
						{/if}
					</div>
					<div class="flex gap-1.5 mt-1.5">
						<button class="flex-1 px-2 py-1 bg-purple-100 text-purple-700 rounded hover:bg-purple-200 text-[10px]" onclick={download}>📥 Download</button>
						<button class="flex-1 px-2 py-1 bg-red-100 text-red-700 rounded hover:bg-red-200 text-[10px]" onclick={discard}>🗑️ Discard</button>
					</div>
				</div>
			{/if}
		{/if}
	</div>
</div>
