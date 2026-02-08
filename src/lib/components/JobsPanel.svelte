<script>
	import { jobQueue } from '$lib/stores/jobQueue.js';
	import { completedJobs } from '$lib/stores/completedJobs.js';
	import { projectStore } from '$lib/stores/project.js';
	import { userFiles } from '$lib/stores/userFiles.js';
	import { createFile } from '$lib/firebase/firestore.js';
	import FolderPicker from './FolderPicker.svelte';
	import { onDestroy } from 'svelte';

	// ── local state ─────────────────────────────────────────
	let queue     = $state([]);
	let completed = $state({ jobs: [], activeIndex: 0, loaded: false });

	// Preview animation
	let animFrame    = $state(0);
	let animInterval = null;

	// Dropdown menu
	let menuItemId = $state(null);

	// Save-to-folder
	let showFolderPicker = $state(false);
	let savingJobId      = $state(null);
	let isSaving         = $state(false);

	jobQueue.subscribe(v => { queue = v; });
	completedJobs.subscribe(v => { completed = v; });

	// ── derived ─────────────────────────────────────────────
	const activeJobs = $derived(queue.filter(j => j.status === 'pending' || j.status === 'processing'));
	const failedJobs = $derived(queue.filter(j => j.status === 'failed'));
	const allJobs = $derived([...activeJobs, ...failedJobs, ...completed.jobs]);

	// ── animation loop for expanded preview ─────────────────
	$effect(() => {
		if (animInterval) { clearInterval(animInterval); animInterval = null; }
		animFrame = 0;
		const job = expandedJob;
		if (job?.type === 'animation' && job.frames?.length > 1) {
			const fps = job.fps || 12;
			let f = 0;
			animInterval = setInterval(() => {
				f = (f + 1) % job.frames.length;
				animFrame = f;
			}, 1000 / fps);
		}
	});
	onDestroy(() => { if (animInterval) clearInterval(animInterval); });

	// ── helpers ──────────────────────────────────────────────
	function elapsed(job) {
		if (!job.createdAt) return '';
		const start = new Date(job.createdAt);
		const end   = job.completedAt ? new Date(job.completedAt) : new Date();
		const s     = Math.floor((end - start) / 1000);
		return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
	}

	function thumbnail(job) {
		if (job.type === 'sprite' && job.image) return job.image;
		if (job.frames?.length) return job.frames[0];
		return null;
	}

	// ── actions ──────────────────────────────────────────────
	function toggleMenu(jobId, e) {
		e.stopPropagation();
		menuItemId = menuItemId === jobId ? null : jobId;
	}

	function useForProject(job) {
		if (job.type === 'sprite' && job.image) {
			projectStore.update(p => ({ ...p, firstFrame: job.image }));
		} else if (job.frames?.length) {
			projectStore.update(p => ({ ...p, frames: [...job.frames] }));
		}
		menuItemId = null;
	}

	function startSave(job) {
		savingJobId = job.id;
		showFolderPicker = true;
		menuItemId = null;
	}

	async function onFolderSelect(folderId, folderPath) {
		showFolderPicker = false;
		const job = completed.jobs.find(j => j.id === savingJobId);
		if (!job) return;
		isSaving = true;

		try {
			const uid = userFiles.getUid();
			if (!uid) throw new Error('Not signed in');

			if (job.type === 'sprite' && job.image) {
				const res = await fetch('/api/upload-file', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						imageData: job.image,
						filename: `${(job.name || 'sprite').slice(0, 40)}.png`
					})
				});
				if (!res.ok) throw new Error('Upload failed');
				const { url } = await res.json();
				await createFile(uid, folderId, `${(job.name || 'sprite').slice(0, 40)}.png`, url, 'image', {
					sourceType: 'generation', prompt: job.description || job.name
				});
			} else if (job.frames?.length) {
				// Save as a single .anim.json file via dedicated endpoint
				const animName = (job.name || 'animation').slice(0, 40);
				const res = await fetch('/api/save-animation', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						name: animName,
						frames: job.frames,
						fps: job.fps || 12,
						prompt: job.description || job.name || ''
					})
				});
				if (!res.ok) {
					const errData = await res.json().catch(() => ({}));
					throw new Error(errData.error || 'Upload failed');
				}
				const { url, frameCount } = await res.json();
				const fname = `${animName.replace(/[^a-zA-Z0-9_-]/g, '_')}.anim.json`;
				await createFile(uid, folderId, fname, url, 'animation', {
					sourceType: 'animation',
					frameCount,
					fps: job.fps || 12,
					animationName: job.name,
					prompt: job.description || job.name || ''
				});
			} else if (job.videoUrl) {
				await createFile(uid, folderId, `${(job.name || 'animation').slice(0, 40)}.mp4`, job.videoUrl, 'video', {
					sourceType: 'animation-video', prompt: job.name
				});
			}

			completedJobs.removeJob(job.id);
		} catch (err) {
			console.error('[JobsPanel] Save error:', err);
			alert('Save failed: ' + err.message);
		} finally {
			isSaving = false;
			savingJobId = null;
		}
	}

	function download(job) {
		const a = document.createElement('a');
		if (job.type === 'sprite' && job.image) { a.href = job.image; a.download = `${job.name || 'sprite'}.png`; }
		else if (job.videoUrl)   { a.href = job.videoUrl; a.download = `${job.name || 'anim'}.mp4`; }
		else if (job.frames?.[0]) { a.href = job.frames[0]; a.download = `${job.name || 'frame'}.png`; }
		a.click();
	}

	function discard(job) {
		if (job.status === 'pending' || job.status === 'processing') {
			jobQueue.cancelJob(job.id);
		} else if (job.status === 'failed') {
			jobQueue.removeJob(job.id);
		} else {
			completedJobs.removeJob(job.id);
		}
		menuItemId = null;
	}
