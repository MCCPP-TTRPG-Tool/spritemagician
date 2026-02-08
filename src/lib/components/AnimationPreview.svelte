<script>
	import { projectStore, removeFrame } from '$lib/stores/project.js';
	
	let project = $state({ frames: [], fps: 12 });
	let isLooped = $state(false);
	let isPlaying = $state(false);
	let currentFrame = $state(0);
	let animationFrameId = $state(null);
	
	projectStore.subscribe(value => {
		project = value;
		// Reset loop state when frames change
		isLooped = false;
		// Ensure currentFrame is within bounds if frames array changes
		if (currentFrame >= project.frames.length && project.frames.length > 0) {
			currentFrame = project.frames.length - 1;
		} else if (project.frames.length === 0) {
			currentFrame = 0;
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
			
			if (frameIndex !== currentFrame) {
				currentFrame = frameIndex;
			}
			
			animationFrameId = requestAnimationFrame(frame);
		}
		
		animationFrameId = requestAnimationFrame(frame);
	}

	function previousFrame() {
		stop();
		currentFrame = (currentFrame - 1 + project.frames.length) % project.frames.length;
	}

	function nextFrame() {
		stop();
		currentFrame = (currentFrame + 1) % project.frames.length;
	}

	function setFrame(index) {
		stop();
		currentFrame = index;
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
		currentFrame = 0;
		stop();
	}

	function deleteCurrentFrame() {
		if (project.frames.length === 0 || currentFrame < 0 || currentFrame >= project.frames.length) return;
		
		stop();
		removeFrame(currentFrame);
		
		// Adjust current frame after deletion
		if (project.frames.length > 1) {
			// If we deleted the last frame, move to the new last frame
			if (currentFrame >= project.frames.length - 1) {
				currentFrame = project.frames.length - 2;
			}
			// Otherwise stay on the same index (which now points to the next frame)
		} else {
			// No frames left
			currentFrame = 0;
		}
	}

	let isRemovingBackground = $state(false);

	async function removeBackgroundFromCurrent() {
		if (project.frames.length === 0 || currentFrame < 0 || currentFrame >= project.frames.length) return;
		
		isRemovingBackground = true;
		stop();
		
		try {
			const res = await fetch('/api/remove-background', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ images: [project.frames[currentFrame]] })
			});

			if (!res.ok) {
				const data = await res.json();
				throw new Error(data.error || 'Background removal failed');
			}

			const { images } = await res.json();
			if (images && images[0]) {
				// Update the current frame with transparent version
				const newFrames = [...project.frames];
				newFrames[currentFrame] = images[0];
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

	$effect(() => {
		return () => {
			if (animationFrameId) {
				cancelAnimationFrame(animationFrameId);
			}
		};
	});
</script>

<div class="space-y-2 flex flex-col h-full">
	<div class="bg-gray-100 rounded flex items-center justify-center flex-1 min-h-0">
		{#if project.frames.length > 0}
			<img
				src={project.frames[currentFrame]}
				alt="Frame {currentFrame + 1}"
				class="max-w-full max-h-full object-contain"
			/>
		{:else}
			<p class="text-gray-500 text-sm">No frames to preview</p>
		{/if}
	</div>

	<div class="flex items-center justify-center gap-2">
		<button
			class="px-2 py-1 text-xs bg-gray-200 rounded hover:bg-gray-300"
			onclick={previousFrame}
			disabled={project.frames.length === 0}
		>
			←
		</button>
		<button
			class="px-3 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600"
			onclick={togglePlay}
			disabled={project.frames.length === 0}
		>
			{isPlaying ? '⏸' : '▶'}
		</button>
		<button
			class="px-2 py-1 text-xs bg-gray-200 rounded hover:bg-gray-300"
			onclick={nextFrame}
			disabled={project.frames.length === 0}
		>
			→
		</button>
	</div>

	{#if project.frames.length > 0}
		<div class="flex items-center justify-center gap-2 flex-wrap">
			<button
				class="px-3 py-1 text-xs rounded transition-colors
					{isLooped 
						? 'bg-green-500 text-white hover:bg-green-600' 
						: 'bg-gray-200 text-gray-700 hover:bg-gray-300'}"
				onclick={createPingPongLoop}
				disabled={project.frames.length < 2}
				title="Create seamless loop (forward then backward)"
			>
				{isLooped ? '🔄 Looped' : '🔄 Create Loop'}
			</button>
			<button
				class="px-3 py-1 text-xs bg-red-500 text-white rounded hover:bg-red-600 transition-colors"
				onclick={deleteCurrentFrame}
				title="Delete current frame ({currentFrame + 1})"
			>
				🗑️ Delete Frame
			</button>
			<button
				class="px-3 py-1 text-xs bg-teal-500 text-white rounded hover:bg-teal-600 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
				onclick={removeBackgroundFromCurrent}
				disabled={isRemovingBackground}
				title="Remove background from current frame"
			>
				{#if isRemovingBackground}
					<span class="inline-flex items-center gap-1">
						<span class="animate-spin">⏳</span> Removing...
					</span>
				{:else}
					✨ Remove BG (Current)
				{/if}
			</button>
			<button
				class="px-3 py-1 text-xs bg-teal-600 text-white rounded hover:bg-teal-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
				onclick={removeBackgroundFromAll}
				disabled={isRemovingBackground}
				title="Remove background from all frames"
			>
				{#if isRemovingBackground}
					<span class="inline-flex items-center gap-1">
						<span class="animate-spin">⏳</span> Processing...
					</span>
				{:else}
					✨ Remove BG (All)
				{/if}
			</button>
		</div>
	{/if}

	{#if project.frames.length > 0}
		<div class="flex items-center justify-center gap-1 flex-wrap">
			{#each project.frames as _, index}
				<button
					class="w-2 h-2 rounded-full transition-all {currentFrame === index
						? 'bg-blue-500 scale-125'
						: 'bg-gray-300 hover:bg-gray-400'}"
					onclick={() => setFrame(index)}
					title="Frame {index + 1}"
				></button>
			{/each}
		</div>
		<p class="text-center text-xs text-gray-600">
			{currentFrame + 1}/{project.frames.length} @ {project.fps}fps
		</p>
	{/if}
</div>

