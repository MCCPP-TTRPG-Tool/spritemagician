<script>
	import { projectStore, removeFrame } from '$lib/stores/project.js';
	import { userFiles } from '$lib/stores/userFiles.js';
	import { createFile } from '$lib/firebase/firestore.js';
	import FolderPicker from './FolderPicker.svelte';
	
	let project = $state({ frames: [], fps: 12, currentFrame: 0 });
	let isLooped = $state(false);
	let isPlaying = $state(false);
	let animationFrameId = $state(null);
	
	// Save frame state
	let showFolderPicker = $state(false);
	let saveFolderId = $state(null);
	let saveFolderPath = $state(null);
	let isSavingFrame = $state(false);
	
	let previewSize = $state('md'); // 'sm' | 'md' | 'lg'

	// Shorthand getter/setter for currentFrame via the store
	function getCurrentFrame() { return project.currentFrame || 0; }
	function setCurrentFrame(val) {
		projectStore.update(p => ({ ...p, currentFrame: val }));
	}
	
	projectStore.subscribe(value => {
		project = value;
		// Reset loop state when frames change
		isLooped = false;
		// Ensure currentFrame is within bounds if frames array changes
		const cf = value.currentFrame || 0;
		if (cf >= value.frames.length && value.frames.length > 0) {
			setCurrentFrame(value.frames.length - 1);
		} else if (value.frames.length === 0 && cf !== 0) {
			setCurrentFrame(0);
		}
	});

	function togglePlay() {
		if (isPlaying) {
			stop();
		} else {
			play();
		}
	}

	function play() {
		if (project.frames.length === 0) return;
		isPlaying = true;
		animate();
	}

	function stop() {
		isPlaying = false;
		if (animationFrameId) {
			cancelAnimationFrame(animationFrameId);
			animationFrameId = null;
		}
	}

	function animate() {
		if (!isPlaying) return;
		
		const frameDelay = 1000 / project.fps;
		const startTime = performance.now();
		
		function frame(timestamp) {
			if (!isPlaying) return;
			
			const elapsed = timestamp - startTime;
			const frameIndex = Math.floor((elapsed / frameDelay) % project.frames.length);
			
			if (frameIndex !== getCurrentFrame()) {
				setCurrentFrame(frameIndex);
			}
			
			animationFrameId = requestAnimationFrame(frame);
		}
		
		animationFrameId = requestAnimationFrame(frame);
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

	let isRemovingBackground = $state(false);

	async function removeBackgroundFromCurrent() {
		const cf = getCurrentFrame();
		if (project.frames.length === 0 || cf < 0 || cf >= project.frames.length) return;
		
		isRemovingBackground = true;
		stop();
		
		try {
			const res = await fetch('/api/remove-background', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ images: [project.frames[cf]] })
			});

			if (!res.ok) {
				const data = await res.json();
				throw new Error(data.error || 'Background removal failed');
			}

			const { images } = await res.json();
			if (images && images[0]) {
				const newFrames = [...project.frames];
				newFrames[cf] = images[0];
				projectStore.update(p => ({ ...p, frames: newFrames }));
			}
		} catch (err) {
			console.error('Background removal error:', err);
			alert('Failed to remove background: ' + err.message);
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
		stop();
		
		try {
			// Process in batches to avoid overwhelming the API
			const batchSize = 5;
			const newFrames = [...project.frames];
			
			for (let i = 0; i < newFrames.length; i += batchSize) {
				const batch = newFrames.slice(i, i + batchSize);
				
				const res = await fetch('/api/remove-background', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ images: batch })
				});

				if (!res.ok) {
					const data = await res.json();
					throw new Error(data.error || 'Background removal failed');
				}

				const { images } = await res.json();
				if (images) {
					// Update frames in this batch
					for (let j = 0; j < images.length && (i + j) < newFrames.length; j++) {
						if (images[j]) {
							newFrames[i + j] = images[j];
						}
					}
				}
			}

			projectStore.update(p => ({ ...p, frames: newFrames }));
			alert(`Background removed from ${newFrames.length} frames!`);
		} catch (err) {
			console.error('Background removal error:', err);
			alert('Failed to remove backgrounds: ' + err.message);
		} finally {
			isRemovingBackground = false;
		}
	}

	async function saveCurrentFrame() {
		const cf = getCurrentFrame();
		if (project.frames.length === 0 || cf < 0 || cf >= project.frames.length) return;
		
		if (!saveFolderId) {
			showFolderPicker = true;
			return;
		}
		
		await performSaveFrame();
	}
	
	async function onFolderSelect(folderId, folderPath) {
		saveFolderId = folderId;
		saveFolderPath = folderPath;
		showFolderPicker = false;
		const cf = getCurrentFrame();
		if (project.frames.length > 0 && cf >= 0 && cf < project.frames.length) {
			await performSaveFrame();
		}
	}
	
	async function performSaveFrame() {
		const cf = getCurrentFrame();
		if (!saveFolderId || project.frames.length === 0 || cf < 0 || cf >= project.frames.length) return;
		
		isSavingFrame = true;
		stop();
		
		try {
			const uid = userFiles.getUid();
			if (!uid) {
				alert('You must be logged in to save files');
				return;
			}
			
			const frameData = project.frames[cf];
			const filename = `frame_${String(cf + 1).padStart(3, '0')}_${Date.now()}.png`;
			
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
			
			alert(`Frame ${cf + 1} saved successfully!`);
		} catch (err) {
			console.error('Save frame error:', err);
			alert('Failed to save frame: ' + err.message);
		} finally {
			isSavingFrame = false;
		}
	}

	$effect(() => {
		return () => {
			if (animationFrameId) {
				cancelAnimationFrame(animationFrameId);
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
				style="image-rendering: pixelated;"
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
					class="h-7 px-2.5 text-xs bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-30"
					onclick={saveCurrentFrame}
					disabled={isSavingFrame}
					title="Save current frame"
				>{isSavingFrame ? '⏳' : '💾 Save'}</button>

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
			</div>

			<!-- Row 4: Frame reduction -->
			<div class="flex items-center justify-center gap-1.5 flex-wrap">
				<span class="text-[10px] text-gray-400 font-medium">Reduce:</span>
				<button
					class="h-7 px-2.5 text-xs bg-orange-500 text-white rounded hover:bg-orange-600 disabled:opacity-30"
					onclick={() => removeEveryNthFrame(2)}
					disabled={project.frames.length <= 2}
					title="Remove every 2nd frame (keep {Math.ceil(project.frames.length / 2)})"
				>½ frames</button>
				<button
					class="h-7 px-2.5 text-xs bg-orange-500 text-white rounded hover:bg-orange-600 disabled:opacity-30"
					onclick={() => removeEveryNthFrame(3)}
					disabled={project.frames.length <= 3}
					title="Remove every 3rd frame (keep {project.frames.length - Math.floor(project.frames.length / 3)})"
				>⅔ frames</button>
				<button
					class="h-7 px-2.5 text-xs bg-orange-500 text-white rounded hover:bg-orange-600 disabled:opacity-30"
					onclick={() => removeEveryNthFrame(4)}
					disabled={project.frames.length <= 4}
					title="Remove every 4th frame (keep {project.frames.length - Math.floor(project.frames.length / 4)})"
				>¾ frames</button>
			</div>
		{/if}
	</div>
</div>

{#if showFolderPicker}
	<FolderPicker
		onSelect={onFolderSelect}
		onClose={() => showFolderPicker = false}
	/>
{/if}
