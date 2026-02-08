<script>
	import { projectStore, updateFPS } from '$lib/stores/project.js';
	import { poseStore } from '$lib/stores/poses.js';
	import { jobQueue } from '$lib/stores/jobQueue.js';
	import { completedJobs } from '$lib/stores/completedJobs.js';
	import FrameUpload from './FrameUpload.svelte';
	import { extractFrames } from '$lib/utils/videoFrameExtractor.js';
	import { pixelateFrames } from '$lib/utils/pixelate.js';
	
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
	let duration = $state(5); // seconds (2-10, Wan 2.2 max ~121 frames)
	let motionAmount = $state(50); // 1-255, lower = subtle motion for sprites
	let shouldLoop = $state(false); // Loop animation back to first frame
	let selectedPose = $state('idle'); // Pose preset
	
	// Advanced settings for better accuracy and loops
	let showAdvanced = $state(false);
	let guidanceScale = $state(null); // null = use model default (typically 7.5)
	let seed = $state(null); // null = random seed
	let negativePrompt = $state(''); // Additional negative prompt

	// FLF-specific settings (for interpolation mode) — quality-focused defaults
	let flfDurationSeconds = $state(3);     // 0.5–10, default 3 (shorter = better per-frame quality)
	let flfInferenceSteps = $state(20);     // 1–30, default 20 (more steps = cleaner output)
	let flfGuidanceScale = $state(3);       // 0–10, high noise guidance, default 3
	let flfGuidanceScale2 = $state(3);      // 0–10, low noise guidance, default 3
	let flfShift = $state(5);               // 1–10, scheduler shift, default 5
	let flfSeed = $state(null);             // null = random
	let flfNegativePrompt = $state('');     // user additions to default Chinese neg prompt
	
	// Interpolation mode (start → end frame)
	let useInterpolation = $state(false);
	let endFrame = $state(null);
	
	function handleEndFrameUpload(dataUrl) {
		endFrame = dataUrl;
		projectStore.update(p => ({ ...p, lastFrame: dataUrl }));
	}
	
	function clearEndFrame() {
		endFrame = null;
		projectStore.update(p => ({ ...p, lastFrame: null }));
		useInterpolation = false; // Disable interpolation when end frame is cleared
	}
	
	// Sync endFrame with projectStore.lastFrame so file tree selection works
	$effect(() => {
		if (project.lastFrame && project.lastFrame !== endFrame) {
			endFrame = project.lastFrame;
			useInterpolation = true; // Auto-enable interpolation when end frame is set from file tree
		}
	});
	
	// HoMM3 pixel art style animation prompts
	// CRITICAL: Maintain pixel art style, no smoothing, preserve crisp pixels
	const HOMM3_STYLE = 'Heroes of Might and Magic 3 pixel art style, high quality pixelated sprite, crisp pixels, no smoothing, no anti-aliasing blur, maintain pixel art aesthetic, transparent background, isolated character';
	
	const posePresets = [
		{ 
			id: 'idle', 
			name: 'Idle', 
			description: `${HOMM3_STYLE}, idle breathing animation, subtle chest movement, gentle sway, stationary feet, looping`
		},
		{ 
			id: 'cast', 
			name: 'Cast Spell', 
			description: `${HOMM3_STYLE}, spellcasting animation, arms raise channeling magic, glowing energy effect, mystical aura, looping`
		},
		{ 
			id: 'attack', 
			name: 'Attack', 
			description: `${HOMM3_STYLE}, attack swing animation, weapon strike motion, powerful movement, single attack cycle`
		},
		{ 
			id: 'walk', 
			name: 'Walking', 
			description: `${HOMM3_STYLE}, walking cycle, side view facing right, legs alternate stride, smooth looping walk`
		},
		{ 
			id: 'hit', 
			name: 'Take Damage', 
			description: `${HOMM3_STYLE}, damage reaction, body recoils, flinch motion, quick recovery`
		},
		{ 
			id: 'death', 
			name: 'Death', 
			description: `${HOMM3_STYLE}, death animation, character falls and collapses, lies motionless`
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
	let pixelateOutput = $state(true); // Force pixel art look
	let pixelSize = $state(2); // Size of each "pixel" (2-8)
	let colorLevels = $state(64); // Color levels (8, 16, 32)

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
						if (queueJobId) {
							jobQueue.updateJob(queueJobId, { message: 'Extracting frames from video...' });
						}
						
						console.log('Starting frame extraction from:', data.videoUrl);
						const extractDuration = useInterpolation ? flfDurationSeconds : duration;
						let rawFrames = await extractFrames(data.videoUrl, Math.round(extractDuration * project.fps));
						console.log(`Extracted ${rawFrames.length} frames`);
						
						if (!rawFrames || rawFrames.length === 0) {
							throw new Error('No frames extracted from video');
						}
						
					// Step 2: If loop enabled, create ping-pong loop
					if (shouldLoop && rawFrames.length > 2) {
						progress = { ...progress, message: 'Creating seamless loop...' };
						if (queueJobId) {
							jobQueue.updateJob(queueJobId, { message: 'Creating seamless loop...' });
						}
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
					
					// Step 4: Pixelate frames (if enabled) - force pixel art look
					if (pixelateOutput && finalFrames.length > 0) {
						const totalFrames = finalFrames.length;
						progress = { ...progress, message: `Pixelating frames (0/${totalFrames})...` };
						
						if (queueJobId) {
							jobQueue.updateJob(queueJobId, { message: `Pixelating frames...` });
						}
						
						finalFrames = await pixelateFrames(finalFrames, pixelSize, colorLevels, (done, total) => {
							progress = { ...progress, message: `Pixelating frames (${done}/${total})...` };
						});
						
						console.log(`Pixelated ${finalFrames.length} frames with pixel size ${pixelSize}, ${colorLevels} colors`);
					}
						
					// Add to completed jobs for user to review
					const poseName = posePresets.find(p => p.id === selectedPose)?.name || selectedPose;
					console.log(`Adding animation to completed jobs: ${poseName} with ${finalFrames.length} frames`);
					
					await completedJobs.addAnimation({
						name: poseName,
						frames: finalFrames,
						pose: selectedPose,
						fps: project.fps
					});
					
					// AUTO-SAVE: Add frames directly to the project
					projectStore.update(p => ({
						...p,
						frames: finalFrames,
						prompt: poseName
					}));
					console.log(`Auto-saved ${finalFrames.length} frames to project`);
					
					progress = { ...progress, status: 'completed', message: `Done! ${finalFrames.length} frames ready.` };
					
					// Mark job as complete
					if (queueJobId) {
						jobQueue.completeJob(queueJobId, { frameCount: finalFrames.length });
					}
						
					} catch (extractError) {
						console.error('Frame processing failed:', extractError);
						const errorMsg = extractError.message || 'Unknown extraction error';
						generationError = 'Failed to process frames: ' + errorMsg;
						progress = { ...progress, status: 'error', message: errorMsg };
						
						// Still add to completed jobs with the video URL so user can see something
						const poseName = posePresets.find(p => p.id === selectedPose)?.name || selectedPose;
						await completedJobs.addAnimation({
							name: `${poseName} (video only)`,
							frames: [], // Empty frames
							videoUrl: data.videoUrl, // Store the video URL
							pose: selectedPose,
							fps: project.fps,
							error: errorMsg
						});
						
						// Mark job as failed but still accessible
						if (queueJobId) {
							jobQueue.failJob(queueJobId, `Extraction failed - video saved`);
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
		
		if (useInterpolation && !endFrame) {
			generationError = 'End frame is required for interpolation mode. Upload an end frame.';
			return;
		}

		isGenerating = true;
		generationError = null;
		// When interpolating, use FLF duration (not the general slider) so frame extraction matches
		const effectiveDuration = useInterpolation ? flfDurationSeconds : duration;
		const totalFrameCount = Math.round(effectiveDuration * project.fps);
		progress = { currentFrame: 0, totalFrames: totalFrameCount, status: 'starting', message: `Starting ${effectiveDuration}s animation...` };
		jobId = null;

		// Add job to queue
		const poseName = posePresets.find(p => p.id === selectedPose)?.name || selectedPose;
		queueJobId = jobQueue.addJob({
			type: '🎬 Animation',
			name: poseName,
			status: 'processing',
			message: `Starting ${effectiveDuration}s animation...`
		});

		// Clear existing frames
		projectStore.update(p => ({ ...p, frames: [] }));

		try {
			// Calculate frame count from effective duration and FPS
			const requestedFrameCount = Math.round(effectiveDuration * project.fps);
			
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
					endImage: useInterpolation ? endFrame : null,
					prompt: posePrompt,
					pose: selectedPose,
					frameCount: requestedFrameCount,
					duration: duration,
					motionAmount: motionAmount,
					fps: project.fps,
					loop: shouldLoop,
					model: selectedModel,
					interpolate: useInterpolation,
					// Standard advanced settings (non-FLF models)
					guidanceScale: guidanceScale,
					seed: seed,
					negativePrompt: negativePrompt,
					// FLF-specific parameters (interpolation mode only)
					...(useInterpolation && {
						flfDurationSeconds: flfDurationSeconds,
						flfInferenceSteps: flfInferenceSteps,
						flfGuidanceScale: flfGuidanceScale,
						flfGuidanceScale2: flfGuidanceScale2,
						flfShift: flfShift,
						flfSeed: flfSeed,
						flfNegativePrompt: flfNegativePrompt
					})
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
	<!-- Interpolation checkbox -->
	<label class="flex items-center gap-2 text-xs">
		<input type="checkbox" bind:checked={useInterpolation} class="w-3 h-3" />
		<span class="text-gray-700">Start → End interpolation</span>
		{#if useInterpolation}
			<span class="text-gray-400 text-[10px]">(morph between two frames)</span>
		{/if}
	</label>

	<!-- Sprite Preview(s) -->
	<div class="flex gap-2 {useInterpolation ? '' : 'justify-center'}">
		<!-- Start Frame -->
		<div class="{useInterpolation ? 'flex-1' : 'w-3/4'}">
			{#if useInterpolation}
				<p class="text-[10px] text-gray-500 text-center mb-1">Start Frame</p>
			{/if}
			{#if project.firstFrame}
				<div class="relative">
					<img src={project.firstFrame} alt="Start" class="w-full aspect-square object-contain rounded-lg border-2 border-blue-400 bg-gray-100" />
					<button 
						class="absolute top-1 right-1 bg-red-500 text-white text-xs w-5 h-5 rounded-full hover:bg-red-600 flex items-center justify-center"
						onclick={() => projectStore.update(p => ({ ...p, firstFrame: null }))}
					>×</button>
				</div>
			{:else}
				<div class="aspect-square">
					<FrameUpload label={useInterpolation ? "Start" : "Upload Sprite"} onUpload={handleFirstFrameUpload} />
				</div>
			{/if}
		</div>
		
		<!-- End Frame (only when interpolation enabled) -->
		{#if useInterpolation}
			<div class="flex-1">
				<p class="text-[10px] text-gray-500 text-center mb-1">End Frame</p>
				{#if endFrame}
					<div class="relative">
						<img src={endFrame} alt="End" class="w-full aspect-square object-contain rounded-lg border-2 border-green-400 bg-gray-100" />
						<button 
							class="absolute top-1 right-1 bg-red-500 text-white text-xs w-5 h-5 rounded-full hover:bg-red-600 flex items-center justify-center"
							onclick={clearEndFrame}
						>×</button>
					</div>
				{:else}
					<div class="aspect-square">
						<FrameUpload label="End" onUpload={handleEndFrameUpload} />
					</div>
				{/if}
			</div>
		{/if}
	</div>
	
	<!-- Use Saved Pose button (only when no first frame) -->
	{#if !project.firstFrame && savedPoses.poses.length > 0}
		<button 
			class="w-full px-2 py-1.5 text-xs bg-purple-100 text-purple-700 border border-purple-300 rounded hover:bg-purple-200"
			onclick={openPosePicker}
		>
			🎭 Use Saved Pose ({savedPoses.poses.length})
		</button>
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
		{#if useInterpolation}
			<!-- FLF mode: duration is controlled by flfDurationSeconds in Advanced Settings -->
			<div class="flex-1">
				<span class="text-gray-600">{flfDurationSeconds}s</span>
				<input type="range" min="1" max="10" step="0.5" bind:value={flfDurationSeconds} class="w-full h-1" />
			</div>
		{:else}
			<div class="flex-1">
				<span class="text-gray-600">{duration}s</span>
				<input type="range" min="2" max="10" step="1" bind:value={duration} class="w-full h-1" />
			</div>
		{/if}
		<div class="w-16">
			<span class="text-gray-600">{project.fps}fps</span>
			<select 
				value={project.fps} 
				onchange={(e) => updateFPS(Number(e.target.value))}
				class="w-full text-[10px] border rounded px-1"
			>
				<option value={6}>6 fps (long)</option>
				<option value={8}>8 fps</option>
				<option value={12}>12 fps</option>
			</select>
		</div>
		{#if !useInterpolation}
			<div class="flex-1">
				<span class="text-gray-600">{motionAmount < 80 ? 'Low' : motionAmount < 140 ? 'Med' : 'High'}</span>
				<input type="range" min="50" max="180" bind:value={motionAmount} class="w-full h-1" />
			</div>
		{:else}
			<div class="flex-1">
				<span class="text-gray-600">{flfInferenceSteps} steps</span>
				<input type="range" min="1" max="30" step="1" bind:value={flfInferenceSteps} class="w-full h-1" />
			</div>
		{/if}
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
		<label class="flex items-center gap-1 text-gray-600" title="Force pixel art look">
			<input type="checkbox" bind:checked={pixelateOutput} class="w-3 h-3" />
			Pixelate
		</label>
		<span class="ml-auto text-gray-400">~{Math.round((useInterpolation ? flfDurationSeconds : duration) * project.fps)}f</span>
	</div>
	
	<!-- Pixelation Settings (when enabled) -->
	{#if pixelateOutput}
		<div class="flex items-center gap-3 text-[10px] bg-amber-50 border border-amber-200 rounded p-2">
			<span class="text-amber-700 font-medium">Pixel Art:</span>
			<label class="flex items-center gap-1">
				<span class="text-gray-600">Size:</span>
				<select bind:value={pixelSize} class="px-1 py-0.5 border rounded text-[10px]">
					<option value={2}>2px (fine)</option>
					<option value={4}>4px</option>
					<option value={6}>6px</option>
					<option value={8}>8px (chunky)</option>
				</select>
			</label>
			<label class="flex items-center gap-1">
				<span class="text-gray-600">Colors:</span>
				<select bind:value={colorLevels} class="px-1 py-0.5 border rounded text-[10px]">
					<option value={8}>8 (retro)</option>
					<option value={16}>16</option>
					<option value={32}>32</option>
					<option value={64}>64 (smooth)</option>
				</select>
			</label>
		</div>
	{/if}

	<!-- Model Selection - Compact (disabled during interpolation) -->
	<div class="flex flex-wrap gap-1">
		{#each videoModels as model}
			<button
				type="button"
				class="px-2 py-0.5 text-[10px] border rounded transition-colors 
					{useInterpolation ? 'opacity-40 cursor-not-allowed border-gray-200' : selectedModel === model.id ? 'border-blue-500 bg-blue-50 font-medium' : 'border-gray-300 hover:border-gray-400'}"
				onclick={() => { if (!useInterpolation) selectedModel = model.id; }}
				title={useInterpolation ? 'Interpolation uses Replicate WAN 2.2 FLF' : model.quality}
				disabled={useInterpolation}
			>
				{model.id === 'wan22' ? '💰Wan' : model.id === 'ltxv' ? 'LTX' : model.id === 'hailuo' ? 'Hailuo' : model.id === 'live2d' ? 'Live2D' : model.id === 'svd' ? 'SVD💸' : model.name}
			</button>
		{/each}
	</div>

	<!-- Advanced Settings Toggle -->
	<button
		class="w-full px-2 py-1 text-xs text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded border border-gray-300 transition-colors"
		onclick={() => showAdvanced = !showAdvanced}
	>
		{showAdvanced ? '▼' : '▶'} Advanced Settings {showAdvanced ? '(Hide)' : '(Show)'}
	</button>

	<!-- Advanced Settings Panel -->
	{#if showAdvanced}
		<div class="space-y-2 p-2 bg-gray-50 border border-gray-200 rounded text-xs">
			
			{#if useInterpolation}
				<!-- ═══ FLF-SPECIFIC SETTINGS (Interpolation Mode) ═══ -->
				<p class="text-[10px] text-indigo-600 font-medium mb-1">⚡ WAN 2.2 First-Last-Frame Settings</p>

				<!-- Duration -->
				<div>
					<label class="block text-[10px] text-gray-600 mb-1">
						Duration: <strong>{flfDurationSeconds}s</strong>
						<span class="text-gray-400">(0.5–10s, longer = more frames)</span>
					</label>
					<input type="range" min="0.5" max="10" step="0.5" bind:value={flfDurationSeconds} class="w-full h-1" />
				</div>

				<!-- Inference Steps -->
				<div>
					<label class="block text-[10px] text-gray-600 mb-1">
						Inference Steps: <strong>{flfInferenceSteps}</strong>
						<span class="text-gray-400">(1–30, higher = better quality, slower)</span>
					</label>
					<input type="range" min="1" max="30" step="1" bind:value={flfInferenceSteps} class="w-full h-1" />
				</div>

				<!-- Guidance Scales (dual) -->
				<div class="grid grid-cols-2 gap-2">
					<div>
						<label class="block text-[10px] text-gray-600 mb-1">
							Guidance (High Noise): <strong>{flfGuidanceScale}</strong>
						</label>
						<input type="range" min="0" max="10" step="0.5" bind:value={flfGuidanceScale} class="w-full h-1" />
					</div>
					<div>
						<label class="block text-[10px] text-gray-600 mb-1">
							Guidance (Low Noise): <strong>{flfGuidanceScale2}</strong>
						</label>
						<input type="range" min="0" max="10" step="0.5" bind:value={flfGuidanceScale2} class="w-full h-1" />
					</div>
				</div>
				<p class="text-[9px] text-gray-400 -mt-1">Higher guidance = stricter adherence to prompt at each noise stage</p>

				<!-- Shift (Scheduler) -->
				<div>
					<label class="block text-[10px] text-gray-600 mb-1">
						Scheduler Shift: <strong>{flfShift}</strong>
						<span class="text-gray-400">(1–10, controls noise schedule)</span>
					</label>
					<input type="range" min="1" max="10" step="0.5" bind:value={flfShift} class="w-full h-1" />
				</div>

				<!-- Seed -->
				<div>
					<label class="block text-[10px] text-gray-600 mb-1">
						Seed: {flfSeed ?? 'Random'}
					</label>
					<div class="flex items-center gap-2">
						<input type="number" bind:value={flfSeed} placeholder="Random" class="flex-1 px-2 py-1 text-xs border rounded" />
						<button class="px-2 py-0.5 text-[10px] bg-gray-200 rounded hover:bg-gray-300" onclick={() => flfSeed = null}>Random</button>
					</div>
				</div>

				<!-- FLF Negative Prompt -->
				<div>
					<label class="block text-[10px] text-gray-600 mb-1">
						Extra Negative Prompt <span class="text-gray-400">(added to model's default negatives)</span>
					</label>
					<textarea
						bind:value={flfNegativePrompt}
						placeholder="e.g., jittery, static, extra limbs..."
						class="w-full px-2 py-1 text-xs border rounded resize-none"
						rows="2"
					></textarea>
				</div>

				<!-- Reset FLF to Defaults -->
				<button
					class="w-full px-2 py-1 text-[10px] bg-gray-200 text-gray-600 rounded hover:bg-gray-300"
					onclick={() => { flfDurationSeconds = 3; flfInferenceSteps = 20; flfGuidanceScale = 3; flfGuidanceScale2 = 3; flfShift = 5; flfSeed = null; flfNegativePrompt = ''; }}
				>
					↺ Reset FLF to Defaults
				</button>

				<!-- Quality Presets -->
				<div class="flex gap-1 flex-wrap">
					<span class="text-[10px] text-gray-500 mr-1">Presets:</span>
					<button
						class="px-2 py-0.5 text-[10px] bg-green-100 text-green-700 rounded hover:bg-green-200"
						onclick={() => { flfDurationSeconds = 2; flfInferenceSteps = 10; flfGuidanceScale = 2; flfGuidanceScale2 = 2; flfShift = 5; }}
						title="Quick generation, fewer frames"
					>⚡ Fast</button>
					<button
						class="px-2 py-0.5 text-[10px] bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
						onclick={() => { flfDurationSeconds = 3; flfInferenceSteps = 20; flfGuidanceScale = 3; flfGuidanceScale2 = 3; flfShift = 5; }}
						title="Default quality — good balance"
					>⚖️ Balanced</button>
					<button
						class="px-2 py-0.5 text-[10px] bg-purple-100 text-purple-700 rounded hover:bg-purple-200"
						onclick={() => { flfDurationSeconds = 5; flfInferenceSteps = 30; flfGuidanceScale = 5; flfGuidanceScale2 = 5; flfShift = 5; }}
						title="Best quality, slower & more frames"
					>💎 Quality</button>
				</div>

			{:else}
				<!-- ═══ STANDARD I2V SETTINGS ═══ -->
				<p class="text-[10px] text-gray-500 font-medium mb-2">Fine-tune generation for better accuracy and loops</p>
				
				<!-- Guidance Scale -->
				<div>
					<label class="block text-[10px] text-gray-600 mb-1">
						Guidance Scale: {guidanceScale || 'Auto (7.5)'}
						<span class="text-gray-400">(Higher = more prompt adherence, 3-15)</span>
					</label>
					<div class="flex items-center gap-2">
						<input 
							type="range" 
							min="3" 
							max="15" 
							step="0.5" 
							bind:value={guidanceScale}
							class="flex-1 h-1"
						/>
						<button
							class="px-2 py-0.5 text-[10px] bg-gray-200 rounded hover:bg-gray-300"
							onclick={() => guidanceScale = null}
							title="Reset to model default"
						>
							Reset
						</button>
					</div>
				</div>

				<!-- Seed -->
				<div>
					<label class="block text-[10px] text-gray-600 mb-1">
						Seed: {seed || 'Random'}
						<span class="text-gray-400">(Same seed = reproducible results)</span>
					</label>
					<div class="flex items-center gap-2">
						<input
							type="number"
							bind:value={seed}
							placeholder="Random"
							class="flex-1 px-2 py-1 text-xs border rounded"
						/>
						<button
							class="px-2 py-0.5 text-[10px] bg-gray-200 rounded hover:bg-gray-300"
							onclick={() => seed = null}
							title="Use random seed"
						>
							Random
						</button>
					</div>
				</div>

				<!-- Negative Prompt -->
				<div>
					<label class="block text-[10px] text-gray-600 mb-1">
						Negative Prompt
						<span class="text-gray-400">(Things to avoid - added to default negatives)</span>
					</label>
					<textarea
						bind:value={negativePrompt}
						placeholder="e.g., jittery, flickering, color shift..."
						class="w-full px-2 py-1 text-xs border rounded resize-none"
						rows="2"
					></textarea>
					<p class="text-[9px] text-gray-400 mt-0.5">
						Default negatives: blurry, distorted, inconsistent, flickering, jittery, pixelated artifacts
					</p>
				</div>

				<!-- Loop Tips -->
				{#if shouldLoop}
					<div class="p-2 bg-blue-50 border border-blue-200 rounded">
						<p class="text-[10px] text-blue-800 font-medium mb-1">💡 Loop Tips:</p>
						<ul class="text-[9px] text-blue-700 space-y-0.5 list-disc list-inside">
							<li>Lower motion amount (30-60) for smoother loops</li>
							<li>Use seed for reproducible loop attempts</li>
							<li>Higher guidance (8-12) helps maintain consistency</li>
							<li>Ping-pong loop button creates seamless back-and-forth</li>
						</ul>
					</div>
				{/if}
			{/if}
		</div>
	{/if}

	<!-- Generate Button -->
	{#if useInterpolation}
		<div class="text-[10px] text-indigo-600 bg-indigo-50 px-2 py-1.5 rounded space-y-0.5">
			<p>⚡ <strong>Replicate WAN 2.2 FLF</strong> — {flfDurationSeconds}s, {flfInferenceSteps} steps, guidance {flfGuidanceScale}/{flfGuidanceScale2}, shift {flfShift}</p>
			<p class="text-indigo-400">Open Advanced Settings to fine-tune all parameters</p>
		</div>
	{/if}
	<button
		class="w-full px-3 py-2 text-sm text-white rounded disabled:bg-gray-400 disabled:cursor-not-allowed font-medium {useInterpolation ? 'bg-indigo-500 hover:bg-indigo-600' : 'bg-blue-500 hover:bg-blue-600'}"
		onclick={generateFrames}
		disabled={isGenerating || !project.firstFrame || (useInterpolation && !endFrame)}
	>
		{isGenerating ? 'Generating...' : useInterpolation ? 'Interpolate Frames' : 'Generate Animation'}
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

