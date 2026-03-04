<script>
	import { jobQueue } from '$lib/stores/jobQueue.js';
	import { completedJobs } from '$lib/stores/completedJobs.js';
	import { projectStore } from '$lib/stores/project.js';
	import { userFiles } from '$lib/stores/userFiles.js';
	import { activeAssetStore } from '$lib/stores/activeAsset.js';
	import { createFile } from '$lib/firebase/firestore.js';
	import { addToQueue, resetInitialState } from '$lib/stores/animationQueue.js';
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
	let showSaveDialog   = $state(false);
	let showFolderPicker = $state(false);
	let savingJobId      = $state(null);
	let saveFileName     = $state('');
	let saveFolderId     = $state(null);
	let saveFolderPath   = $state(null);
	let isSaving         = $state(false);
	let jobsSaveNote     = $state('');
	let showPromptModal = $state(false);
	let promptModalTitle = $state('');
	let promptModalBody = $state('');
	let featureP1ActiveAssetDestinationGuard = $state(true);
	const FEATURE_P1_ACTIVE_ASSET_GUARD_KEY = 'sm.ff.p1_active_asset_destination_guard';

	// Multi-select
	let selectedJobIds = $state(new Set());
	let isSelectionMode = $derived(selectedJobIds.size > 0);
	let focusedEditGroupId = $state(null);

	jobQueue.subscribe(v => { queue = v; });
	completedJobs.subscribe(v => { completed = v; });

	if (typeof window !== 'undefined') {
		try {
			const rawAssetGuardFlag = localStorage.getItem(FEATURE_P1_ACTIVE_ASSET_GUARD_KEY);
			if (rawAssetGuardFlag === '0') {
				featureP1ActiveAssetDestinationGuard = false;
			}
		} catch {
			// ignore localStorage access errors
		}
	}

	// ── derived ─────────────────────────────────────────────
	const activeJobs = $derived(queue.filter(j => j.status === 'pending' || j.status === 'processing'));
	const failedJobs = $derived(queue.filter(j => j.status === 'failed'));
	const allJobs = $derived([...activeJobs, ...failedJobs, ...completed.jobs]);
	const completedEditGroups = $derived.by(() => {
		const grouped = new Map();
		const groupedIds = new Set();
		for (const job of completed.jobs) {
			if (job?.type !== 'sprite') continue;
			const key = job?.editClusterId || job?.editRootHistoryId;
			if (!key) continue;
			if (!grouped.has(key)) grouped.set(key, []);
			grouped.get(key).push(job);
			groupedIds.add(job.id);
		}

		const groups = [];
		for (const [rootHistoryId, items] of grouped.entries()) {
			const sorted = [...items].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
			const explicitRoot = sorted.find((item) => !item.editParentHistoryId) || sorted[0];
			const rootJob = explicitRoot;
			const childJobs = sorted.filter((item) => item.id !== rootJob.id);
			groups.push({ rootHistoryId, rootJob, childJobs });
		}
		groups.sort((a, b) => new Date(b.rootJob.createdAt) - new Date(a.rootJob.createdAt));

		const standaloneCompleted = completed.jobs
			.filter((job) => !groupedIds.has(job.id))
			.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

		return { groups, standaloneCompleted };
	});

	const focusedEditGroup = $derived.by(() => {
		if (!focusedEditGroupId) return null;
		return completedEditGroups.groups.find((group) => group.rootHistoryId === focusedEditGroupId) || null;
	});

	const renderedJobs = $derived.by(() => {
		const entries = [];
		if (focusedEditGroup) {
			entries.push({
				job: focusedEditGroup.rootJob,
				isChild: false,
				childCount: focusedEditGroup.childJobs.length,
				rootHistoryId: focusedEditGroup.rootHistoryId
			});
			for (const child of focusedEditGroup.childJobs) {
				entries.push({
					job: child,
					isChild: true,
					childCount: 0,
					rootHistoryId: focusedEditGroup.rootHistoryId
				});
			}
			return entries;
		}

		for (const job of activeJobs) {
			entries.push({ job, isChild: false, childCount: 0, rootHistoryId: null });
		}
		for (const job of failedJobs) {
			entries.push({ job, isChild: false, childCount: 0, rootHistoryId: null });
		}
		for (const group of completedEditGroups.groups) {
			entries.push({
				job: group.rootJob,
				isChild: false,
				childCount: group.childJobs.length,
				rootHistoryId: group.rootHistoryId
			});
		}
		for (const job of completedEditGroups.standaloneCompleted) {
			entries.push({ job, isChild: false, childCount: 0, rootHistoryId: null });
		}
		return entries;
	});

	const STATUS_META = {
		queued: { label: 'Queued', badgeClass: 'bg-slate-500 text-white', icon: 'Q' },
		processing: { label: 'Processing', badgeClass: 'bg-blue-500 text-white', icon: '⚡' },
		completed: { label: 'Completed', badgeClass: 'bg-emerald-500 text-white', icon: '✓' },
		failed: { label: 'Failed', badgeClass: 'bg-red-500 text-white', icon: '✕' },
		saved: { label: 'Saved', badgeClass: 'bg-violet-500 text-white', icon: '💾' }
	};

	const KIND_META = {
		image: { label: 'IMG', badgeClass: 'bg-sky-700/80 text-white' },
		animation: { label: 'ANIM', badgeClass: 'bg-indigo-700/80 text-white' },
		video: { label: 'VID', badgeClass: 'bg-rose-700/80 text-white' }
	};

	function canonicalStatus(job) {
		if (job?.status === 'pending') return 'queued';
		if (job?.status === 'processing') return 'processing';
		if (job?.status === 'completed') return 'completed';
		if (job?.status === 'failed') return 'failed';
		if (job?.status === 'saved') return 'saved';
		if (job?.status === 'cancelled') return 'failed';
		if (!job?.status && (job?.image || job?.frames?.length || job?.videoUrl)) return 'completed';
		return 'queued';
	}

	function normalizedJobType(job) {
		return String(job?.type || '').toLowerCase();
	}

	function isSpriteJob(job) {
		return normalizedJobType(job).includes('sprite');
	}

	function canonicalKind(job) {
		if (job?.kind) return job.kind;
		if (isSpriteJob(job)) return 'image';
		if (job?.frames?.length) return 'animation';
		if (job?.videoUrl) return 'video';
		return 'image';
	}

	function canonicalOrigin(job) {
		if (job?.origin) return job.origin;
		if (isSpriteJob(job)) return 'design';
		return 'animate';
	}

	function emitJobUiEvent(name, payload) {
		if (typeof window === 'undefined') return;
		window.dispatchEvent(new CustomEvent(name, { detail: payload }));
	}

	function emitJobTelemetry(eventName, payload) {
		if (typeof window === 'undefined') return;
		window.dispatchEvent(
			new CustomEvent('smTelemetryEvent', {
				detail: {
					eventName,
					payload,
					ts: new Date().toISOString()
				}
			})
		);
	}

	function emitAssetUiEvent(name, payload) {
		if (typeof window === 'undefined') return;
		window.dispatchEvent(new CustomEvent(name, { detail: payload }));
	}

	function emitAssetTelemetry(eventName, payload) {
		if (typeof window === 'undefined') return;
		window.dispatchEvent(
			new CustomEvent('smTelemetryEvent', {
				detail: {
					eventName,
					payload,
					ts: new Date().toISOString()
				}
			})
		);
	}

	let prevJobStatusById = new Map();
	let hasInitializedLifecycleTracking = false;

	$effect(() => {
		const next = new Map();
		for (const job of allJobs) {
			const normalized = canonicalStatus(job);
			next.set(job.id, normalized);
		}

		if (!hasInitializedLifecycleTracking) {
			prevJobStatusById = next;
			hasInitializedLifecycleTracking = true;
			return;
		}

		for (const job of allJobs) {
			const normalized = canonicalStatus(job);
			const previous = prevJobStatusById.get(job.id);
			const payload = {
				jobId: job.id,
				jobKind: canonicalKind(job),
				jobOrigin: canonicalOrigin(job),
				progress: Number.isFinite(job.progress) ? job.progress : 0
			};

			if (!previous) {
				emitJobUiEvent('job.created', payload);
				emitJobTelemetry('sm.p1.job_created', payload);
				continue;
			}

			if (previous !== normalized) {
				const changedPayload = { ...payload, fromStatus: previous, toStatus: normalized };
				emitJobUiEvent('job.status.changed', changedPayload);
				emitJobTelemetry('sm.p1.job_status_changed', changedPayload);

				if (normalized === 'completed') {
					emitJobUiEvent('job.completed', payload);
					emitJobTelemetry('sm.p1.job_completed', payload);
				}

				if (normalized === 'failed') {
					const failedPayload = {
						...payload,
						errorCode: job?.error?.code || 'job_failed',
						retryable: false
					};
					emitJobUiEvent('job.failed', failedPayload);
					emitJobTelemetry('sm.p1.job_failed', failedPayload);
				}
			}
		}

		prevJobStatusById = next;
	});

	// ── animation loop for expanded preview ─────────────────
	// Note: expandedJob functionality removed - this effect is disabled
	// $effect(() => {
	// 	if (animInterval) { clearInterval(animInterval); animInterval = null; }
	// 	animFrame = 0;
	// 	const job = expandedJob;
	// 	if (job?.type === 'animation' && job.frames?.length > 1) {
	// 		const fps = job.fps || 12;
	// 		let f = 0;
	// 		animInterval = setInterval(() => {
	// 			f = (f + 1) % job.frames.length;
	// 			animFrame = f;
	// 		}, 1000 / fps);
	// 	}
	// });
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
		if (isSpriteJob(job) && job.image) return job.image;
		if (job.frames?.length) return job.frames[0];
		return null;
	}

	function previewInRightPanel(job) {
		if (typeof window === 'undefined') return;

		// For animations, load into project so the right-side animation player is used.
		if (job.frames?.length) {
			useForProject(job);
			window.dispatchEvent(
				new CustomEvent('jobsAnimationSelected', {
					detail: {
						jobId: job.id,
						label: job.name || 'Animation'
					}
				})
			);
			return;
		}

		// For still jobs, keep right-side static preview behavior.
		const image = thumbnail(job);
		if (!image) return;
		window.dispatchEvent(
			new CustomEvent('jobsPreviewSelected', {
				detail: {
					image,
					label: job.name || 'Job Preview',
					jobId: job.id
				}
			})
		);
	}

	function openEditGroup(rootHistoryId) {
		if (!rootHistoryId) return;
		focusedEditGroupId = rootHistoryId;
		menuItemId = null;
		deselectAll();
	}

	function backToJobList() {
		focusedEditGroupId = null;
		menuItemId = null;
		deselectAll();
	}

	function loadIntoEditFromJob(job) {
		if (!isSpriteJob(job) || !job?.image) return false;
		projectStore.update((p) => ({
			...p,
			editImage: job.image,
			editFileId: job.sourceFileId || null,
			editClusterId: job.editClusterId || job.editRootHistoryId || null,
			editForceNewCluster: false
		}));
		menuItemId = null;
		return true;
	}

	function startNewForkFromJob(job) {
		if (!isSpriteJob(job) || !job?.image) return;
		projectStore.update((p) => ({
			...p,
			editImage: job.image,
			editFileId: null,
			editClusterId: null,
			editForceNewCluster: true
		}));
		menuItemId = null;
	}

	function formatPromptJsonValue(value) {
		if (!value) return '';
		if (typeof value === 'string') {
			try {
				return JSON.stringify(JSON.parse(value), null, 2);
			} catch {
				return value;
			}
		}
		try {
			return JSON.stringify(value, null, 2);
		} catch {
			return String(value);
		}
	}

	function openPromptJsonModal(job) {
		const body = formatPromptJsonValue(job?.promptJson);
		if (!body) return;
		promptModalTitle = `${job?.name || 'Job'} JSON Prompt`;
		promptModalBody = body;
		showPromptModal = true;
		menuItemId = null;
	}

	function closePromptJsonModal() {
		showPromptModal = false;
		promptModalTitle = '';
		promptModalBody = '';
	}

	function onJobCardClick(entry) {
		if (!entry) return;
		if (loadIntoEditFromJob(entry.job)) {
			previewInRightPanel(entry.job);
			if (!focusedEditGroupId && !entry.isChild && entry.childCount > 0 && entry.rootHistoryId) {
				openEditGroup(entry.rootHistoryId);
			}
			return;
		}
		if (!focusedEditGroupId && !entry.isChild && entry.childCount > 0 && entry.rootHistoryId) {
			openEditGroup(entry.rootHistoryId);
			return;
		}
		previewInRightPanel(entry.job);
	}

	// ── actions ──────────────────────────────────────────────
	function toggleMenu(jobId, e) {
		e.stopPropagation();
		menuItemId = menuItemId === jobId ? null : jobId;
	}

	function useForProject(job) {
		if (isSpriteJob(job) && job.image) {
			projectStore.update(p => ({ ...p, firstFrame: job.image }));
		} else if (job.frames?.length) {
			// Reset initial state when loading a new animation (so it becomes the new initial)
			resetInitialState();
			projectStore.update(p => ({ ...p, frames: [...job.frames] }));
		}
		menuItemId = null;
	}
	
	function addJobToQueue(job) {
		if (job.frames?.length) {
			addToQueue({
				id: job.id,
				name: job.name || 'Animation',
				frames: job.frames,
				fps: job.fps || 12,
				url: null // Jobs don't have URLs, they're in-memory
			});
			console.log(`[JobsPanel] Added to queue: ${job.name} (${job.frames.length} frames)`);
		}
		menuItemId = null;
	}

	async function renameJob(job) {
		const currentName = job?.name || 'Job';
		const next = prompt('Rename job:', currentName);
		const nextName = String(next || '').trim();
		if (!nextName || nextName === currentName) {
			menuItemId = null;
			return;
		}
		const cStatus = canonicalStatus(job);
		if (cStatus === 'completed' || cStatus === 'saved') {
			await completedJobs.renameJob(job.id, nextName);
		} else {
			jobQueue.updateJob(job.id, { name: nextName });
		}
		menuItemId = null;
	}

	function startSave(job) {
		if (featureP1ActiveAssetDestinationGuard && !$activeAssetStore?.folderId) {
			const blockedPayload = {
				entryPoint: 'jobs',
				sourceType: canonicalKind(job)
			};
			emitAssetUiEvent('asset.destination.blocked_missing_context', blockedPayload);
			emitAssetTelemetry('sm.p1.save_without_active_asset_blocked', blockedPayload);
			jobsSaveNote = 'Select an active asset folder first.';
			return;
		}

		savingJobId = job.id;
		saveFileName = job.name || (canonicalKind(job) === 'animation' ? 'animation' : 'image');
		saveFolderId = $activeAssetStore?.folderId || null;
		saveFolderPath = $activeAssetStore?.folderPath || $activeAssetStore?.folderName || null;
		showSaveDialog = true;
		jobsSaveNote = '';
		menuItemId = null;
	}

	function onFolderSelect(folderId, folderPath) {
		saveFolderId = folderId;
		saveFolderPath = folderPath;
		showFolderPicker = false;
		// If single save, continue with confirmSave
		if (savingJobId !== null) {
			// confirmSave will be called by the save dialog
		}
	}

	function cancelSaveDialog() {
		showSaveDialog = false;
		savingJobId = null;
		saveFileName = '';
		saveFolderId = null;
		saveFolderPath = null;
	}

	async function confirmSave() {
		const job = completed.jobs.find(j => j.id === savingJobId);
		if (!job) return;
		if (!saveFolderId) { showFolderPicker = true; return; }
		if (featureP1ActiveAssetDestinationGuard) {
			const confirmedPayload = {
				destinationPath: saveFolderPath || null,
				confirmationSource: 'dialog_submit'
			};
			emitAssetUiEvent('asset.destination.confirmed', confirmedPayload);
			emitAssetTelemetry('sm.p1.save_destination_confirmed', confirmedPayload);
		}

		const fileName = saveFileName.trim() || job.name || 'file';
		isSaving = true;

		try {
			const uid = userFiles.getUid();
			if (!uid) throw new Error('Not signed in');

			if (canonicalKind(job) === 'image' && job.image) {
				const safeName = fileName.slice(0, 40).replace(/[^a-zA-Z0-9_\- ]/g, '_');
				const res = await fetch('/api/upload-file', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						imageData: job.image,
						filename: `${safeName}.png`
					})
				});
				if (!res.ok) throw new Error('Upload failed');
				const { url } = await res.json();
				await createFile(uid, saveFolderId, `${safeName}.png`, url, 'image', {
					sourceType: 'generation', prompt: job.description || job.name
				});
			} else if (job.frames?.length) {
				const safeName = fileName.slice(0, 40).replace(/[^a-zA-Z0-9_\- ]/g, '_');
				const res = await fetch('/api/save-animation', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						name: safeName,
						frames: job.frames,
						fps: job.fps || 12,
						prompt: job.description || job.name || ''
					})
				});
				if (!res.ok) {
					const errData = await res.json().catch(() => ({}));
					throw new Error(errData.error || 'Upload failed');
				}
				const { url, frameCount, thumbnailUrl } = await res.json();
				await createFile(uid, saveFolderId, `${safeName}.anim.json`, url, 'animation', {
					sourceType: 'animation',
					frameCount,
					fps: job.fps || 12,
					animationName: safeName,
					prompt: job.description || job.name || '',
					thumbnailUrl: thumbnailUrl || null
				});
			} else if (job.videoUrl) {
				const safeName = fileName.slice(0, 40).replace(/[^a-zA-Z0-9_\- ]/g, '_');
				await createFile(uid, saveFolderId, `${safeName}.mp4`, job.videoUrl, 'video', {
					sourceType: 'animation-video', prompt: job.name
				});
			}

			const savedPayload = {
				jobId: job.id,
				jobKind: canonicalKind(job),
				jobOrigin: canonicalOrigin(job),
				progress: 100
			};
			emitJobUiEvent('job.saved', savedPayload);
			emitJobTelemetry('sm.p1.job_saved', savedPayload);

			completedJobs.removeJob(job.id);
			cancelSaveDialog();
		} catch (err) {
			console.error('[JobsPanel] Save error:', err);
			jobsSaveNote = 'Save failed: ' + err.message;
		} finally {
			isSaving = false;
		}
	}

	function download(job) {
		const a = document.createElement('a');
		if (canonicalKind(job) === 'image' && job.image) { a.href = job.image; a.download = `${job.name || 'image'}.png`; }
		else if (job.videoUrl)   { a.href = job.videoUrl; a.download = `${job.name || 'anim'}.mp4`; }
		else if (job.frames?.[0]) { a.href = job.frames[0]; a.download = `${job.name || 'frame'}.png`; }
		a.click();
	}

	function discard(job) {
		const cStatus = canonicalStatus(job);
		if (cStatus === 'queued' || cStatus === 'processing') {
			jobQueue.cancelJob(job.id);
		} else if (cStatus === 'failed') {
			jobQueue.removeJob(job.id);
		} else {
			completedJobs.removeJob(job.id);
		}
		menuItemId = null;
	}

	// ── multi-select actions ────────────────────────────────────
	function toggleSelect(jobId, e) {
		e.stopPropagation();
		if (selectedJobIds.has(jobId)) {
			selectedJobIds.delete(jobId);
		} else {
			selectedJobIds.add(jobId);
		}
		selectedJobIds = new Set(selectedJobIds); // Trigger reactivity
	}

	function selectAll() {
		const selectableJobs = renderedJobs.map((entry) => entry.job).filter((j) => {
			const isActive = canonicalStatus(j) === 'queued' || canonicalStatus(j) === 'processing';
			return !isActive; // Can select completed and failed jobs
		});
		selectedJobIds = new Set(selectableJobs.map(j => j.id));
	}

	function deselectAll() {
		selectedJobIds = new Set();
	}

	function getSelectedJobs() {
		return allJobs.filter(j => selectedJobIds.has(j.id));
	}

	async function batchDelete() {
		const selected = getSelectedJobs();
		if (selected.length === 0) return;
		if (!confirm(`Delete ${selected.length} job${selected.length !== 1 ? 's' : ''}?`)) return;

		for (const job of selected) {
			discard(job);
		}
		deselectAll();
	}

	async function batchRename() {
		const selected = getSelectedJobs();
		if (selected.length === 0) return;
		const baseName = prompt('Batch rename - base name:', 'Edited Job');
		const cleanBase = String(baseName || '').trim();
		if (!cleanBase) return;
		let idx = 1;
		for (const job of selected) {
			const nextName = selected.length === 1 ? cleanBase : `${cleanBase} ${idx++}`;
			const cStatus = canonicalStatus(job);
			if (cStatus === 'completed' || cStatus === 'saved') {
				await completedJobs.renameJob(job.id, nextName);
			} else {
				jobQueue.updateJob(job.id, { name: nextName });
			}
		}
		deselectAll();
	}

	async function batchSaveToFolder() {
		const selected = getSelectedJobs();
		if (selected.length === 0) return;
		if (featureP1ActiveAssetDestinationGuard && !$activeAssetStore?.folderId) {
			const blockedPayload = {
				entryPoint: 'jobs',
				sourceType: 'jobs_output'
			};
			emitAssetUiEvent('asset.destination.blocked_missing_context', blockedPayload);
			emitAssetTelemetry('sm.p1.save_without_active_asset_blocked', blockedPayload);
			jobsSaveNote = 'Select an active asset folder first.';
			return;
		}
		
		// Show folder picker first
		showFolderPicker = true;
		savingJobId = null; // Use null to indicate batch mode
	}

	async function batchDownload() {
		const selected = getSelectedJobs();
		if (selected.length === 0) return;

		for (const job of selected) {
			download(job);
			// Small delay to prevent browser blocking multiple downloads
			await new Promise(resolve => setTimeout(resolve, 100));
		}
		deselectAll();
	}

	async function batchUseForProject() {
		const selected = getSelectedJobs();
		if (selected.length === 0) return;
		
		// Use the first selected job
		const firstJob = selected[0];
		useForProject(firstJob);
		deselectAll();
	}

	async function onBatchFolderSelect(folderId, folderPath) {
		saveFolderId = folderId;
		saveFolderPath = folderPath;
		showFolderPicker = false;
		
		if (!saveFolderId) return;
		if (featureP1ActiveAssetDestinationGuard) {
			const confirmedPayload = {
				destinationPath: folderPath || null,
				confirmationSource: 'explicit_picker_select'
			};
			emitAssetUiEvent('asset.destination.confirmed', confirmedPayload);
			emitAssetTelemetry('sm.p1.save_destination_confirmed', confirmedPayload);
		}

		const selected = getSelectedJobs();
		if (selected.length === 0) return;

		isSaving = true;
		const uid = userFiles.getUid();
		if (!uid) {
			jobsSaveNote = 'You must be signed in to save files.';
			isSaving = false;
			return;
		}

		try {
			for (const job of selected) {
				const fileName = job.name || (canonicalKind(job) === 'animation' ? 'animation' : 'image');
				const safeName = fileName.slice(0, 40).replace(/[^a-zA-Z0-9_\- ]/g, '_');

				if (canonicalKind(job) === 'image' && job.image) {
					const res = await fetch('/api/upload-file', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({
							imageData: job.image,
							filename: `${safeName}.png`,
							folder: saveFolderId
						})
					});
					if (!res.ok) throw new Error('Upload failed');
					const { url } = await res.json();
					await createFile(uid, saveFolderId, `${safeName}.png`, url, 'image', {
						sourceType: 'generation', prompt: job.description || job.name
					});
				} else if (job.frames?.length) {
					const res = await fetch('/api/save-animation', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({
							name: safeName,
							frames: job.frames,
							fps: job.fps || 12,
							prompt: job.description || job.name || ''
						})
					});
					if (!res.ok) {
						const errData = await res.json().catch(() => ({}));
						throw new Error(errData.error || 'Upload failed');
					}
					const { url, frameCount, thumbnailUrl } = await res.json();
					await createFile(uid, saveFolderId, `${safeName}.anim.json`, url, 'animation', {
						sourceType: 'animation',
						frameCount,
						fps: job.fps || 12,
						animationName: safeName,
						prompt: job.description || job.name || '',
						thumbnailUrl: thumbnailUrl || null
					});
				} else if (job.videoUrl) {
					await createFile(uid, saveFolderId, `${safeName}.mp4`, job.videoUrl, 'video', {
						sourceType: 'animation-video', prompt: job.name
					});
				}

				const savedPayload = {
					jobId: job.id,
					jobKind: canonicalKind(job),
					jobOrigin: canonicalOrigin(job),
					progress: 100
				};
				emitJobUiEvent('job.saved', savedPayload);
				emitJobTelemetry('sm.p1.job_saved', savedPayload);

				// Remove job after successful save
				completedJobs.removeJob(job.id);
			}

			deselectAll();
			saveFolderId = null;
			saveFolderPath = null;
		} catch (err) {
			console.error('[JobsPanel] Batch save error:', err);
			jobsSaveNote = 'Batch save failed: ' + err.message;
		} finally {
			isSaving = false;
		}
	}