</script>

<!-- Close dropdown when clicking anywhere -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<svelte:window onclick={() => { menuItemId = null; }} />

<!-- ═══════════════════════════════════════════════════════════
     JOBS PANEL — file grid layout
     ═══════════════════════════════════════════════════════════ -->
<div class="flex flex-col h-full text-xs">
	<div class="flex-1 overflow-y-auto p-2">
		{#if !completed.loaded && allJobs.length === 0}
			<div class="flex items-center justify-center h-32 text-gray-400">
				<div class="text-center">
					<div class="animate-spin w-5 h-5 border-2 border-gray-300 border-t-blue-500 rounded-full mx-auto mb-2"></div>
					<p class="text-[11px]">Loading…</p>
				</div>
			</div>
		{:else if allJobs.length === 0}
			<div class="flex flex-col items-center justify-center h-full text-gray-400 gap-2 px-4">
				<span class="text-3xl opacity-50">📭</span>
				<p class="text-[11px] text-center">No jobs yet.<br/>Generate a sprite or animation to see results here.</p>
			</div>
		{:else}
			<!-- Jobs Grid -->
			<div class="grid grid-cols-4 gap-2">
				{#each allJobs as job (job.id)}
					{@const thumb = thumbnail(job)}
					{@const isActive = job.status === 'pending' || job.status === 'processing'}
					{@const isFailed = job.status === 'failed'}
					{@const isCompleted = !isActive && !isFailed}
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div
						class="relative group rounded-lg border-2 cursor-pointer transition-all aspect-square bg-gray-100
							{isFailed ? 'border-red-300' : isActive ? 'border-blue-300' : 'border-transparent hover:border-gray-300'}"
					>
						<div class="aspect-square flex items-center justify-center overflow-hidden rounded-t-md">
							{#if thumb}
								<img src={thumb} alt={job.name} class="w-full h-full object-contain" />
							{:else if job.videoUrl}
								<div class="w-full h-full flex items-center justify-center text-2xl">🎬</div>
							{:else}
								<div class="w-full h-full flex items-center justify-center text-2xl text-gray-300">?</div>
							{/if}
						</div>

						<!-- Progress percentage for active jobs -->
						{#if isActive && job.progress > 0}
							<div class="absolute inset-0 flex items-center justify-center bg-black/50 rounded-t-md">
								<span class="text-white font-bold text-lg">{job.progress}%</span>
							</div>
						{/if}

						<!-- Status indicator -->
						<div class="absolute top-1 left-1 px-1 py-0.5 rounded text-[8px] font-bold leading-none
							{isActive ? 'bg-blue-500 text-white' : isFailed ? 'bg-red-500 text-white' : job.type === 'sprite' ? 'bg-emerald-500 text-white' : 'bg-blue-500 text-white'}">
							{#if isActive}
								⚡
							{:else if isFailed}
								✕
							{:else if job.type === 'sprite'}
								IMG
							{:else}
								{job.frames?.length ? `${job.frames.length}f` : 'VID'}
							{/if}
						</div>

						<!-- Menu button (only for completed jobs) -->
						{#if isCompleted}
							<button
								class="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/40 text-white text-xs flex items-center justify-center
									opacity-0 group-hover:opacity-100 hover:bg-black/60 transition-all z-10"
								onclick={(e) => toggleMenu(job.id, e)}
								title="Actions"
							>⋯</button>

							<!-- Dropdown menu -->
							{#if menuItemId === job.id}
								<!-- svelte-ignore a11y_no_static_element_interactions -->
								<div
									class="absolute top-8 left-1 z-50 w-36 bg-white rounded-lg shadow-xl border py-1 text-[11px]"
									onclick={(e) => e.stopPropagation()}
								>
									<button class="w-full text-left px-3 py-1.5 hover:bg-blue-50 text-gray-700 flex items-center gap-2"
										onclick={() => startSave(job)}>
										💾 <span>Save to Folder</span>
									</button>
									<button class="w-full text-left px-3 py-1.5 hover:bg-green-50 text-gray-700 flex items-center gap-2"
										onclick={() => useForProject(job)}>
										▶ <span>Use for Project</span>
									</button>
									<div class="border-t my-0.5"></div>
									<button class="w-full text-left px-3 py-1.5 hover:bg-gray-50 text-gray-700 flex items-center gap-2"
										onclick={() => { download(job); menuItemId = null; }}>
										📥 <span>Download</span>
									</button>
									<button class="w-full text-left px-3 py-1.5 hover:bg-red-50 text-red-600 flex items-center gap-2"
										onclick={() => discard(job)}>
										🗑 <span>Delete</span>
									</button>
								</div>
							{/if}
						{/if}

						<!-- Cancel button for active jobs -->
						{#if isActive}
							<button
								class="absolute top-1 right-1 w-6 h-6 rounded-full bg-red-500/80 text-white text-xs flex items-center justify-center
									opacity-0 group-hover:opacity-100 hover:bg-red-600 transition-all z-10"
								onclick={(e) => { e.stopPropagation(); jobQueue.cancelJob(job.id); }}
								title="Cancel"
							>✕</button>
						{/if}

						<div class="px-1.5 py-1">
							<p class="text-[11px] truncate text-center font-medium">{job.name || 'Job'}</p>
							{#if job.message && isActive}
								<p class="text-[9px] text-gray-500 text-center truncate">{job.message}</p>
							{/if}
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</div>

	<!-- Status bar -->
	<div class="flex items-center justify-between px-2 py-1 bg-gray-50 border-t text-[10px] text-gray-500 flex-shrink-0">
		<span>{allJobs.length} job{allJobs.length !== 1 ? 's' : ''} ({activeJobs.length} active, {completed.jobs.length} completed)</span>
		{#if completed.jobs.length > 0}
			<button
				class="text-red-400 hover:text-red-600 transition-colors"
				onclick={() => completedJobs.clearAll()}
			>Clear all</button>
		{/if}
	</div>
</div>

<!-- ── FOLDER PICKER MODAL ────────────────────────────────── -->
{#if showFolderPicker}
	<FolderPicker
		onSelect={onFolderSelect}
		onClose={() => { showFolderPicker = false; savingJobId = null; }}
	/>
{/if}
