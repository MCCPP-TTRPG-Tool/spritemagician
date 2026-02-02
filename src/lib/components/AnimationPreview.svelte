<script>
	import { projectStore } from '$lib/stores/project.js';
	
	let project = $state({ frames: [], fps: 12 });
	
	projectStore.subscribe(value => {
		project = value;
	});
	
	let isPlaying = $state(false);
	let currentFrame = $state(0);
	let animationFrameId = $state(null);

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

