<script>
	import { projectStore, updateFPS } from '$lib/stores/project.js';
	import FrameUpload from './FrameUpload.svelte';
	import { extractFrames } from '$lib/utils/videoFrameExtractor.js';
	
	let project = $state({ frames: [], fps: 12, firstFrame: null, frameCount: 8 });
	
	projectStore.subscribe(value => {
		project = value;
	});
	
	let prompt = $state('');
	let isGenerating = $state(false);
	let generationError = $state(null);
	let progress = $state({ currentFrame: 0, totalFrames: 0, status: 'idle', message: '' });
	let progressPollInterval = $state(null);
	let jobId = $state(null);
	
	// Animation settings - lower motion for 2D sprites
	let duration = $state(2); // seconds (1-3)
	let motionAmount = $state(50); // 1-255, lower = subtle motion for sprites
	let shouldLoop = $state(true); // Loop animation back to first frame
	let selectedPose = $state('idle'); // Pose preset
	
	// 2D sprite animation prompts - emphasize flat, minimal motion
	const posePresets = [
		{ id: 'idle', name: 'Idle', description: '2D sprite, subtle breathing, minimal motion, static camera, flat image' },
		{ id: 'floating', name: 'Floating', description: '2D sprite, gentle floating hover, minimal motion, static camera, flat' },
		{ id: 'glowing', name: 'Glowing', description: '2D sprite, pulsing glow effect, aura, minimal motion, static camera' },
		{ id: 'custom', name: 'Custom', description: '' }
	];
	
	// Available video models
	let selectedModel = $state('live2d');
	const videoModels = [
		{ id: 'live2d', name: 'Live2D', speed: '20-40s', quality: '2D Animation' },
		{ id: 'wan25', name: 'Wan 2.5', speed: '30-60s', quality: 'High quality' },
		{ id: 'minimax', name: 'Minimax', speed: '30-60s', quality: 'Standard' }
	];
	
	// Processing options
	let removeBackground = $state(false); // Disabled by default for faster testing

	function handleFirstFrameUpload(dataUrl) {
		projectStore.update(p => ({ ...p, firstFrame: dataUrl }));
	}

	async function pollProgress() {
		if (!jobId) return;
		
		try {
			const response = await fetch(`/api/generation-progress?jobId=${jobId}`);
			if (response.ok) {
				const data = await response.json();
				console.log('Progress update:', data);
				progress = data;
				
				// If video URL is returned, extract frames and remove backgrounds
				if (data.status === 'completed' && data.videoUrl) {
					if (progressPollInterval) {
						clearInterval(progressPollInterval);
						progressPollInterval = null;
					}
					
					try {
						// Step 1: Extract frames from video
						progress = { ...progress, message: 'Extracting frames from video...' };
						let rawFrames = await extractFrames(data.videoUrl, Math.round(duration * project.fps));
						console.log(`Extracted ${rawFrames.length} frames`);
						
					// Step 2: If loop enabled, create ping-pong loop
					if (shouldLoop && rawFrames.length > 2) {
						progress = { ...progress, message: 'Creating seamless loop...' };
						// Take first half, then reverse for smooth loop back
						const halfLength = Math.ceil(rawFrames.length / 2);
						const firstHalf = rawFrames.slice(0, halfLength);
						const secondHalf = rawFrames.slice(1, halfLength - 1).reverse();
						rawFrames = [...firstHalf, ...secondHalf];
						console.log(`Loop created: ${rawFrames.length} frames`);
					}
					
					// Step 3: Remove backgrounds (if enabled)
					let finalFrames = rawFrames;
					
					if (removeBackground) {
						const totalFrames = rawFrames.length;
						progress = { ...progress, message: `Removing backgrounds (0/${totalFrames})...` };
						
						const transparentFrames = [];
						for (let i = 0; i < rawFrames.length; i++) {
							progress = { ...progress, message: `Removing BG (${i + 1}/${totalFrames})...` };
							
							try {
								const response = await fetch('/api/remove-background', {
									method: 'POST',
									headers: { 'Content-Type': 'application/json' },
									body: JSON.stringify({ images: [rawFrames[i]] })
								});
								
								if (response.ok) {
									const result = await response.json();
									if (result.images && result.images[0]) {
										transparentFrames.push(result.images[0]);
									} else {
										transparentFrames.push(rawFrames[i]);
									}
								} else {
									transparentFrames.push(rawFrames[i]);
								}
							} catch (bgError) {
								console.error(`BG removal failed for frame ${i}:`, bgError);
								transparentFrames.push(rawFrames[i]);
							}
						}
						finalFrames = transparentFrames;
					}
						
					projectStore.update(p => ({
						...p,
						frames: finalFrames,
						prompt: selectedPose
					}));
					progress = { ...progress, status: 'completed', message: `Done! ${finalFrames.length} frames ready.` };
						
					} catch (extractError) {
						console.error('Frame processing failed:', extractError);
						generationError = 'Failed to process frames: ' + extractError.message;
					}
					
					isGenerating = false;
				}
				
				// If frames are directly included
				if (data.frames && data.frames.length > 0) {
					projectStore.update(p => ({
						...p,
						frames: data.frames,
						prompt: prompt
					}));
				}
				
				// Stop polling on completion or error
				if (data.status === 'completed' || data.status === 'error') {
					if (progressPollInterval) {
						clearInterval(progressPollInterval);
						progressPollInterval = null;
					}
					if (data.status === 'error') {
						generationError = data.message;
					}
					isGenerating = false;
				}
			}
		} catch (error) {
			console.error('Progress poll error:', error);
		}
	}

	async function generateFrames() {
		if (!project.firstFrame) {
			generationError = 'Reference image is required. Upload your sprite first.';
			return;
		}

		isGenerating = true;
		generationError = null;
		const frameCount = Math.round(duration * project.fps);
		progress = { currentFrame: 0, totalFrames: frameCount, status: 'starting', message: `Starting ${duration}s animation...` };
		jobId = null;

		// Clear existing frames
		projectStore.update(p => ({ ...p, frames: [] }));

		try {
			// Calculate frame count from duration and FPS
			const frameCount = Math.round(duration * project.fps);
			
			// Build prompt from pose preset
			const posePrompt = selectedPose === 'custom' 
				? prompt 
				: posePresets.find(p => p.id === selectedPose)?.description || selectedPose;
			
			// Use animation endpoint
			const response = await fetch('/api/generate-animation', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					referenceImage: project.firstFrame,
					prompt: posePrompt,
					pose: selectedPose,
					frameCount: frameCount,
					duration: duration,
					motionAmount: motionAmount,
					fps: project.fps,
					loop: shouldLoop,
					model: selectedModel
				})
			});

			const data = await response.json();

			if (!response.ok) {
				throw new Error(data.error || 'Generation failed');
			}

			jobId = data.jobId;
			
			if (!jobId) {
				throw new Error('No jobId returned from server');
			}

			// Start polling
			progressPollInterval = setInterval(pollProgress, 1000);
			await pollProgress();
			
		} catch (error) {
			generationError = error.message;
			if (progressPollInterval) {
				clearInterval(progressPollInterval);
				progressPollInterval = null;
			}
			isGenerating = false;
		}
	}