</script>

<!-- Close dropdown when clicking anywhere -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<svelte:window onclick={() => { menuItemId = null; }} />

<!-- ═══════════════════════════════════════════════════════════
     JOBS PANEL — file grid layout
     ═══════════════════════════════════════════════════════════ -->
<div class="flex flex-col h-full text-xs">
	<!-- Selection toolbar -->
	<div class="px-3 py-2 bg-blue-50 border-b border-blue-200 flex-shrink-0 space-y-1.5">
		<div class="flex items-center justify-between">
			<div class="flex items-center gap-2">
				{#if focusedEditGroupId}
					<button
						class="px-2 py-1 text-[10px] bg-white border border-blue-300 text-blue-700 rounded hover:bg-blue-100 transition-colors"
						onclick={backToJobList}
						title="Back to all jobs"
					>
						← Back
					</button>
				{/if}
				<span class="text-xs font-medium text-blue-700">{selectedJobIds.size} selected</span>
			</div>
			<div class="flex items-center gap-1">
				<button
					class="px-2 py-1 text-[10px] bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
					onclick={selectAll}
					title="Select all"
				>
					☑ Select All
				</button>
				<button
					class="px-2 py-1 text-[10px] bg-gray-300 text-gray-700 rounded transition-colors disabled:opacity-45 disabled:cursor-not-allowed"
					onclick={deselectAll}
					title="Deselect all"
					disabled={!isSelectionMode}
				>
					✕ Cancel
				</button>
			</div>
		</div>
		<div class="grid grid-cols-5 gap-1">
			<button
				class="px-2 py-1 text-[10px] bg-blue-500 text-white rounded transition-colors disabled:opacity-45 disabled:cursor-not-allowed"
				onclick={batchUseForProject}
				title="Use first selected for project"
				disabled={!isSelectionMode}
			>
				▶ Use
			</button>
			<button
				class="px-2 py-1 text-[10px] bg-green-500 text-white rounded transition-colors disabled:opacity-45 disabled:cursor-not-allowed"
				onclick={batchSaveToFolder}
				title="Save selected to folder"
				disabled={!isSelectionMode}
			>
				💾 Save
			</button>
			<button
				class="px-2 py-1 text-[10px] bg-amber-500 text-white rounded transition-colors disabled:opacity-45 disabled:cursor-not-allowed"
				onclick={batchRename}
				title="Rename selected"
				disabled={!isSelectionMode}
			>
				✏ Rename
			</button>
			<button
				class="px-2 py-1 text-[10px] bg-gray-500 text-white rounded transition-colors disabled:opacity-45 disabled:cursor-not-allowed"
				onclick={batchDownload}
				title="Download selected"
				disabled={!isSelectionMode}
			>
				📥 Download
			</button>
			<button
				class="px-2 py-1 text-[10px] bg-red-500 text-white rounded transition-colors disabled:opacity-45 disabled:cursor-not-allowed"
				onclick={batchDelete}
				title="Delete selected"
				disabled={!isSelectionMode}
			>
				🗑 Delete
			</button>
		</div>
	</div>

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
				<p class="text-[11px] text-center">No jobs yet.<br/>Generate an image or animation to see results here.</p>
			</div>
		{:else}
			<!-- Jobs Grid -->
			<div class="grid grid-cols-4 gap-2">
				{#each renderedJobs as entry (`${entry.job.id}-${entry.isChild ? 'child' : 'root'}`)}
					{@const job = entry.job}
					{@const thumb = thumbnail(job)}
					{@const cStatus = canonicalStatus(job)}
					{@const cMeta = STATUS_META[cStatus]}
					{@const cKind = canonicalKind(job)}
					{@const kindMeta = KIND_META[cKind] || KIND_META.image}
					{@const isActive = cStatus === 'queued' || cStatus === 'processing'}
					{@const isFailed = cStatus === 'failed'}
					{@const isCompleted = cStatus === 'completed' || cStatus === 'saved'}
					{@const isSelected = selectedJobIds.has(job.id)}
					{@const canSelect = !isActive}
					{@const hasChildren = entry.childCount > 0}
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div
						class="relative group rounded-lg border-2 cursor-pointer transition-all aspect-square bg-gray-100
							{isSelected ? 'border-blue-500 ring-2 ring-blue-300' : isFailed ? 'border-red-300' : isActive ? 'border-blue-300' : entry.isChild ? 'border-blue-200/70 bg-blue-50/30' : 'border-transparent hover:border-gray-300'}"
						onclick={() => onJobCardClick(entry)}
					>
						<!-- Selection checkbox -->
						{#if canSelect}
							<button
								class="absolute top-1 left-1 z-20 w-4 h-4 rounded border-2 flex items-center justify-center transition-all
									{isSelected ? 'bg-blue-500 border-blue-500' : 'bg-white border-gray-300 hover:border-blue-400'}"
								onclick={(e) => toggleSelect(job.id, e)}
								title={isSelected ? 'Deselect' : 'Select'}
							>
								{#if isSelected}
									<span class="text-white text-[8px] leading-none">✓</span>
								{/if}
							</button>
						{/if}
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
						<div class="absolute top-1 right-1 px-1 py-0.5 rounded text-[8px] font-bold leading-none z-10
							{cMeta.badgeClass}">
							{cMeta.icon}
						</div>

						<!-- Asset kind chip -->
						<div class="absolute bottom-8 left-1 px-1 py-0.5 rounded text-[8px] font-semibold leading-none z-10 {kindMeta.badgeClass}">
							{kindMeta.label}
						</div>

						{#if hasChildren}
							<div class="absolute bottom-8 right-1 px-1 py-0.5 rounded bg-slate-700/80 text-white text-[8px] font-semibold leading-none z-10">
								📂 {entry.childCount}
							</div>
						{/if}

						<!-- Menu button (only for completed jobs) -->
						{#if !isActive}
							<button
								class="absolute top-6 right-1 w-6 h-6 rounded-full bg-black/40 text-white text-xs flex items-center justify-center
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
									{#if isCompleted}
										<button class="w-full text-left px-3 py-1.5 hover:bg-blue-50 text-gray-700 flex items-center gap-2"
											onclick={() => startSave(job)}>
											💾 <span>Save to Folder</span>
										</button>
									{/if}
									<button class="w-full text-left px-3 py-1.5 hover:bg-amber-50 text-gray-700 flex items-center gap-2"
										onclick={() => renameJob(job)}>
										✏️ <span>Rename</span>
									</button>
									<button class="w-full text-left px-3 py-1.5 hover:bg-green-50 text-gray-700 flex items-center gap-2"
										onclick={() => useForProject(job)}>
										▶ <span>Use for Project</span>
									</button>
									{#if isSpriteJob(job)}
										<button class="w-full text-left px-3 py-1.5 hover:bg-orange-50 text-gray-700 flex items-center gap-2"
											onclick={() => startNewForkFromJob(job)}>
											🌱 <span>Start New Fork</span>
										</button>
									{/if}
									{#if job.promptJson}
										<button class="w-full text-left px-3 py-1.5 hover:bg-indigo-50 text-gray-700 flex items-center gap-2"
											onclick={() => openPromptJsonModal(job)}>
											🧾 <span>View JSON Prompt</span>
										</button>
									{/if}
									{#if job.frames?.length}
										<button class="w-full text-left px-3 py-1.5 hover:bg-blue-50 text-gray-700 flex items-center gap-2"
											onclick={() => { addJobToQueue(job); menuItemId = null; }}>
											➕ <span>Add to Queue</span>
										</button>
									{/if}
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
							<p class="text-[11px] truncate text-center font-medium">
								{entry.isChild ? `↳ ${job.name || 'Edit'}` : (job.name || 'Job')}
							</p>
							<p class="text-[9px] text-center text-gray-500">{cMeta.label}</p>
							{#if hasChildren}
								<p class="text-[9px] text-center text-slate-600">
									{focusedEditGroupId === entry.rootHistoryId ? 'Showing edits' : 'Click to open edits'}
								</p>
							{/if}
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
		<div class="flex items-center gap-2">
			<span>{allJobs.length} job{allJobs.length !== 1 ? 's' : ''} ({activeJobs.length} active, {completed.jobs.length} completed)</span>
		</div>
		{#if completed.jobs.length > 0 && !isSelectionMode}
			<button
				class="text-red-400 hover:text-red-600 transition-colors"
				onclick={() => completedJobs.clearAll()}
			>Clear all</button>
		{/if}
	</div>
</div>

{#if jobsSaveNote}
	<p class="px-2 py-1 text-[10px] text-amber-700 bg-amber-50 border-t border-amber-200">{jobsSaveNote}</p>
{/if}

{#if showPromptModal}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
		onclick={closePromptJsonModal}
		onkeydown={(e) => { if (e.key === 'Escape') closePromptJsonModal(); }}
		tabindex="0"
		role="dialog"
	>
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="bg-white rounded-xl shadow-2xl w-full max-w-3xl p-4 space-y-3"
			onclick={(e) => e.stopPropagation()}
		>
			<div class="flex items-center justify-between">
				<h3 class="text-sm font-bold text-gray-800">{promptModalTitle}</h3>
				<button
					class="px-2 py-1 text-xs text-gray-600 hover:bg-gray-100 rounded"
					onclick={closePromptJsonModal}
				>
					Close
				</button>
			</div>
			<pre class="max-h-[70vh] overflow-auto rounded border border-gray-200 bg-gray-50 p-3 text-[11px] text-gray-800 whitespace-pre-wrap break-words">{promptModalBody}</pre>
		</div>
	</div>
{/if}

<!-- ── SAVE DIALOG ───────────────────────────────────────── -->
{#if showSaveDialog}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
		onclick={cancelSaveDialog}
		onkeydown={(e) => { if (e.key === 'Escape') cancelSaveDialog(); }}
		tabindex="0" role="dialog">
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="bg-white rounded-xl shadow-2xl w-full max-w-sm p-4 space-y-3" onclick={(e) => e.stopPropagation()}>
			<h3 class="text-sm font-bold text-gray-800">💾 Save File</h3>

			<!-- Name input -->
			<div>
				<label class="block text-[10px] font-medium text-gray-500 mb-1">File name</label>
				<input
					type="text"
					class="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
					bind:value={saveFileName}
					placeholder="Enter file name…"
					onkeydown={(e) => { if (e.key === 'Enter') confirmSave(); }}
				/>
			</div>

			<!-- Folder picker -->
			<div>
				<label class="block text-[10px] font-medium text-gray-500 mb-1">Save to folder</label>
				<button
					class="w-full text-left px-3 py-1.5 text-xs rounded-lg border transition-colors truncate
						{saveFolderPath
							? 'bg-blue-50 border-blue-300 text-blue-700 font-medium'
							: 'bg-gray-50 border-gray-300 text-gray-400 hover:bg-gray-100'}"
					onclick={() => showFolderPicker = true}
				>
					{saveFolderPath || '📁 Choose folder…'}
				</button>
				{#if featureP1ActiveAssetDestinationGuard && saveFolderPath}
					<p class="mt-1 text-[10px] text-emerald-700">
						Saving to: {saveFolderPath}
					</p>
				{/if}
			</div>

			<!-- Actions -->
			<div class="flex justify-end gap-2 pt-1">
				<button
					class="px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
					onclick={cancelSaveDialog}
				>Cancel</button>
				<button
					class="px-4 py-1.5 text-xs bg-indigo-500 text-white rounded-lg hover:bg-indigo-600 disabled:bg-gray-400 font-medium transition-colors"
					onclick={confirmSave}
					disabled={isSaving || !saveFileName.trim() || !saveFolderId}
				>
					{isSaving ? '⏳ Saving…' : '💾 Save'}
				</button>
			</div>
		</div>
	</div>
{/if}

<!-- ── FOLDER PICKER MODAL ────────────────────────────────── -->
{#if showFolderPicker}
	<FolderPicker
		onSelect={savingJobId === null ? onBatchFolderSelect : onFolderSelect}
		onClose={() => showFolderPicker = false}
		startFolderId={$activeAssetStore.folderId}
		startFolderName={$activeAssetStore.folderName || 'Asset'}
	/>
{/if}
