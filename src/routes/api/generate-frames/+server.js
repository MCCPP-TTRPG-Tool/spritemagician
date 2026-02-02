import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { setProgress, clearProgress } from '$lib/utils/generationProgress.js';

/**
 * Process frames asynchronously (runs in background)
 */
async function processFramesAsync(jobId, firstFrame, lastFrame, prompt, frameCount, mode) {
	try {
		const numFrames = frameCount || 8;
		const frames = [];

		// Update progress - starting generation
		setProgress(jobId, {
			currentFrame: 0,
			totalFrames: numFrames,
			status: 'processing',
			message: 'Starting sequential frame generation...'
		});
		
		// PARALLEL GENERATION: All frames generated from the SAME reference image
		// This prevents drift and maintains character consistency
		
		// Keep original frame base64 for reference in all generations
		const originalFrameBase64 = firstFrame.startsWith('data:') 
			? firstFrame.split(',')[1] 
			: firstFrame;
		
		setProgress(jobId, {
			currentFrame: 0,
			totalFrames: numFrames,
			status: 'processing',
			message: 'Generating all frames in parallel from reference...'
		});

		// Animation progression phases (works for ANY animation type)
		const getProgressionPhase = (frameIndex, totalFrames) => {
			const progress = frameIndex / (totalFrames - 1); // 0 to 1
			
			if (progress === 0) return 'starting position, before the action begins';
			if (progress < 0.2) return 'anticipation phase, preparing for the action, slight wind-up';
			if (progress < 0.4) return 'early action, movement beginning, building momentum';
			if (progress < 0.6) return 'peak action, maximum intensity, climax of the movement';
			if (progress < 0.8) return 'follow-through, action completing, momentum carrying forward';
			if (progress < 1) return 'recovery phase, returning toward starting position';
			return 'end position, action complete, ready to loop back to start';
		};

		// Generate all frames in parallel
		const framePromises = [];
		for (let i = 0; i < numFrames; i++) {
			const frameIndex = i;
			const phase = getProgressionPhase(frameIndex, numFrames);
			const progressPercent = Math.round((frameIndex / (numFrames - 1)) * 100);
			
			const framePromise = (async () => {
				try {
					setProgress(jobId, {
						currentFrame: frameIndex + 1,
						totalFrames: numFrames,
						status: 'processing',
						message: `Generating frame ${frameIndex + 1}...`
					});

					const animationPrompt = `SPRITE ANIMATION FRAME GENERATION

ACTION: "${prompt}"
FRAME: ${frameIndex + 1} of ${numFrames} (${progressPercent}% through animation)
PHASE: ${phase}

TASK: Generate frame ${frameIndex + 1} showing this character performing "${prompt}" at ${progressPercent}% progress.

CRITICAL RULES:
1. SAME CHARACTER: Exact same character design, face, colors, outfit, proportions as reference
2. SAME SIZE: Character fills the frame the same way as the reference
3. CENTERED: Character positioned in center of frame like the reference
4. POSE ONLY: Only change body pose/position to show the "${prompt}" action at this point in the animation
5. TRANSPARENT BACKGROUND: No background, just the character
6. LOOPABLE: Frame ${numFrames} should transition smoothly back to frame 1

At ${progressPercent}% through a "${prompt}" animation, the character should be in the ${phase}.`;

					const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${env.GEMINI_API_KEY}`, {
						method: 'POST',
						headers: {
							'Content-Type': 'application/json'
						},
						body: JSON.stringify({
							contents: [{
								parts: [
									{ text: 'CHARACTER REFERENCE - Generate a new pose for this exact character:' },
									{
										inline_data: {
											mime_type: 'image/png',
											data: originalFrameBase64
										}
									},
									{ text: animationPrompt }
								]
							}],
							generationConfig: {
								responseModalities: ['TEXT', 'IMAGE'],
								imageConfig: {
									aspectRatio: '1:1'
								}
							}
						})
					});

					if (!response.ok) {
						const errorText = await response.text();
						console.error(`Frame ${frameIndex + 1} API error:`, errorText);
						throw new Error(`API error: ${errorText}`);
					}

					const result = await response.json();
					
					let generatedImage;
					if (result.candidates && result.candidates[0] && result.candidates[0].content) {
						const parts = result.candidates[0].content.parts;
						for (const part of parts) {
							if (part.inlineData && part.inlineData.data) {
								generatedImage = `data:image/png;base64,${part.inlineData.data}`;
								break;
							} else if (part.inline_data && part.inline_data.data) {
								generatedImage = `data:image/png;base64,${part.inline_data.data}`;
								break;
							}
						}
					}
					
					if (!generatedImage) {
						console.error(`Frame ${frameIndex + 1} no image in response`);
						throw new Error(`Frame ${frameIndex + 1} failed: No image in response`);
					}
					
					return { index: frameIndex, image: generatedImage };
				} catch (error) {
					console.error(`Frame ${frameIndex + 1} failed:`, error);
					return { index: frameIndex, image: null, error: error.message };
				}
			})();

			framePromises.push(framePromise);
		}

		// Wait for all frames
		const results = await Promise.all(framePromises);
		
		// Sort by index and collect frames
		results.sort((a, b) => a.index - b.index);
		for (const result of results) {
			if (result.image) {
				frames.push(result.image);
			}
		}

		// Mark as completed
		setProgress(jobId, {
			currentFrame: numFrames,
			totalFrames: numFrames,
			status: 'completed',
			message: `All ${frames.length} frames generated!`,
			frames: frames
		});

		setTimeout(() => clearProgress(jobId), 30000);
	} catch (error) {
		console.error('Frame generation error:', error);
		setProgress(jobId, {
			currentFrame: 0,
			totalFrames: frameCount || 8,
			status: 'error',
			message: error.message
		});
		setTimeout(() => clearProgress(jobId), 10000);
	}
}

/**
 * Generates animation frames using Replicate API
 */
export async function POST({ request }) {
	const jobId = `job-${Date.now()}-${Math.random().toString(36).substring(7)}`;

	try {
		const { firstFrame, lastFrame, prompt, frameCount, mode } = await request.json();

		if (!firstFrame) {
			return json({ error: 'First frame is required' }, { status: 400 });
		}

		if (mode === 'prompt' && !prompt) {
			return json({ error: 'Prompt is required for prompt mode' }, { status: 400 });
		}

		if (mode === 'interpolation' && !lastFrame) {
			return json({ error: 'Last frame is required for interpolation mode' }, { status: 400 });
		}

		if (!env.GEMINI_API_KEY) {
			return json({ error: 'Gemini API key not configured. Set GEMINI_API_KEY in .env' }, { status: 500 });
		}

		// Initialize progress immediately
		setProgress(jobId, {
			currentFrame: 0,
			totalFrames: frameCount || 8,
			status: 'starting',
			message: 'Initializing generation...'
		});

		// Start processing in background (don't await)
		processFramesAsync(jobId, firstFrame, lastFrame, prompt, frameCount, mode);

		// Return immediately with jobId so client can start polling
		return json({ jobId, status: 'started', message: 'Generation started' });
	} catch (error) {
		console.error('API error:', error);
		return json({ error: error.message }, { status: 500 });
	}
}