</script>

<div class="space-y-4">
	<div>
		<h2 class="text-lg font-bold">Sprite Animator</h2>
		<p class="text-xs text-gray-500">Upload → Animate → Remove BG</p>
	</div>

	<!-- Reference Image (Required) -->
	<div>
		<label class="block text-sm font-medium mb-2">Sprite Image *</label>
		{#if project.firstFrame}
			<div class="relative">
				<img src={project.firstFrame} alt="Reference" class="w-full h-32 object-contain rounded border-2 border-green-400 bg-gray-100" />
				<button 
					class="absolute top-1 right-1 bg-red-500 text-white text-xs px-2 py-1 rounded hover:bg-red-600"
					onclick={() => projectStore.update(p => ({ ...p, firstFrame: null }))}
				>✕</button>
			</div>
		{:else}
			<FrameUpload label="Upload your sprite" onUpload={handleFirstFrameUpload} />
		{/if}
	</div>

	<!-- Pose Preset -->
	<div>
		<label class="block text-sm font-medium mb-2">Animation Type</label>
		<select 
			bind:value={selectedPose}
			class="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white"
		>
			{#each posePresets as pose}
				<option value={pose.id}>{pose.name}</option>
			{/each}
		</select>
	</div>

	<!-- Custom prompt (only for custom pose) -->
	{#if selectedPose === 'custom'}
		<div>
			<label class="block text-xs font-medium mb-1">Describe the animation</label>
			<input
				type="text"
				bind:value={prompt}
				placeholder="e.g., 'spinning attack', 'celebration dance'"
				class="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg"
			/>
		</div>
	{/if}

	<!-- Duration -->
	<div>
		<label class="block text-sm font-medium mb-1">Duration: {duration}s</label>
		<input
			type="range"
			min="1"
			max="3"
			step="0.5"
			bind:value={duration}
			class="w-full"
		/>
		<div class="flex justify-between text-xs text-gray-500">
			<span>1s</span>
			<span>3s</span>
		</div>
	</div>

	<!-- Motion Intensity -->
	<div>
		<label class="block text-sm font-medium mb-1">
			Motion: {motionAmount < 80 ? 'Subtle' : motionAmount < 140 ? 'Medium' : 'Strong'}
		</label>
		<input
			type="range"
			min="50"
			max="180"
			bind:value={motionAmount}
			class="w-full"
		/>
	</div>

	<!-- Toggles -->
	<div class="flex flex-wrap gap-x-4 gap-y-1">
		<label class="flex items-center gap-1 text-sm">
			<input type="checkbox" bind:checked={shouldLoop} class="w-3.5 h-3.5" />
			Loop
		</label>
		<label class="flex items-center gap-1 text-sm text-gray-600">
			<input type="checkbox" bind:checked={removeBackground} class="w-3.5 h-3.5" />
			Remove BG
		</label>
	</div>

	<!-- Model Selection -->
	<div>
		<label class="block text-sm font-medium mb-1">Video Model</label>
		<div class="grid grid-cols-3 gap-1">
			{#each videoModels as model}
				<button
					type="button"
					class="p-1.5 text-xs border rounded text-center transition-colors {selectedModel === model.id ? 'border-blue-500 bg-blue-50 font-medium' : 'border-gray-300 hover:border-gray-400'}"
					onclick={() => selectedModel = model.id}
				>
					{model.name.split(' ')[0]}
				</button>
			{/each}
		</div>
	</div>

	<!-- Info -->
	<p class="text-xs text-gray-500">
		~{Math.round(duration * project.fps)} frames • {videoModels.find(m => m.id === selectedModel)?.quality}
	</p>

	<!-- Generate Button -->
	<button
		class="w-full px-3 py-2 text-sm bg-blue-500 text-white rounded hover:bg-blue-600 disabled:bg-gray-400 disabled:cursor-not-allowed"
		onclick={generateFrames}
		disabled={isGenerating}
	>
		{isGenerating ? 'Generating...' : 'Generate Frames'}
	</button>

	<!-- Progress Indicator -->
	{#if isGenerating && progress.status !== 'idle'}
		<div class="space-y-1">
			<div class="flex justify-between text-xs text-gray-600">
				<span>{progress.message || 'Processing...'}</span>
				<span>{progress.currentFrame} / {progress.totalFrames}</span>
			</div>
			<div class="w-full bg-gray-200 rounded-full h-2">
				<div
					class="bg-blue-500 h-2 rounded-full transition-all duration-300"
					style="width: {progress.totalFrames > 0 ? (progress.currentFrame / progress.totalFrames) * 100 : 0}%"
				></div>
			</div>
		</div>
	{/if}

	{#if generationError}
		<div class="p-2 text-xs bg-red-100 border border-red-400 text-red-700 rounded">
			{generationError}
		</div>
	{/if}
</div>

