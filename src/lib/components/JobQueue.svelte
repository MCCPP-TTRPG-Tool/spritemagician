<script>
	import { jobQueue } from '$lib/stores/jobQueue.js';
	import { completedJobs } from '$lib/stores/completedJobs.js';
	
	let jobs = $state([]);
	let completed = $state({ jobs: [], activeIndex: 0 });
	let isCollapsed = $state(false);
	
	// Subscribe to job queue
	$effect(() => {
		const unsubscribe = jobQueue.subscribe(value => {
			jobs = value;
		});
		return unsubscribe;
	});
	
	// Subscribe to completed jobs
	$effect(() => {
		const unsubscribe = completedJobs.subscribe(value => {
			completed = value;
		});
		return unsubscribe;
	});
	
	// Click a completed job to preview it
	function previewJob(job) {
		if (job.status !== 'completed') return;
		
		// Find matching completed job by name/type
		const index = completed.jobs.findIndex(cj => {
			if (job.type?.includes('Animation') && cj.type === 'animation' && cj.name === job.name) return true;
			if (job.type?.includes('Sprite') && cj.type === 'sprite') return true;
			return false;
		});
		
		if (index >= 0) {
			completedJobs.setActiveIndex(index);
			// Scroll to top of center panel
			document.querySelector('.flex-1.overflow-y-auto')?.scrollTo({ top: 0, behavior: 'smooth' });
		}
	}
	
	function getStatusIcon(status) {
		switch (status) {
			case 'pending': return '⏳';
			case 'processing': return '⚡';
			case 'completed': return '👁️'; // Eye = clickable to preview
			case 'failed': return '❌';
			case 'cancelled': return '🚫';
			default: return '❓';
		}
	}
	
	function getStatusColor(status) {
		switch (status) {
			case 'pending': return 'text-yellow-600 bg-yellow-50';
			case 'processing': return 'text-blue-600 bg-blue-50';
			case 'completed': return 'text-green-600 bg-green-50';
			case 'failed': return 'text-red-600 bg-red-50';
			case 'cancelled': return 'text-gray-500 bg-gray-50';
			default: return 'text-gray-600 bg-gray-50';
		}
	}
	
	function formatTime(date) {
		if (!date) return '';
		const d = new Date(date);
		return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
	}
	
	function getElapsedTime(job) {
		if (!job.createdAt) return '';
		const start = new Date(job.createdAt);
		const end = job.completedAt ? new Date(job.completedAt) : new Date();
		const seconds = Math.floor((end - start) / 1000);
		if (seconds < 60) return `${seconds}s`;
		const minutes = Math.floor(seconds / 60);
		const remainingSeconds = seconds % 60;
		return `${minutes}m ${remainingSeconds}s`;
	}
	
	const activeJobs = $derived(jobs.filter(j => j.status === 'pending' || j.status === 'processing'));
	const hasActiveJobs = $derived(activeJobs.length > 0);
</script>

{#if jobs.length > 0}
	<div class="border-t border-gray-200 bg-gray-50">
		<!-- Header -->
		<button
			class="w-full flex items-center justify-between px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100 transition-colors"
			onclick={() => isCollapsed = !isCollapsed}
		>
			<div class="flex items-center gap-2">
				<span>{isCollapsed ? '▶' : '▼'}</span>
				<span>Job Queue</span>
				{#if hasActiveJobs}
					<span class="px-1.5 py-0.5 bg-blue-500 text-white text-[10px] rounded-full animate-pulse">
						{activeJobs.length} active
					</span>
				{/if}
			</div>
			<div class="flex items-center gap-2">
				<span class="text-[10px] text-gray-400">{jobs.length} jobs</span>
				{#if jobs.some(j => j.status === 'completed' || j.status === 'failed')}
					<button
						class="text-[10px] text-gray-500 hover:text-red-500 px-1"
						onclick={(e) => { e.stopPropagation(); jobQueue.clearFinished(); }}
					>Clear done</button>
				{/if}
			</div>
		</button>
		
		<!-- Job List -->
		{#if !isCollapsed}
			<div class="max-h-40 overflow-y-auto">
				{#each jobs as job}
					<div 
						class="flex items-center gap-2 px-3 py-1.5 border-t border-gray-100 text-xs {getStatusColor(job.status)} {job.status === 'completed' ? 'cursor-pointer hover:bg-green-100' : ''}"
						onclick={() => previewJob(job)}
						role={job.status === 'completed' ? 'button' : undefined}
					>
						<!-- Status Icon -->
						<span class="text-sm">{getStatusIcon(job.status)}</span>
						
						<!-- Job Info -->
						<div class="flex-1 min-w-0">
							<div class="flex items-center gap-2">
								<span class="font-medium truncate">{job.type || 'Job'}</span>
								<span class="text-[10px] text-gray-400">{job.name || ''}</span>
							</div>
							
							{#if job.status === 'processing' && job.progress > 0}
								<div class="w-full bg-gray-200 rounded-full h-1 mt-1">
									<div 
										class="bg-blue-500 h-1 rounded-full transition-all duration-300" 
										style="width: {job.progress}%"
									></div>
								</div>
							{/if}
							
							{#if job.message}
								<p class="text-[10px] text-gray-500 truncate">{job.message}</p>
							{/if}
							
							{#if job.error}
								<p class="text-[10px] text-red-500 truncate">{job.error}</p>
							{/if}
						</div>
						
						<!-- Time -->
						<div class="text-[10px] text-gray-400 text-right">
							<div>{formatTime(job.createdAt)}</div>
							<div>{getElapsedTime(job)}</div>
						</div>
						
						<!-- Actions -->
						<div class="flex items-center gap-1">
							{#if job.status === 'pending' || job.status === 'processing'}
								<button
									class="p-1 text-gray-400 hover:text-red-500"
									onclick={() => jobQueue.cancelJob(job.id)}
									title="Cancel"
								>✕</button>
							{:else}
								<button
									class="p-1 text-gray-400 hover:text-red-500"
									onclick={() => jobQueue.removeJob(job.id)}
									title="Remove"
								>✕</button>
							{/if}
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</div>
{/if}
