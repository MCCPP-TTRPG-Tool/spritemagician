<script>
	import { onMount } from 'svelte';
	import { getAvailableActions, getPoseSequence, drawSkeleton } from '$lib/utils/poseLibrary.js';
	
	let canvas;
	let ctx;
	let selectedAction = $state('run');
	let currentFrame = $state(0);
	let isPlaying = $state(false);
	let playInterval = null;
	let fps = $state(12);
	
	const actions = getAvailableActions();
	const canvasSize = 200;
	
	$effect(() => {
		if (canvas) {
			ctx = canvas.getContext('2d');
			drawCurrentFrame();
		}
	});
	
	$effect(() => {
		// Redraw when frame or action changes
		if (ctx) {
			drawCurrentFrame();
		}
	});
	
	function drawCurrentFrame() {
		if (!ctx) return;
		
		const pose = getPoseSequence(selectedAction);
		const frameData = pose.frames[currentFrame % pose.frames.length];
		
		// Clear canvas
		ctx.fillStyle = '#1a1a2e';
		ctx.fillRect(0, 0, canvasSize, canvasSize);
		
		// Draw grid
		ctx.strokeStyle = '#333';
		ctx.lineWidth = 1;
		for (let i = 0; i <= 10; i++) {
			const pos = (i / 10) * canvasSize;
			ctx.beginPath();
			ctx.moveTo(pos, 0);
			ctx.lineTo(pos, canvasSize);
			ctx.stroke();
			ctx.beginPath();
			ctx.moveTo(0, pos);
			ctx.lineTo(canvasSize, pos);
			ctx.stroke();
		}
		
		// Draw skeleton
		drawSkeleton(ctx, frameData.keypoints, canvasSize, canvasSize, {
			pointColor: '#00ff88',
			lineColor: '#00ccff',
			pointRadius: 4,
			lineWidth: 2
		});
		
		// Draw frame info
		ctx.fillStyle = '#fff';
		ctx.font = '12px monospace';
		ctx.fillText(`Frame ${currentFrame + 1}/${pose.frames.length}`, 5, 15);
		if (frameData.description) {
			ctx.fillText(frameData.description.substring(0, 30), 5, canvasSize - 5);
		}
	}
	
	function play() {
		if (isPlaying) {
			clearInterval(playInterval);
			isPlaying = false;
		} else {
			const pose = getPoseSequence(selectedAction);
			playInterval = setInterval(() => {
				currentFrame = (currentFrame + 1) % pose.frames.length;
			}, 1000 / fps);
			isPlaying = true;
		}
	}
	
	function prevFrame() {
		const pose = getPoseSequence(selectedAction);
		currentFrame = (currentFrame - 1 + pose.frames.length) % pose.frames.length;
	}
	
	function nextFrame() {
		const pose = getPoseSequence(selectedAction);
		currentFrame = (currentFrame + 1) % pose.frames.length;
	}
	
	function changeAction(newAction) {
		selectedAction = newAction;
		currentFrame = 0;
		if (isPlaying) {
			clearInterval(playInterval);
			isPlaying = false;
		}
	}
	
	onMount(() => {
		return () => {
			if (playInterval) clearInterval(playInterval);
		};
	});
</script>

<div class="bg-gray-800 rounded-lg p-4 text-white">
	<h3 class="text-sm font-bold mb-3">Pose Library Tester</h3>
	
	<!-- Action Selection -->
	<div class="mb-3">
		<label class="block text-xs text-gray-400 mb-1">Action</label>
		<select 
			class="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm"
			value={selectedAction}
			onchange={(e) => changeAction(e.target.value)}
		>
			{#each actions as action}
				<option value={action.id}>{action.name} ({action.frameCount} frames)</option>
			{/each}
		</select>
	</div>
	
	<!-- Canvas -->
	<div class="flex justify-center mb-3">
		<canvas 
			bind:this={canvas} 
			width={canvasSize} 
			height={canvasSize}
			class="border border-gray-600 rounded"
		></canvas>
	</div>
	
	<!-- Controls -->
	<div class="flex items-center justify-center gap-2 mb-3">
		<button 
			class="px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded text-sm"
			onclick={prevFrame}
		>←</button>
		<button 
			class="px-4 py-1 rounded text-sm {isPlaying ? 'bg-red-600 hover:bg-red-500' : 'bg-green-600 hover:bg-green-500'}"
			onclick={play}
		>
			{isPlaying ? '⏹' : '▶'}
		</button>
		<button 
			class="px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded text-sm"
			onclick={nextFrame}
		>→</button>
	</div>
	
	<!-- FPS Control -->
	<div class="flex items-center justify-center gap-2">
		<label class="text-xs text-gray-400">FPS:</label>
		<input 
			type="range" 
			min="1" 
			max="30" 
			bind:value={fps}
			class="w-24"
		/>
		<span class="text-xs w-6">{fps}</span>
	</div>
</div>

