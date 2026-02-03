<script>
	import { projectStore, updateFPS } from '$lib/stores/project.js';
	import { poseStore } from '$lib/stores/poses.js';
	import { jobQueue } from '$lib/stores/jobQueue.js';
	import { unsavedAnimations } from '$lib/stores/unsavedAnimations.js';
	import FrameUpload from './FrameUpload.svelte';
	import { extractFrames } from '$lib/utils/videoFrameExtractor.js';
	
	let project = $state({ frames: [], fps: 12, firstFrame: null, frameCount: 8 });
	let savedPoses = $state({ poses: [] });
	
	poseStore.subscribe(value => {
		savedPoses = value;
	});
	
	projectStore.subscribe(value => {
		project = value;
	});
	
	let prompt = $state('');
	let isGenerating = $state(false);
	let generationError = $state(null);
	let progress = $state({ currentFrame: 0, totalFrames: 0, status: 'idle', message: '' });
	let progressPollInterval = $state(null);
	let jobId = $state(null);
	let queueJobId = $state(null); // For job queue tracking
	
	// Animation settings - lower motion for 2D sprites
	let duration = $state(2); // seconds (1-3)
	let motionAmount = $state(50); // 1-255, lower = subtle motion for sprites
	let shouldLoop = $state(true); // Loop animation back to first frame
	let selectedPose = $state('idle'); // Pose preset
	
	// Production-ready sprite animation prompts
	// Optimized for 2D fantasy game sprites (HoMM3 style)
	const posePresets = [
		{ 
			id: 'idle', 
			name: 'Idle', 
			description: '2D fantasy game sprite, idle stance animation, subtle breathing motion, chest rises and falls naturally, gentle body sway, slight weight shift, natural standing pose, lifelike subtle movement, stationary feet, static camera, no background movement, looping animation, game asset quality'
		},
		{ 
			id: 'cast', 
			name: 'Cast Spell', 
			description: '2D fantasy game sprite, spellcasting animation, character leans forward with intensity, body tenses with power, arms raise dynamically channeling magic, facial expression shows concentration and determination, glowing magical energy around hands, mystical aura effect, body moves with casting motion, lifelike movement, static camera, contained effects, looping animation, game asset quality'
		},
		{ 
			id: 'attack', 
			name: 'Attack', 
			description: '2D fantasy game sprite, melee attack animation, body twists with power, weight shifts forward, weapon swing motion, striking pose, facial expression shows aggression, combat action, powerful dynamic movement, lifelike attack motion, static camera, single attack cycle, game asset quality'
		},
		{ 
			id: 'walk', 
			name: 'Walking', 
			description: '2D fantasy game sprite, walking cycle animation, side view facing right, smooth walking motion, legs alternate in natural stride, arms swing opposite to legs, body bobs gently up and down, weight shifts from foot to foot, consistent pace, smooth continuous movement, no jitter or spazzing, controlled motion, static camera, looping walk cycle, game asset quality'
		},
		{ 
			id: 'hit', 
			name: 'Take Damage', 
			description: '2D fantasy game sprite, damage reaction animation, body recoils dramatically, flinching motion, pain expression on face, body staggers backward, lifelike reaction, natural flinch response, static camera, quick recovery, game asset quality'
		},
		{ 
			id: 'death', 
			name: 'Death', 
			description: '2D fantasy game sprite, death animation, character falls down dead, collapses to the floor, body hits ground, lies motionless on ground, defeated pose lying flat, static camera, game asset quality'
		},
		{ 
			id: 'custom', 
			name: 'Custom', 
			description: '' 
		}
	];
	
	// Available video models - sorted by cost (cheapest first)
	let selectedModel = $state('wan22');
	const videoModels = [
		{ id: 'wan22', name: 'Wan 2.2 Fast', speed: '15-30s', quality: '💰 Cheapest' },
		{ id: 'ltxv', name: 'LTX Video', speed: '10-20s', quality: 'Fast' },
		{ id: 'hailuo', name: 'Hailuo 2.3', speed: '20-40s', quality: 'Best quality' },
		{ id: 'live2d', name: 'Live2D', speed: '20-40s', quality: '2D focused' },
		{ id: 'svd', name: 'SVD', speed: '120s+', quality: '💸 Expensive' }
	];
	
	// Processing options
	let removeBackground = $state(false); // Disabled by default for faster testing

	function handleFirstFrameUpload(dataUrl) {
		projectStore.update(p => ({ ...p, firstFrame: dataUrl }));
	}
	
	function openPosePicker() {
		// Emit event to show poses in center and switch to poses view
		if (typeof window !== 'undefined') {
			window.dispatchEvent(new CustomEvent('startPosePicking'));
			window.dispatchEvent(new CustomEvent('switchToPoses'));
		}
	}

	async function pollProgress() {
		if (!jobId) return;
		
		try {
			const response = await fetch(`/api/generation-progress?jobId=${jobId}`);
			if (response.ok) {
				const data = await response.json();
				console.log('Progress update:', data);
				progress = data;
				
				// Update job queue
				if (queueJobId) {
					jobQueue.updateJob(queueJobId, {
						progress: data.totalFrames > 0 ? Math.round((data.currentFrame / data.totalFrames) * 100) : 0,
						message: data.message || `Frame ${data.currentFrame}/${data.totalFrames}`
					});
				}
				
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
					
					// Step 3: Remove backgrounds (if enabled) - PARALLEL PROCESSING
					let finalFrames = rawFrames;
					
					if (removeBackground) {
						const totalFrames = rawFrames.length;
						progress = { ...progress, message: `Removing backgrounds (0/${totalFrames})...` };
						
						// Process in parallel batches for speed
						const batchSize = 5; // Process 5 frames at a time
						const transparentFrames = new Array(totalFrames);
						
						for (let batchStart = 0; batchStart < totalFrames; batchStart += batchSize) {
							const batchEnd = Math.min(batchStart + batchSize, totalFrames);
							const batch = rawFrames.slice(batchStart, batchEnd);
							
							progress = { ...progress, message: `Removing BG (${batchEnd}/${totalFrames})...` };
							
							// Process batch in parallel
							const batchPromises = batch.map((frame, batchIndex) => {
								const frameIndex = batchStart + batchIndex;
								return fetch('/api/remove-background', {
									method: 'POST',
									headers: { 'Content-Type': 'application/json' },
									body: JSON.stringify({ images: [frame] })
								})
								.then(response => {
									if (response.ok) {
										return response.json().then(result => ({
											index: frameIndex,
											image: result.images && result.images[0] ? result.images[0] : frame
										}));
									}
									return { index: frameIndex, image: frame };
								})
								.catch(error => {
									console.error(`BG removal failed for frame ${frameIndex}:`, error);
									return { index: frameIndex, image: frame };
								});
							});
							
							const batchResults = await Promise.all(batchPromises);
							batchResults.forEach(result => {
								transparentFrames[result.index] = result.image;
							});
						}
						
						finalFrames = transparentFrames;
					}
						
					// Add to unsaved animations buffer instead of directly to project
					const poseName = posePresets.find(p => p.id === selectedPose)?.name || selectedPose;
					unsavedAnimations.addAnimation({
						name: poseName,
						frames: finalFrames,
						pose: selectedPose,
						duration: duration,
						fps: project.fps,
						jobId: queueJobId
					});
					
					// Also update the project to show the latest one
					projectStore.update(p => ({
						...p,
						frames: finalFrames,
						prompt: selectedPose
					}));
					progress = { ...progress, status: 'completed', message: `Done! ${finalFrames.length} frames ready.` };
					
					// Mark job as complete
					if (queueJobId) {
						jobQueue.completeJob(queueJobId, { frameCount: finalFrames.length });
					}
						
					} catch (extractError) {
						console.error('Frame processing failed:', extractError);
						generationError = 'Failed to process frames: ' + extractError.message;
						
						// Mark job as failed
						if (queueJobId) {
							jobQueue.failJob(queueJobId, extractError.message);
						}
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

		// Add job to queue
		const poseName = posePresets.find(p => p.id === selectedPose)?.name || selectedPose;
		queueJobId = jobQueue.addJob({
			type: '🎬 Animation',
			name: poseName,
			status: 'processing',
			message: `Starting ${duration}s animation...`
		});

		// Clear existing frames
		projectStore.update(p => ({ ...p, frames: [] }));

		try {
			// Calculate frame count from duration and FPS
			const frameCount = Math.round(duration * project.fps);
			
			// Build prompt from pose preset
			let posePrompt;
			if (selectedPose === 'custom') {
				// For custom prompts, add context if it mentions walking
				const lowerPrompt = prompt.toLowerCase();
				if (lowerPrompt.includes('walk') || lowerPrompt.includes('stride') || lowerPrompt.includes('step')) {
					// Enhance walking prompts with specific instructions
					posePrompt = `2D fantasy game sprite, side view facing right, ${prompt}, smooth walking cycle, legs alternate in natural stride, arms swing opposite to legs, body bobs gently, weight shifts from foot to foot, consistent pace, smooth continuous movement, no jitter, no spazzing, controlled motion, static camera, looping animation, game asset quality`;
				} else {
					// General custom prompt with sprite context
					posePrompt = `2D fantasy game sprite, side view facing right, ${prompt}, smooth motion, consistent character, no jitter, static camera, looping animation, game asset quality`;
				}
			} else {
				posePrompt = posePresets.find(p => p.id === selectedPose)?.description || selectedPose;
			}
			
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
			// Mark job as failed
			if (queueJobId) {
				jobQueue.failJob(queueJobId, error.message);
			}
			isGenerating = false;
		}
	}
</script>

<div class="space-y-2">
	<!-- Sprite Preview -->
	{#if project.firstFrame}
		<div class="relative w-3/4 mx-auto">
			<img src={project.firstFrame} alt="Sprite" class="w-full aspect-square object-contain rounded-lg border-2 border-blue-400 bg-gray-100" />
			<button 
				class="absolute top-1 right-1 bg-red-500 text-white text-xs w-5 h-5 rounded-full hover:bg-red-600 flex items-center justify-center"
				onclick={() => projectStore.update(p => ({ ...p, firstFrame: null }))}
			>×</button>
		</div>
	{:else}
		<div class="w-3/4 mx-auto aspect-square">
			<FrameUpload label="Upload Sprite" onUpload={handleFirstFrameUpload} />
		</div>
		{#if savedPoses.poses.length > 0}
			<button 
				class="w-full px-2 py-1.5 text-xs bg-purple-100 text-purple-700 border border-purple-300 rounded hover:bg-purple-200"
				onclick={openPosePicker}
			>
				🎭 Use Saved Pose ({savedPoses.poses.length})
			</button>
		{/if}
	{/if}

	<!-- Animation Type -->
	<div class="flex items-center gap-2">
		<span class="text-xs font-medium text-gray-700">Type:</span>
		<select 
			bind:value={selectedPose}
			class="flex-1 px-2 py-1 text-xs border border-gray-300 rounded bg-white"
		>
			{#each posePresets as pose}
				<option value={pose.id}>{pose.name}</option>
			{/each}
		</select>
	</div>

	<!-- Custom prompt (only for custom) -->
	{#if selectedPose === 'custom'}
		<input
			type="text"
			bind:value={prompt}
			placeholder="Describe animation..."
			class="w-full px-2 py-1 text-xs border border-gray-300 rounded"
		/>
	{/if}

	<!-- Settings Row -->
	<div class="flex items-center gap-2 text-xs">
		<div class="flex-1">
			<span class="text-gray-600">{duration}s</span>
			<input type="range" min="1" max="5" step="0.5" bind:value={duration} class="w-full h-1" />
		</div>
		<div class="flex-1">
			<span class="text-gray-600">{motionAmount < 80 ? 'Low' : motionAmount < 140 ? 'Med' : 'High'}</span>
			<input type="range" min="50" max="180" bind:value={motionAmount} class="w-full h-1" />
		</div>
	</div>

	<!-- Options Row -->
	<div class="flex items-center gap-3 text-xs">
		<label class="flex items-center gap-1">
			<input type="checkbox" bind:checked={shouldLoop} class="w-3 h-3" />
			Loop
		</label>
		<label class="flex items-center gap-1 text-gray-600">
			<input type="checkbox" bind:checked={removeBackground} class="w-3 h-3" />
			Remove BG
		</label>
		<span class="ml-auto text-gray-400">~{Math.round(duration * project.fps)}f</span>
	</div>

	<!-- Model Selection - Compact -->
	<div class="flex flex-wrap gap-1">
		{#each videoModels.slice(0, 5) as model}
			<button
				type="button"
				class="px-2 py-0.5 text-[10px] border rounded transition-colors {selectedModel === model.id ? 'border-blue-500 bg-blue-50 font-medium' : 'border-gray-300 hover:border-gray-400'}"
				onclick={() => selectedModel = model.id}
				title={model.quality}
			>
				{model.id === 'wan22' ? '💰Wan' : model.id === 'ltxv' ? 'LTX' : model.id === 'hailuo' ? 'Hailuo' : model.id === 'live2d' ? 'Live2D' : model.id === 'svd' ? 'SVD💸' : model.name}
			</button>
		{/each}
	</div>

	<!-- Generate Button -->
	<button
		class="w-full px-3 py-2 text-sm bg-blue-500 text-white rounded hover:bg-blue-600 disabled:bg-gray-400 disabled:cursor-not-allowed font-medium"
		onclick={generateFrames}
		disabled={isGenerating || !project.firstFrame}
	>
		{isGenerating ? 'Generating...' : 'Generate Animation'}
	</button>

	<!-- Progress / Error -->
	{#if isGenerating && progress.status !== 'idle'}
		<div class="text-xs">
			<div class="flex justify-between text-gray-600 mb-1">
				<span>{progress.message || 'Processing...'}</span>
			</div>
			<div class="w-full bg-gray-200 rounded-full h-1.5">
				<div class="bg-blue-500 h-1.5 rounded-full transition-all" style="width: {progress.totalFrames > 0 ? (progress.currentFrame / progress.totalFrames) * 100 : 10}%"></div>
			</div>
		</div>
	{/if}

	{#if generationError}
		<p class="text-xs text-red-600 bg-red-50 px-2 py-1 rounded">{generationError}</p>
	{/if}
</div>

