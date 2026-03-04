<script>
	import { projectStore, removeFrame } from '$lib/stores/project.js';
	import { userFiles } from '$lib/stores/userFiles.js';
	import { createFile } from '$lib/firebase/firestore.js';
	import FolderPicker from './FolderPicker.svelte';
	import AnimationQueueBar from './AnimationQueueBar.svelte';
	import { CHROMA_KEY_HEX } from '$lib/constants/chromaKey.js';
	import { CHROMA_KEY_TOLERANCE } from '$lib/constants/chromaKey.js';
	import { cleanupBackgrounds, detectGreenArtifacts } from '$lib/utils/backgroundCleanup.js';
import { activeAssetStore } from '$lib/stores/activeAsset.js';
	
	let project = $state({ frames: [], fps: 12, currentFrame: 0 });
	let isLooped = $state(false);
	let isPlaying = $state(false);

	// Plain variables (NOT $state) — used only by the rAF loop, no reactivity needed
	let _rafId = null;
	let _lastFrameTime = 0;
	let _playing = false;            // mirror of isPlaying for the rAF closure
	let _prevFrameCount = 0;         // track frame count changes for isLooped reset
	
	// Save frame state
	let showFolderPicker = $state(false);
	let saveFolderId = $state(null);
	let saveFolderPath = $state(null);
	let isSavingFrame = $state(false);
	let isSavingAllFrames = $state(false);
	let saveFrameName = $state('');
	let saveFrameNote = $state('');
	let saveMode = $state('single'); // 'single' | 'all'
	let featureP1ActiveAssetDestinationGuard = $state(true);
	const FEATURE_P1_ACTIVE_ASSET_GUARD_KEY = 'sm.ff.p1_active_asset_destination_guard';
	
	let previewSize = $state('md'); // 'sm' | 'md' | 'lg'

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

	// Shorthand getter/setter for currentFrame via the store
	function getCurrentFrame() { return project.currentFrame || 0; }
	function setCurrentFrame(val) {
		projectStore.update(p => ({ ...p, currentFrame: val }));
	}
	
	projectStore.subscribe(value => {
		project = value;
		// Only reset loop flag when frame count actually changes
		if (value.frames.length !== _prevFrameCount) {
			isLooped = false;
			_prevFrameCount = value.frames.length;
		}
		// Ensure currentFrame is within bounds
		const cf = value.currentFrame || 0;
		if (cf >= value.frames.length && value.frames.length > 0) {
			setCurrentFrame(value.frames.length - 1);
		} else if (value.frames.length === 0 && cf !== 0) {
			setCurrentFrame(0);
		}
	});

	function togglePlay() {
		if (_playing) {
			stop();
		} else {
			play();
		}
	}

	function play() {
		if (project.frames.length === 0) return;
		_playing = true;
		isPlaying = true;
		_lastFrameTime = performance.now();
		tick();
	}

	function stop() {
		_playing = false;
		isPlaying = false;
		if (_rafId) {
			cancelAnimationFrame(_rafId);
			_rafId = null;
		}
	}

	function tick() {
		_rafId = requestAnimationFrame((now) => {
			if (!_playing || project.frames.length === 0) return;

			const delay = 1000 / (project.fps || 12);
			if (now - _lastFrameTime >= delay) {
				_lastFrameTime = now - ((now - _lastFrameTime) % delay);
				const next = (getCurrentFrame() + 1) % project.frames.length;
				setCurrentFrame(next);
			}

			tick();
		});
	}

	function previousFrame() {
		stop();
		setCurrentFrame((getCurrentFrame() - 1 + project.frames.length) % project.frames.length);
	}

	function nextFrame() {
		stop();
		setCurrentFrame((getCurrentFrame() + 1) % project.frames.length);
	}

	function setFrame(index) {
		stop();
		setCurrentFrame(index);
	}

	function createPingPongLoop() {
		if (project.frames.length < 2) return;
		
		// Create ping-pong loop: forward frames + reverse frames (excluding first to avoid duplication)
		// Example: [1,2,3,4,5] becomes [1,2,3,4,5,4,3,2]
		const forward = project.frames;
		const backward = project.frames.slice(1, -1).reverse(); // Skip first and last, then reverse
		const loopedFrames = [...forward, ...backward];
		
		projectStore.update(p => ({
			...p,
			frames: loopedFrames
		}));
		
		isLooped = true;
		setCurrentFrame(0);
		stop();
	}

	function deleteCurrentFrame() {
		const cf = getCurrentFrame();
		if (project.frames.length === 0 || cf < 0 || cf >= project.frames.length) return;
		
		stop();
		removeFrame(cf);
		
		// Adjust current frame after deletion
		if (project.frames.length > 1) {
			if (cf >= project.frames.length - 1) {
				setCurrentFrame(project.frames.length - 2);
			}
		} else {
			setCurrentFrame(0);
		}
	}

	function duplicateCurrentFrame() {
		const cf = getCurrentFrame();
		if (project.frames.length === 0 || cf < 0 || cf >= project.frames.length) return;
		stop();
		const frameCopy = project.frames[cf];
		projectStore.update(p => {
			const newFrames = [...p.frames];
			newFrames.splice(cf + 1, 0, frameCopy);
			return { ...p, frames: newFrames, currentFrame: cf + 1 };
		});
	}

	function removeEveryNthFrame(n) {
		if (project.frames.length <= 1) return;
		stop();
		const newFrames = project.frames.filter((_, i) => (i + 1) % n !== 0);
		if (newFrames.length === 0) return;
		projectStore.update(p => ({
			...p,
			frames: newFrames,
			currentFrame: Math.min(p.currentFrame || 0, newFrames.length - 1)
		}));
	}

	let isFlipping = $state(false);

	async function flipAllFramesHorizontal() {
		if (project.frames.length === 0) return;
		isFlipping = true;
		stop();

		try {
			const flipped = await Promise.all(project.frames.map(dataUrl => flipImage(dataUrl)));
			projectStore.update(p => ({ ...p, frames: flipped }));
		} catch (err) {
			console.error('Flip error:', err);
			alert('Failed to flip frames: ' + err.message);
		} finally {
			isFlipping = false;
		}
	}

	function flipImage(dataUrl) {
		return new Promise((resolve, reject) => {
			const img = new Image();
			img.onload = () => {
				const canvas = document.createElement('canvas');
				canvas.width = img.width;
				canvas.height = img.height;
				const ctx = canvas.getContext('2d');
				ctx.translate(canvas.width, 0);
				ctx.scale(-1, 1);
				ctx.drawImage(img, 0, 0);
				resolve(canvas.toDataURL('image/png'));
			};
			img.onerror = () => reject(new Error('Failed to load image for flipping'));
			img.src = dataUrl;
		});
	}

	let isRemovingBackground = $state(false);
	let bgRemovalProgress = $state(null); // { status: string, message: string, progress?: number, current?: number, total?: number }
	const USE_HYBRID_BG_REMOVAL = false; // Forced rollback: use legacy full rembg flow

	async function removeBackgroundViaApi(images) {
		const res = await fetch('/api/remove-background', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ images })
		});
		const data = await res.json();
		if (!res.ok) {
			throw new Error(data?.error || 'Background removal request failed');
		}
		if (!data?.images || !Array.isArray(data.images)) {
			throw new Error('Background removal returned invalid response');
		}
		return data.images;
	}

	async function runRembgBatches(frames, frameIndexes, onProgress) {
		const output = [...frames];
		const batchSize = 4;
		let processed = 0;

		for (let i = 0; i < frameIndexes.length; i += batchSize) {
			const end = Math.min(i + batchSize, frameIndexes.length);
			const indexBatch = frameIndexes.slice(i, end);
			const batch = indexBatch.map((idx) => output[idx]);
			const cleanedBatch = await removeBackgroundViaApi(batch);
			for (let j = 0; j < indexBatch.length; j++) {
				const frameIndex = indexBatch[j];
				output[frameIndex] = cleanedBatch[j] || output[frameIndex];
				processed++;
				onProgress?.(processed, frameIndexes.length, 'rembg');
			}
		}

		return output;
	}

	async function removeBackgroundHybrid(frames, frameIndexes, onProgress) {
		const activeChroma = $activeAssetStore?.chromaKeyHex || CHROMA_KEY_HEX;
		const initial = [...frames];

		if (!USE_HYBRID_BG_REMOVAL) {
			return runRembgBatches(initial, frameIndexes, onProgress);
		}

		const subset = frameIndexes.map((idx) => initial[idx]);
		const chromaCleaned = await cleanupBackgrounds(
			subset,
			70,
			(done, total) => onProgress?.(done, total, 'chroma'),
			true,
			{
				chromaKeyHex: activeChroma,
				chromaTolerance: CHROMA_KEY_TOLERANCE,
				chromaOnly: true
			}
		);

		// Write chroma-cleaned subset back into output.
		for (let i = 0; i < frameIndexes.length; i++) {
			initial[frameIndexes[i]] = chromaCleaned[i] || initial[frameIndexes[i]];
		}

		const flaggedGlobalIndexes = [];
		for (let i = 0; i < frameIndexes.length; i++) {
			const globalIndex = frameIndexes[i];
			const artifact = await detectGreenArtifacts(initial[globalIndex], {
				chromaKeyHex: activeChroma,
				edgeSpillThreshold: 0.03,
				opaqueGreenThreshold: 0.005
			});
			if (artifact.isArtifact) flaggedGlobalIndexes.push(globalIndex);
		}

		if (flaggedGlobalIndexes.length === 0) return initial;
		return runRembgBatches(initial, flaggedGlobalIndexes, onProgress);
	}

	async function removeBackgroundFromCurrent() {
		const cf = getCurrentFrame();
		if (project.frames.length === 0 || cf < 0 || cf >= project.frames.length) return;
		
		isRemovingBackground = true;
		bgRemovalProgress = { status: 'processing', message: 'Removing background from current frame...', progress: 0 };
		stop();
		
		try {
			const activeChroma = $activeAssetStore?.chromaKeyHex || CHROMA_KEY_HEX;
			const total = 1;
			const newFrames = await removeBackgroundHybrid(
				project.frames,
				[cf],
				(done, batchTotal, phase) => {
					if (phase === 'chroma') {
						bgRemovalProgress = {
							status: 'processing',
							message: `Chroma cleanup (${done}/${batchTotal}) on ${activeChroma}...`,
							progress: Math.min(85, Math.round((done / Math.max(1, batchTotal)) * 85))
						};
						return;
					}
					bgRemovalProgress = {
						status: 'processing',
						message: USE_HYBRID_BG_REMOVAL
							? `rembg fallback (${done}/${batchTotal}) on ${activeChroma}...`
							: `rembg cleanup (${done}/${batchTotal}) on ${activeChroma}...`,
						progress: 85 + Math.round((done / Math.max(1, batchTotal)) * 15)
					};
				}
			);
			projectStore.update(p => ({ ...p, frames: newFrames }));
			bgRemovalProgress = { status: 'completed', message: `Background cleanup done (${total} frame).`, progress: 100 };
			setTimeout(() => {
				bgRemovalProgress = null;
			}, 2000);
		} catch (err) {
			console.error('Background removal error:', err);
			bgRemovalProgress = { status: 'error', message: 'Failed: ' + err.message, progress: 0 };
			setTimeout(() => {
				bgRemovalProgress = null;
			}, 3000);
		} finally {
			isRemovingBackground = false;
		}
	}

	async function removeBackgroundFromAll() {
		if (project.frames.length === 0) return;
		
		if (!confirm(`Remove background from all ${project.frames.length} frames? This may take a while.`)) {
			return;
		}

		isRemovingBackground = true;
		bgRemovalProgress = { status: 'processing', message: `Removing background from ${project.frames.length} frames...`, progress: 0, current: 0, total: project.frames.length };
		stop();
		
		try {
			const totalFrames = project.frames.length;
			const allIndexes = project.frames.map((_, i) => i);
			const activeChroma = $activeAssetStore?.chromaKeyHex || CHROMA_KEY_HEX;
			const newFrames = await removeBackgroundHybrid(
				project.frames,
				allIndexes,
				(done, total, phase) => {
					if (phase === 'chroma') {
						bgRemovalProgress = {
							status: 'processing',
							message: `Chroma cleanup (${done}/${total}) on ${activeChroma}...`,
							progress: Math.min(85, Math.round((done / Math.max(1, total)) * 85)),
							current: done,
							total: totalFrames
						};
						return;
					}
					bgRemovalProgress = {
						status: 'processing',
						message: USE_HYBRID_BG_REMOVAL
							? `rembg fallback (${done}/${total}) on ${activeChroma}...`
							: `rembg cleanup (${done}/${total}) on ${activeChroma}...`,
						progress: 85 + Math.round((done / Math.max(1, total)) * 15),
						current: done,
						total: totalFrames
					};
				}
			);

			bgRemovalProgress = { status: 'processing', message: 'Finalizing...', progress: 95, current: totalFrames, total: totalFrames };
			projectStore.update(p => ({ ...p, frames: newFrames }));
			
			bgRemovalProgress = { status: 'completed', message: `Background removed from ${newFrames.length} frames!`, progress: 100, current: totalFrames, total: totalFrames };
			setTimeout(() => {
				bgRemovalProgress = null;
			}, 2000);
		} catch (err) {
			console.error('Background removal error:', err);
			bgRemovalProgress = { status: 'error', message: 'Failed: ' + err.message, progress: 0 };
			setTimeout(() => {
				bgRemovalProgress = null;
			}, 3000);
		} finally {
			isRemovingBackground = false;
		}
	}

	async function saveCurrentFrame() {
		const cf = getCurrentFrame();
		if (project.frames.length === 0 || cf < 0 || cf >= project.frames.length) return;
		if (featureP1ActiveAssetDestinationGuard && !$activeAssetStore?.folderId) {
			const blockedPayload = {
				entryPoint: 'animation_preview',
				sourceType: 'frame'
			};
			emitAssetUiEvent('asset.destination.blocked_missing_context', blockedPayload);
			emitAssetTelemetry('sm.p1.save_without_active_asset_blocked', blockedPayload);
			saveFrameNote = 'Select an active asset folder first.';
			return;
		}
		
		// Initialize default filename if not set
		if (!saveFrameName) {
			saveFrameName = `frame_${String(cf + 1).padStart(3, '0')}`;
		}
		saveMode = 'single';
		saveFolderId = $activeAssetStore?.folderId || saveFolderId || null;
		saveFolderPath = $activeAssetStore?.folderPath || $activeAssetStore?.folderName || saveFolderPath || null;
		
		// Always show the save dialog with filename input
		saveFrameNote = '';
		showFolderPicker = true;
	}

	function defaultAllFramesBaseName() {
		const raw = (project.prompt || 'animation').trim() || 'animation';
		const clean = raw.replace(/[^a-zA-Z0-9_\- ]/g, '_').slice(0, 40).trim();
		return clean || 'animation';
	}

	async function saveAllFrames() {
		if (project.frames.length === 0) return;
		if (featureP1ActiveAssetDestinationGuard && !$activeAssetStore?.folderId) {
			const blockedPayload = {
				entryPoint: 'animation_preview',
				sourceType: 'animation_frames'
			};
			emitAssetUiEvent('asset.destination.blocked_missing_context', blockedPayload);
			emitAssetTelemetry('sm.p1.save_without_active_asset_blocked', blockedPayload);
			saveFrameNote = 'Select an active asset folder first.';
			return;
		}

		saveMode = 'all';
		if (!saveFrameName) {
			saveFrameName = defaultAllFramesBaseName();
		}
		saveFolderId = $activeAssetStore?.folderId || saveFolderId || null;
		saveFolderPath = $activeAssetStore?.folderPath || $activeAssetStore?.folderName || saveFolderPath || null;
		saveFrameNote = '';
		showFolderPicker = true;
	}
	
	let showNestedFolderPicker = $state(false);
	
	async function onFolderSelect(folderId, folderPath) {
		saveFolderId = folderId;
		saveFolderPath = folderPath;
		showNestedFolderPicker = false;
		if (featureP1ActiveAssetDestinationGuard) {
			const confirmedPayload = {
				destinationPath: folderPath || null,
				confirmationSource: 'explicit_picker_select'
			};
			emitAssetUiEvent('asset.destination.confirmed', confirmedPayload);
			emitAssetTelemetry('sm.p1.save_destination_confirmed', confirmedPayload);
		}
		// Don't close main dialog - let user confirm with filename
	}
	
	async function performSaveFrame() {
		const cf = getCurrentFrame();
		if (!saveFolderId || project.frames.length === 0) return;
		if (saveMode === 'single' && (cf < 0 || cf >= project.frames.length)) return;
		if (featureP1ActiveAssetDestinationGuard) {
			const confirmedPayload = {
				destinationPath: saveFolderPath || null,
				confirmationSource: 'dialog_submit'
			};
			emitAssetUiEvent('asset.destination.confirmed', confirmedPayload);
			emitAssetTelemetry('sm.p1.save_destination_confirmed', confirmedPayload);
		}
		
		if (saveMode === 'single') {
			isSavingFrame = true;
		} else {
			isSavingAllFrames = true;
		}
		stop();
		
		try {
			const uid = userFiles.getUid();
			if (!uid) {
				saveFrameNote = 'You must be logged in to save files.';
				return;
			}

			if (saveMode === 'single') {
				const frameData = project.frames[cf];
				// Use custom filename or generate default
				const baseName = saveFrameName.trim() || `frame_${String(cf + 1).padStart(3, '0')}`;
				const filename = baseName.endsWith('.png') ? baseName : `${baseName}.png`;

				const res = await fetch('/api/upload-file', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						imageData: frameData,
						filename,
						folder: saveFolderId
					})
				});

				if (!res.ok) {
					const data = await res.json();
					throw new Error(data.error || 'Upload failed');
				}

				const { url } = await res.json();
				await createFile(uid, saveFolderId, filename, url, 'image', {
					sourceType: 'animation-frame',
					frameIndex: cf,
					totalFrames: project.frames.length,
					animationName: project.prompt || 'animation',
					fps: project.fps
				});

				saveFrameNote = `Frame ${cf + 1} saved successfully.`;
			} else {
				const total = project.frames.length;
				const baseName = (saveFrameName.trim() || defaultAllFramesBaseName())
					.replace(/[^a-zA-Z0-9_\- ]/g, '_')
					.slice(0, 40)
					.trim() || 'animation';

				for (let i = 0; i < total; i++) {
					const frameData = project.frames[i];
					const frameSuffix = String(i + 1).padStart(3, '0');
					const filename = `${baseName}_frame_${frameSuffix}.png`;
					saveFrameNote = `Saving frames... ${i + 1}/${total}`;

					const res = await fetch('/api/upload-file', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({
							imageData: frameData,
							filename,
							folder: saveFolderId
						})
					});

					if (!res.ok) {
						const data = await res.json().catch(() => ({}));
						throw new Error(data.error || `Upload failed at frame ${i + 1}`);
					}

					const { url } = await res.json();
					await createFile(uid, saveFolderId, filename, url, 'image', {
						sourceType: 'animation-frame-batch',
						frameIndex: i,
						totalFrames: total,
						animationName: project.prompt || 'animation',
						fps: project.fps
					});
				}

				saveFrameNote = `Saved ${total} frames to folder.`;
			}

			// Reset and close
			saveFrameName = '';
			showFolderPicker = false;
			saveFolderId = null;
			saveFolderPath = null;
			saveMode = 'single';
		} catch (err) {
			console.error('Save frame error:', err);
			saveFrameNote = 'Failed to save frame: ' + err.message;
		} finally {
			isSavingFrame = false;
			isSavingAllFrames = false;
		}
	}

	$effect(() => {
		return () => {
			_playing = false;
			if (_rafId) {
				cancelAnimationFrame(_rafId);
				_rafId = null;
			}
		};
	});
