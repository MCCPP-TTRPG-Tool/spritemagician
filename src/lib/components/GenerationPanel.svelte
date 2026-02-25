<script>
	import { browser } from '$app/environment';
	import { projectStore, updateFPS } from '$lib/stores/project.js';
	import { poseStore } from '$lib/stores/poses.js';
	import { jobQueue } from '$lib/stores/jobQueue.js';
	import { completedJobs } from '$lib/stores/completedJobs.js';
	import FrameUpload from './FrameUpload.svelte';
	import { extractFrames } from '$lib/utils/videoFrameExtractor.js';
	import { pixelateFrames } from '$lib/utils/pixelate.js';
	import { cleanupBackgrounds } from '$lib/utils/backgroundCleanup.js';
	import { CHROMA_KEY_HEX, CHROMA_KEY_TOLERANCE } from '$lib/constants/chromaKey.js';
	
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
	const ANIMATE_STATE_KEY = 'spritemagician.animate.panel.v1';
	
	const MIN_TARGET_FRAMES = 12;
	const MAX_TARGET_FRAMES = 24;
	const MIN_MANUAL_FRAMES = 8;
	const MAX_MANUAL_FRAMES = 48;

	// Animation settings tuned for faster sprite iteration
	let duration = $state(2); // seconds (shorter by default for faster turnaround)
	let motionAmount = $state(50); // 1-255, lower = subtle motion for sprites
	let shouldLoop = $state(false); // Loop animation back to first frame
	let perfectLoop = $state(false); // Force end/start seam smoothing + exact closure
	let selectedPose = $state('idle'); // Pose preset
	
	// Advanced settings for better accuracy and loops
	let showAdvanced = $state(false);
	let guidanceScale = $state(null); // null = use model default (typically 7.5)
	let seed = $state(null); // null = random seed
	let negativePrompt = $state(''); // Additional negative prompt

	// FLF-specific settings (for interpolation mode) — quality-focused defaults
	// These MUST match the server-side defaults in generate-animation/+server.js
	// Source: lucataco/wan-2.2-first-last-frame model schema (Lightning LoRA)
	let flfDurationSeconds = $state(5);     // model default: 5
	let flfInferenceSteps = $state(8);      // model default: 8 (Lightning — low steps!)
	let flfGuidanceScale = $state(1);       // model default: 1 (distilled — low guidance!)
	let flfGuidanceScale2 = $state(1);      // model default: 1 (distilled — low guidance!)
	let flfShift = $state(8);               // model default: 8
	let flfSeed = $state(null);             // null = random
	let flfNegativePrompt = $state('');     // user additions to default Chinese neg prompt
	
	// Interpolation mode (start → end frame)
	let useInterpolation = $state(false);
	let endFrame = $state(null);
	let frameTargetMode = $state('auto'); // 'auto' | 'manual'
	let manualFrameCount = $state(16);
	
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
	const HOMM3_STYLE = `Heroes of Might and Magic 3 pixel art style, high quality pixelated sprite, crisp pixels, no smoothing, no anti-aliasing blur, maintain pixel art aesthetic, solid chroma key lime background (${CHROMA_KEY_HEX}), isolated character, reserve ${CHROMA_KEY_HEX} for background only and never on the subject`;
	
	const posePresets = [
		{ 
			id: 'idle', 
			name: 'Idle', 
			description: `${HOMM3_STYLE}, standing in place, feet do not move, focus on micro-movements, rhythmic chest expansion from breathing, slight weight redistribution in the hips, subtle tension in the neck muscles, mouth closed and static, no mouth movement, no talking, no jaw movement, character maintains exact same size throughout animation, no scaling, no zoom, consistent character scale, static background, volumetric lighting, 8k resolution, crisp textures, high-fidelity render.`
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
			description: `${HOMM3_STYLE}, cinematic game sprite, character in a staggered hit-reaction pose, body recoiling backwards from impact, torso arched slightly, head snapped back, eyes wide and gritted teeth, one arm raised defensively, feet planted but skidding slightly, subtle motion blur on limbs to indicate force, particles of impact sparks, character maintains exact same size throughout animation, no scaling, no zoom, consistent character scale, high fidelity, 8k resolution, maintain identical character features and clothing.`
		},
		{ 
			id: 'death', 
			name: 'Death', 
			description: `${HOMM3_STYLE}, character lying completely flat on the ground, horizontal orientation, body viewed from a high bird's-eye angle, limbs sprawled out across the floor, torso and head pressed against the surface, parallel to the ground plane, no vertical depth, weighted physics, defeated pose, gritty painterly texture, high contrast shadows cast directly underneath the body, sharp edges, character maintains exact same size throughout animation, no scaling, no zoom, consistent character scale, 8k resolution, high fidelity.`
		},
		{ 
			id: 'custom', 
			name: 'Custom', 
			description: '' 
		}
	];
	
	const ACTIVE_MODEL_ID = 'wan22';
	
	// Processing options
	let removeBackground = $state(false); // Disabled by default for faster testing
	let pixelateOutput = $state(false); // Disabled by default - only enable if you want pixelation effect
	let pixelSize = $state(2); // Size of each "pixel" (2-8)
	let colorLevels = $state(64); // Color levels (8, 16, 32)

	if (browser) {
		try {
			const raw = localStorage.getItem(ANIMATE_STATE_KEY);
			if (raw) {
				const parsed = JSON.parse(raw);
				if (typeof parsed?.prompt === 'string') prompt = parsed.prompt;
				if (typeof parsed?.duration === 'number') duration = parsed.duration;
				if (typeof parsed?.motionAmount === 'number') motionAmount = parsed.motionAmount;
				if (typeof parsed?.shouldLoop === 'boolean') shouldLoop = parsed.shouldLoop;
				if (typeof parsed?.perfectLoop === 'boolean') perfectLoop = parsed.perfectLoop;
				if (typeof parsed?.selectedPose === 'string') selectedPose = parsed.selectedPose;
				if (typeof parsed?.showAdvanced === 'boolean') showAdvanced = parsed.showAdvanced;
				if (parsed?.guidanceScale === null || typeof parsed?.guidanceScale === 'number') guidanceScale = parsed.guidanceScale;
				if (parsed?.seed === null || typeof parsed?.seed === 'number') seed = parsed.seed;
				if (typeof parsed?.negativePrompt === 'string') negativePrompt = parsed.negativePrompt;
				if (typeof parsed?.flfDurationSeconds === 'number') flfDurationSeconds = parsed.flfDurationSeconds;
				if (typeof parsed?.flfInferenceSteps === 'number') flfInferenceSteps = parsed.flfInferenceSteps;
				if (typeof parsed?.flfGuidanceScale === 'number') flfGuidanceScale = parsed.flfGuidanceScale;
				if (typeof parsed?.flfGuidanceScale2 === 'number') flfGuidanceScale2 = parsed.flfGuidanceScale2;
				if (typeof parsed?.flfShift === 'number') flfShift = parsed.flfShift;
				if (parsed?.flfSeed === null || typeof parsed?.flfSeed === 'number') flfSeed = parsed.flfSeed;
				if (typeof parsed?.flfNegativePrompt === 'string') flfNegativePrompt = parsed.flfNegativePrompt;
				if (typeof parsed?.useInterpolation === 'boolean') useInterpolation = parsed.useInterpolation;
				if (parsed?.endFrame === null || typeof parsed?.endFrame === 'string') endFrame = parsed.endFrame;
				if (typeof parsed?.frameTargetMode === 'string') frameTargetMode = parsed.frameTargetMode;
				if (typeof parsed?.manualFrameCount === 'number') manualFrameCount = parsed.manualFrameCount;
				if (typeof parsed?.removeBackground === 'boolean') removeBackground = parsed.removeBackground;
				if (typeof parsed?.pixelateOutput === 'boolean') pixelateOutput = parsed.pixelateOutput;
				if (typeof parsed?.pixelSize === 'number') pixelSize = parsed.pixelSize;
				if (typeof parsed?.colorLevels === 'number') colorLevels = parsed.colorLevels;
			}
		} catch {
			// ignore storage parse errors
		}
	}

	function clampFrameBudget(rawCount) {
		const safe = Number.isFinite(rawCount) ? Math.round(rawCount) : MIN_TARGET_FRAMES;
		return Math.max(MIN_TARGET_FRAMES, Math.min(MAX_TARGET_FRAMES, safe));
	}

	function clampManualFrameCount(rawCount) {
		const safe = Number.isFinite(rawCount) ? Math.round(rawCount) : 16;
		return Math.max(MIN_MANUAL_FRAMES, Math.min(MAX_MANUAL_FRAMES, safe));
	}

	function loadImageDataUrl(dataUrl) {
		return new Promise((resolve, reject) => {
			const img = new Image();
			img.onload = () => resolve(img);
			img.onerror = () => reject(new Error('Failed to load frame for perfect loop'));
			img.src = dataUrl;
		});
	}

	async function blendFrameDataUrls(baseDataUrl, targetDataUrl, alpha) {
		const [a, b] = await Promise.all([loadImageDataUrl(baseDataUrl), loadImageDataUrl(targetDataUrl)]);
		const width = a.naturalWidth || a.width;
		const height = a.naturalHeight || a.height;
		if (!width || !height) return baseDataUrl;

		const canvas = document.createElement('canvas');
		canvas.width = width;
		canvas.height = height;
		const ctx = canvas.getContext('2d');
		if (!ctx) return baseDataUrl;

		ctx.clearRect(0, 0, width, height);
		ctx.globalAlpha = 1;
		ctx.drawImage(a, 0, 0, width, height);
		ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
		ctx.drawImage(b, 0, 0, width, height);
		ctx.globalAlpha = 1;
		return canvas.toDataURL('image/png');
	}

	async function enforcePerfectLoop(frames) {
		if (!frames || frames.length < 4) return frames || [];
		const out = [...frames];
		const seamWindow = Math.min(4, Math.max(2, Math.floor(out.length / 6)));
		const startSlice = out.slice(0, seamWindow);
		for (let i = 0; i < seamWindow; i++) {
			const tailIndex = out.length - seamWindow + i;
			const alpha = (i + 1) / (seamWindow + 1);
			out[tailIndex] = await blendFrameDataUrls(out[tailIndex], startSlice[i], alpha);
		}
		// Hard-close the loop for guaranteed end->start continuity.
		out[out.length - 1] = out[0];
		return out;
	}

	$effect(() => {
		if (perfectLoop && !shouldLoop) {
			shouldLoop = true;
		}
	});

	$effect(() => {
		if (!browser) return;
		try {
			localStorage.setItem(
				ANIMATE_STATE_KEY,
				JSON.stringify({
					prompt,
					duration,
					motionAmount,
					shouldLoop,
					perfectLoop,
					selectedPose,
					showAdvanced,
					guidanceScale,
					seed,
					negativePrompt,
					flfDurationSeconds,
					flfInferenceSteps,
					flfGuidanceScale,
					flfGuidanceScale2,
					flfShift,
					flfSeed,
					flfNegativePrompt,
					useInterpolation,
					endFrame,
					frameTargetMode,
					manualFrameCount,
					removeBackground,
					pixelateOutput,
					pixelSize,
					colorLevels
				})
			);
		} catch {
			// ignore storage quota/private mode errors
		}
	});

	let targetFrameCount = $derived.by(() => {
		if (frameTargetMode === 'manual') {
			return clampManualFrameCount(manualFrameCount);
		}
		const base = useInterpolation
			? Math.round(flfDurationSeconds * project.fps)
			: Math.round(duration * project.fps);
		return clampFrameBudget(base);
	});

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
						let rawFrames = await extractFrames(data.videoUrl, targetFrameCount);
						console.log(`Extracted ${rawFrames.length} frames`);
						
						if (!rawFrames || rawFrames.length === 0) {
							throw new Error('No frames extracted from video');
						}
						
					// Step 2: Loop shaping (standard ping-pong or strict perfect loop seam pass)
					if (perfectLoop && rawFrames.length > 3) {
						progress = { ...progress, message: 'Forcing perfect loop seam...' };
						if (queueJobId) {
							jobQueue.updateJob(queueJobId, { message: 'Forcing perfect loop seam...' });
						}
						rawFrames = await enforcePerfectLoop(rawFrames);
						console.log(`Perfect loop enforced: ${rawFrames.length} frames`);
					} else if (shouldLoop && rawFrames.length > 2) {
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
					
					// Step 3: Remove backgrounds (if enabled)
					let finalFrames = rawFrames;
					
					if (removeBackground) {
						const totalFrames = rawFrames.length;
						progress = { ...progress, message: `Removing chroma background (${totalFrames} frames)...` };
						if (queueJobId) {
							jobQueue.updateJob(queueJobId, { message: `Chroma keying ${CHROMA_KEY_HEX} background...` });
						}
						
						const cleanedFrames = await cleanupBackgrounds(
							rawFrames,
							70,
							(done, total) => {
								progress = { ...progress, message: `Chroma key cleanup (${done}/${total})...` };
							},
							false,
							{
								chromaKeyHex: CHROMA_KEY_HEX,
								chromaTolerance: CHROMA_KEY_TOLERANCE,
								chromaOnly: true
							}
						);
						
						finalFrames = cleanedFrames;
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
		const totalFrameCount = targetFrameCount;
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
			const requestedFrameCount = targetFrameCount;
			
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
					loop: shouldLoop || perfectLoop,
					perfectLoop,
					model: ACTIVE_MODEL_ID,
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
		<div class="{useInterpolation ? 'flex-1' : 'w-full'}">
			{#if useInterpolation}
				<p class="text-[10px] text-gray-500 text-center mb-1">Start Frame</p>
			{/if}
			{#if project.firstFrame}
				<div class="relative">
					<img src={project.firstFrame} alt="Start" class="w-full {useInterpolation ? 'aspect-square' : 'h-56'} object-contain rounded-lg border-2 border-blue-400 bg-gray-100" />
					<button 
						class="absolute top-1 right-1 bg-red-500 text-white text-xs w-5 h-5 rounded-full hover:bg-red-600 flex items-center justify-center"
						onclick={() => projectStore.update(p => ({ ...p, firstFrame: null }))}
					>×</button>
				</div>
			{:else}
				<div class={useInterpolation ? 'aspect-square' : 'h-56'}>
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
				<input type="range" min="1" max="4" step="0.5" bind:value={duration} class="w-full h-1" />
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
				<option value={10}>10 fps</option>
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
		<label class="flex items-center gap-1 text-purple-700">
			<input type="checkbox" bind:checked={perfectLoop} class="w-3 h-3" />
			Perfect Loop
		</label>
		<label class="flex items-center gap-1 text-gray-600">
			<input type="checkbox" bind:checked={removeBackground} class="w-3 h-3" />
			Remove BG
		</label>
		<label class="flex items-center gap-1 text-gray-600" title="Force pixel art look">
			<input type="checkbox" bind:checked={pixelateOutput} class="w-3 h-3" />
			Pixelate
		</label>
		<span class="ml-auto text-gray-400">~{targetFrameCount}f</span>
	</div>

	<!-- Frame Target Controls -->
	<div class="space-y-1.5 p-2 bg-gray-50 border border-gray-200 rounded">
		<div class="flex items-center justify-between text-xs">
			<span class="font-medium text-gray-700">Frame Target</span>
			<div class="flex items-center gap-3">
				<label class="flex items-center gap-1">
					<input type="radio" name="frameTargetMode" value="auto" bind:group={frameTargetMode} class="w-3 h-3" />
					Auto
				</label>
				<label class="flex items-center gap-1">
					<input type="radio" name="frameTargetMode" value="manual" bind:group={frameTargetMode} class="w-3 h-3" />
					Manual
				</label>
			</div>
		</div>
		{#if frameTargetMode === 'manual'}
			<div class="grid grid-cols-[1fr_auto] gap-2 items-center">
				<input
					type="range"
					min={MIN_MANUAL_FRAMES}
					max={MAX_MANUAL_FRAMES}
					step="1"
					bind:value={manualFrameCount}
					class="w-full h-1"
				/>
				<input
					type="number"
					min={MIN_MANUAL_FRAMES}
					max={MAX_MANUAL_FRAMES}
					step="1"
					bind:value={manualFrameCount}
					onchange={() => manualFrameCount = clampManualFrameCount(manualFrameCount)}
					class="w-16 px-1 py-0.5 border rounded text-xs"
				/>
			</div>
		{/if}
		<p class="text-[10px] text-gray-500">
			Targeting <strong>{targetFrameCount}</strong> extracted frames.
		</p>
	</div>

	<div class="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
		⏱️ {frameTargetMode === 'auto'
			? `Fast frame budget active: auto-target ${MIN_TARGET_FRAMES}-${MAX_TARGET_FRAMES} frames (walking-friendly).`
			: `Manual frame target active: ${targetFrameCount} frames.`}
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

	<div class="text-[10px] text-indigo-700 bg-indigo-50 border border-indigo-200 rounded px-2 py-1">
		🤖 Model locked: WAN 2.2
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
					onclick={() => { flfDurationSeconds = 5; flfInferenceSteps = 8; flfGuidanceScale = 1; flfGuidanceScale2 = 1; flfShift = 8; flfSeed = null; flfNegativePrompt = ''; }}
				>
					↺ Reset FLF to Defaults
				</button>

				<!-- Quality Presets -->
				<div class="flex gap-1 flex-wrap">
					<span class="text-[10px] text-gray-500 mr-1">Presets:</span>
					<button
						class="px-2 py-0.5 text-[10px] bg-green-100 text-green-700 rounded hover:bg-green-200"
					onclick={() => { flfDurationSeconds = 2; flfInferenceSteps = 8; flfGuidanceScale = 1; flfGuidanceScale2 = 1; flfShift = 8; }}
					title="Quick generation, fewer frames"
					>⚡ Fast</button>
					<button
						class="px-2 py-0.5 text-[10px] bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
					onclick={() => { flfDurationSeconds = 5; flfInferenceSteps = 8; flfGuidanceScale = 1; flfGuidanceScale2 = 1; flfShift = 8; }}
					title="Model defaults — recommended starting point"
					>⚖️ Balanced</button>
					<button
						class="px-2 py-0.5 text-[10px] bg-purple-100 text-purple-700 rounded hover:bg-purple-200"
					onclick={() => { flfDurationSeconds = 5; flfInferenceSteps = 12; flfGuidanceScale = 2; flfGuidanceScale2 = 2; flfShift = 8; }}
					title="Slightly more refined, a bit slower"
					>💎 Quality</button>
					<button
						class="px-2 py-0.5 text-[10px] bg-amber-100 text-amber-700 rounded hover:bg-amber-200"
					onclick={() => { flfDurationSeconds = 5; flfInferenceSteps = 16; flfGuidanceScale = 3; flfGuidanceScale2 = 3; flfShift = 8; }}
					title="Maximum steps — slowest, may improve detail"
					>👑 Max</button>
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