</script>

<div class="flex flex-col h-full">
	<!-- ═══ PREVIEW ═══ -->
	<div class="flex-1 min-h-0 bg-gray-100 flex items-center justify-center"
		class:p-1={previewSize === 'sm'}
		class:p-2={previewSize === 'md'}
		class:p-3={previewSize === 'lg'}
	>
		{#if project.frames.length > 0}
			<img
				src={project.frames[getCurrentFrame()]}
				alt="Frame {getCurrentFrame() + 1}"
				class="object-contain"
				class:max-h-[120px]={previewSize === 'sm'}
				class:max-h-[50%]={previewSize === 'md'}
				class:max-h-full={previewSize === 'lg'}
				class:max-w-full={true}
				style="image-rendering: -webkit-optimize-contrast; image-rendering: crisp-edges;"
			/>
		{:else}
			<p class="text-gray-400 text-xs">No frames</p>
		{/if}
	</div>

	<!-- ═══ TOOLBAR ═══ -->
	<div class="flex-shrink-0 border-t bg-white px-2 py-2 space-y-1.5">
		<!-- Row 1: Playback + Size + Info -->
		<div class="flex items-center gap-1.5">
			<button class="w-7 h-7 text-sm bg-gray-100 rounded hover:bg-gray-200 disabled:opacity-30" onclick={previousFrame} disabled={project.frames.length === 0} title="Previous">⏮</button>
			<button class="w-7 h-7 text-sm bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-30" onclick={togglePlay} disabled={project.frames.length === 0} title={isPlaying ? 'Pause' : 'Play'}>{isPlaying ? '⏸' : '▶️'}</button>
			<button class="w-7 h-7 text-sm bg-gray-100 rounded hover:bg-gray-200 disabled:opacity-30" onclick={nextFrame} disabled={project.frames.length === 0} title="Next">⏭</button>

			<div class="w-px h-5 bg-gray-300 mx-0.5"></div>

			<!-- Size -->
			{#each [['sm','S'],['md','M'],['lg','L']] as [val, label]}
				<button
					class="w-6 h-6 text-[10px] rounded font-bold {previewSize === val ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}"
					onclick={() => previewSize = val}
					title="{label === 'S' ? 'Small' : label === 'M' ? 'Medium' : 'Large'} preview"
				>{label}</button>
			{/each}

			<div class="w-px h-5 bg-gray-300 mx-0.5"></div>

			<!-- FPS -->
			<button class="w-6 h-6 text-[10px] rounded font-bold bg-gray-100 text-gray-500 hover:bg-gray-200 disabled:opacity-30"
				onclick={() => projectStore.update(p => ({ ...p, fps: Math.max(1, p.fps - 1) }))}
				disabled={project.fps <= 1}
				title="Decrease FPS">−</button>
			<span class="text-[10px] text-gray-500 tabular-nums min-w-[28px] text-center font-bold">{project.fps}</span>
			<button class="w-6 h-6 text-[10px] rounded font-bold bg-gray-100 text-gray-500 hover:bg-gray-200 disabled:opacity-30"
				onclick={() => projectStore.update(p => ({ ...p, fps: Math.min(60, p.fps + 1) }))}
				disabled={project.fps >= 60}
				title="Increase FPS">+</button>

			<span class="ml-auto text-xs text-gray-400 tabular-nums min-w-[70px] text-right">
				{#if project.frames.length > 0}
					{getCurrentFrame() + 1}/{project.frames.length} · {project.fps}fps
				{:else}
					—
				{/if}
			</span>
		</div>

		<!-- Row 2: Frame dots (fixed size to prevent vibration) -->
		{#if project.frames.length > 0}
			<div class="flex items-center justify-center gap-[3px] flex-wrap min-h-[12px]">
				{#each project.frames as _, i}
					<button
						class="w-2 h-2 rounded-full transition-colors {getCurrentFrame() === i
							? 'bg-blue-500 ring-1 ring-blue-300'
							: 'bg-gray-300 hover:bg-gray-400'}"
						onclick={() => setFrame(i)}
						title="Frame {i + 1}"
					></button>
				{/each}
			</div>
		{/if}

		<!-- Row 3: Actions -->
		{#if project.frames.length > 0}
			<div class="flex items-center justify-center gap-1.5 flex-wrap">
				<button
					class="h-7 px-2.5 text-xs rounded transition-colors {isLooped ? 'bg-green-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}"
					onclick={createPingPongLoop}
					disabled={project.frames.length < 2}
					title="Create ping-pong loop"
				>{isLooped ? '🔄 Looped' : '🔄 Loop'}</button>

				<button
					class="h-7 px-2.5 text-xs bg-indigo-500 text-white rounded hover:bg-indigo-600 disabled:opacity-30"
					onclick={flipAllFramesHorizontal}
					disabled={isFlipping}
					title="Flip all frames horizontally (mirror)"
				>{isFlipping ? '⏳' : '↔️ Flip'}</button>

				<button
					class="h-7 px-2.5 text-xs bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-30"
					onclick={saveCurrentFrame}
					disabled={isSavingFrame || isSavingAllFrames}
					title="Save current frame"
				>{isSavingFrame ? '⏳' : '💾 Save'}</button>

				<button
					class="h-7 px-2.5 text-xs bg-blue-700 text-white rounded hover:bg-blue-800 disabled:opacity-30"
					onclick={saveAllFrames}
					disabled={isSavingFrame || isSavingAllFrames || project.frames.length === 0}
					title="Save all frames to folder"
				>{isSavingAllFrames ? '⏳' : '💾 Save All'}</button>

				<button
					class="h-7 px-2.5 text-xs bg-gray-500 text-white rounded hover:bg-gray-600 disabled:opacity-30"
					onclick={duplicateCurrentFrame}
					title="Duplicate current frame"
				>📋 Dupe</button>

				<button
					class="h-7 px-2.5 text-xs bg-red-500 text-white rounded hover:bg-red-600 disabled:opacity-30"
					onclick={deleteCurrentFrame}
					title="Delete current frame"
				>🗑️</button>

				<button
					class="h-7 px-2.5 text-xs bg-teal-500 text-white rounded hover:bg-teal-600 disabled:opacity-30"
					onclick={removeBackgroundFromCurrent}
					disabled={isRemovingBackground}
					title="Remove background (current frame)"
				>{isRemovingBackground ? '⏳' : '✨ BG'}</button>

				<button
					class="h-7 px-2.5 text-xs bg-teal-600 text-white rounded hover:bg-teal-700 disabled:opacity-30"
					onclick={removeBackgroundFromAll}
					disabled={isRemovingBackground}
					title="Remove background (all {project.frames.length} frames)"
				>{isRemovingBackground ? '⏳' : '✨ All'}</button>

				<div class="w-px h-5 bg-gray-300 mx-0.5"></div>

				<button
					class="h-7 px-2.5 text-xs bg-orange-500 text-white rounded hover:bg-orange-600 disabled:opacity-30"
					onclick={() => removeEveryNthFrame(2)}
					disabled={project.frames.length <= 2}
					title="Remove every 2nd frame (keep {Math.ceil(project.frames.length / 2)})"
				>½</button>
				<button
					class="h-7 px-2.5 text-xs bg-orange-500 text-white rounded hover:bg-orange-600 disabled:opacity-30"
					onclick={() => removeEveryNthFrame(3)}
					disabled={project.frames.length <= 3}
					title="Remove every 3rd frame (keep {project.frames.length - Math.floor(project.frames.length / 3)})"
				>⅔</button>
				<button
					class="h-7 px-2.5 text-xs bg-orange-500 text-white rounded hover:bg-orange-600 disabled:opacity-30"
					onclick={() => removeEveryNthFrame(4)}
					disabled={project.frames.length <= 4}
					title="Remove every 4th frame (keep {project.frames.length - Math.floor(project.frames.length / 4)})"
				>¾</button>
			</div>
		{/if}
		{#if saveFrameNote}
			<p class="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">{saveFrameNote}</p>
		{/if}
	</div>
	
	<!-- ═══ ANIMATION QUEUE BAR ═══ -->
	<AnimationQueueBar />
	
	<!-- ═══ BACKGROUND REMOVAL PROGRESS BAR ═══ -->
	{#if bgRemovalProgress}
		<div class="flex-shrink-0 border-t bg-teal-50 px-3 py-2">
			<div class="flex items-center gap-2 mb-1">
				{#if bgRemovalProgress.status === 'processing'}
					<svg class="animate-spin h-4 w-4 text-teal-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
						<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
						<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
					</svg>
				{:else if bgRemovalProgress.status === 'completed'}
					<span class="text-sm">✅</span>
				{:else if bgRemovalProgress.status === 'error'}
					<span class="text-sm">❌</span>
				{/if}
				<span class="text-xs font-medium text-teal-800">
					{#if bgRemovalProgress.total && bgRemovalProgress.total > 1}
						Removing Background ({bgRemovalProgress.current || 0}/{bgRemovalProgress.total} frames)
					{:else}
						Removing Background
					{/if}
				</span>
				{#if bgRemovalProgress.progress !== undefined}
					<span class="ml-auto text-xs font-bold text-teal-700 tabular-nums">{bgRemovalProgress.progress}%</span>
				{/if}
			</div>
			<p class="text-[10px] text-teal-600 mb-1.5">{bgRemovalProgress.message}</p>
			{#if bgRemovalProgress.progress !== undefined}
				<div class="w-full bg-teal-200 rounded-full h-1.5">
					<div 
						class="bg-teal-600 h-1.5 rounded-full transition-all duration-300"
						style="width: {bgRemovalProgress.progress}%"
					></div>
				</div>
			{/if}
		</div>
	{/if}
</div>

{#if showFolderPicker}
	<!-- Custom Save Dialog with Filename Input -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
		onclick={() => { showFolderPicker = false; saveFrameName = ''; }}
		onkeydown={(e) => { if (e.key === 'Escape') { showFolderPicker = false; saveFrameName = ''; } }}
	>
		<div class="bg-white rounded-xl shadow-2xl w-full max-w-md" onclick={(e) => e.stopPropagation()}>
			<!-- Header -->
			<div class="flex items-center justify-between px-4 py-3 border-b">
				<h3 class="text-sm font-bold text-gray-800">{saveMode === 'all' ? '💾 Save All Frames' : '💾 Save Frame'}</h3>
				<button class="text-gray-400 hover:text-gray-600 text-lg" onclick={() => { showFolderPicker = false; saveFrameName = ''; }}>✕</button>
			</div>
			
			<!-- Filename Input -->
			<div class="px-4 py-3 border-b">
				<label class="block text-xs font-medium text-gray-700 mb-1.5">{saveMode === 'all' ? 'Base name' : 'Filename'}</label>
				<input
					type="text"
					bind:value={saveFrameName}
					placeholder={saveMode === 'all' ? defaultAllFramesBaseName() : `frame_${String(getCurrentFrame() + 1).padStart(3, '0')}`}
					class="w-full px-2 py-1.5 text-xs border rounded focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
					onkeydown={(e) => { if (e.key === 'Enter' && saveFolderId) performSaveFrame(); }}
					autofocus
				/>
				<p class="text-[10px] text-gray-400 mt-1">
					{#if saveMode === 'all'}
						Leaves empty to use a default base name. Files save as `base_frame_001.png`, `base_frame_002.png`, etc.
					{:else}
						Leave empty for default name. Extension (.png) will be added automatically.
					{/if}
				</p>
			</div>
			
			<!-- Folder Selection -->
			<div class="px-4 py-2 border-b bg-gray-50">
				<label class="block text-xs font-medium text-gray-700 mb-1.5">Save to folder</label>
				{#if saveFolderPath}
					<div class="flex items-center justify-between px-2 py-1.5 bg-blue-50 rounded border border-blue-200">
						<span class="text-xs font-medium text-blue-700">{saveFolderPath}</span>
						<button class="text-xs text-blue-600 hover:text-blue-800" onclick={() => { saveFolderId = null; saveFolderPath = null; }}>Change</button>
					</div>
					{#if featureP1ActiveAssetDestinationGuard}
						<p class="mt-1 text-[10px] text-emerald-700">Saving to: {saveFolderPath}</p>
					{/if}
				{:else}
					<button
						class="w-full px-2 py-1.5 text-xs bg-gray-100 hover:bg-gray-200 rounded border text-left text-gray-600"
						onclick={() => showNestedFolderPicker = true}
					>
						📁 Choose folder...
					</button>
				{/if}
			</div>
			
			<!-- Actions -->
			<div class="flex justify-end gap-2 px-4 py-3 border-t bg-gray-50 rounded-b-xl">
				<button class="px-4 py-1.5 text-xs text-gray-600 hover:bg-gray-200 rounded-lg" onclick={() => { showFolderPicker = false; saveFrameName = ''; saveFolderId = null; saveFolderPath = null; }}>
					Cancel
				</button>
				<button
					class="px-4 py-1.5 text-xs bg-blue-500 text-white rounded-lg hover:bg-blue-600 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
					onclick={async () => {
						if (saveFolderId) {
							await performSaveFrame();
						}
					}}
					disabled={!saveFolderId || isSavingFrame || isSavingAllFrames}
				>
					{#if isSavingAllFrames}
						⏳ Saving All...
					{:else if isSavingFrame}
						⏳ Saving...
					{:else if saveMode === 'all'}
						💾 Save All
					{:else}
						💾 Save
					{/if}
				</button>
			</div>
		</div>
	</div>
{/if}

<!-- Nested Folder Picker (shown when folder needs to be selected) -->
{#if showNestedFolderPicker}
	<FolderPicker
		onSelect={onFolderSelect}
		onClose={() => showNestedFolderPicker = false}
		startFolderId={$activeAssetStore.folderId}
		startFolderName={$activeAssetStore.folderName || 'Asset'}
	/>
{/if}
