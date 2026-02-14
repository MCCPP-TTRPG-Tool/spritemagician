/**
 * Image-to-Video generation with multiple model options
 * 
 * Models (Replicate — standard I2V):
 * - Wan 2.2 Fast: Cheapest, fast I2V
 * - LTX Video: Fast alternative
 * - Hailuo 2.3: Best quality
 * - SVD: Slow but reliable
 * 
 * Interpolation — First/Last Frame to Video:
 * - lucataco/wan-2.2-first-last-frame (Replicate, same API key)
 * 
 * Flow:
 * 1. Upload reference image to get URL
 * 2. Generate video using selected model
 * 3. Return video URL for client to extract frames
 */

import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { setProgress, clearProgress } from '$lib/utils/generationProgress.js';
import { uploadImageToFirebase } from '$lib/utils/firebaseStorage.js';

// Available Replicate models (standard I2V)
const MODELS = {
	wan22: {
		name: 'Wan 2.2 Fast (Cheapest)',
		version: 'wan-video/wan-2.2-i2v-fast',
		speed: 'fast',
		isModelPath: true
	},
	ltxv: {
		name: 'LTX Video (Fast)',
		version: '8c47da666861d081eeb4d1261853087de23923a268a69b63febdf5dc1dee08e4',
		speed: 'fast'
	},
	hailuo: {
		name: 'Hailuo 2.3 (Quality)',
		version: '23a02633b5a44780345a59d4d43f8bd510efa239c56f08f29639ff24fa6615e1',
		speed: 'fast'
	},
	live2d: {
		name: 'Video-01 Live (2D)',
		version: '7574e16b8f1ad52c6332ecb264c0f132e555f46c222255a738131ec1bb614092',
		speed: 'fast'
	},
	wan25: {
		name: 'Wan 2.5 I2V',
		version: '1b29bbbbfdbc25bba2294de3acd2b58b82e5b623f183880cdb37d76133d80f00',
		speed: 'medium'
	},
	svd: {
		name: 'SVD (Expensive)',
		version: 'stability-ai/stable-video-diffusion:3f0457e4619daac51203dedb472816fd4af51f3149fa7a9e0b5ffcf1b8172438',
		speed: 'slow'
	}
};

// Replicate FLF model for interpolation
const FLF_MODEL_VERSION = '003fd8a38ff17cb6022c3117bb90f7403cb632062ba2b098710738d116847d57';


// ═══════════════════════════════════════════════════════════════════════════════
// Replicate — WAN 2.2 First/Last Frame interpolation
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Run WAN 2.2 First-Last-Frame interpolation via Replicate.
 * Full parameter support per model schema:
 *   start_image, end_image, prompt, negative_prompt, duration_seconds,
 *   num_inference_steps, guidance_scale (high noise), guidance_scale_2 (low noise),
 *   shift (scheduler), seed
 */
async function runReplicateInterpolation(jobId, startImageDataUrl, endImageDataUrl, prompt, frameCount, fps, flfOptions = {}) {
	const REPLICATE_API_TOKEN = env.REPLICATE_API_TOKEN;
	if (!REPLICATE_API_TOKEN) {
		throw new Error('REPLICATE_API_TOKEN not set in .env');
	}

	// Lightning LoRA model — works best with the model's own default prompt "animate".
	// The start/end images provide all visual context. Complex prompts hurt quality.
	const enhancedPrompt = (prompt && prompt.length < 80) ? prompt : 'animate';
	console.log('[FLF] Prompt:', enhancedPrompt);

	// Use the model's own default negative prompt (Chinese). Only add user extras if provided.
	const MODEL_DEFAULT_NEGATIVE = '色调艳丽，过曝，静态，细节模糊不清，字幕，风格，作品，画作，画面，静止，整体发灰，最差质量，低质量，JPEG压缩残留，丑陋的，残缺的，多余的手指，画得不好的手部，画得不好的脸部，畸形的，毁容的，形态畸形的肢体，手指融合，静止不动的画面，杂乱的背景，三条腿，背景人很多，倒着走,过曝，';
	const userNeg = flfOptions.negativePrompt || '';
	const finalNegativePrompt = userNeg ? `${MODEL_DEFAULT_NEGATIVE} ${userNeg}` : MODEL_DEFAULT_NEGATIVE;

	// Resolve FLF-specific parameters — using exact model defaults (matching working examples)
	// Source: https://replicate.com/lucataco/wan-2.2-first-last-frame schema
	const durationSeconds = flfOptions.durationSeconds ?? 5;       // model default: 5
	const numInferenceSteps = flfOptions.numInferenceSteps ?? 8;   // model default: 8
	const guidanceScale = flfOptions.guidanceScale ?? 1;           // model default: 1
	const guidanceScale2 = flfOptions.guidanceScale2 ?? 1;         // model default: 1
	const shift = flfOptions.shift ?? 8;                           // model default: 8
	const seed = flfOptions.seed;                                  // nullable integer

	console.log('[FLF] Parameters:', { durationSeconds, numInferenceSteps, guidanceScale, guidanceScale2, shift, seed: seed ?? 'random' });

	// 1. Ensure both frames are public URLs (Replicate requires URLs)
	setProgress(jobId, { currentFrame: 0, totalFrames: frameCount, status: 'processing', message: 'Uploading start & end frames...' });

	let startUrl = startImageDataUrl;
	if (startImageDataUrl.startsWith('data:')) {
		startUrl = await uploadImageToFirebase(startImageDataUrl, `flf-start-${Date.now()}.png`);
	}
	let endUrl = endImageDataUrl;
	if (endImageDataUrl.startsWith('data:')) {
		endUrl = await uploadImageToFirebase(endImageDataUrl, `flf-end-${Date.now()}.png`);
	}

	console.log('[FLF] Start URL:', startUrl);
	console.log('[FLF] End URL:', endUrl);

	// 2. Submit prediction with full parameter set
	setProgress(jobId, { currentFrame: 0, totalFrames: frameCount, status: 'processing', message: `Submitting to Replicate FLF (${durationSeconds}s, ${numInferenceSteps} steps)...` });

	const inputPayload = {
		start_image: startUrl,
		end_image: endUrl,
		prompt: enhancedPrompt,
		negative_prompt: finalNegativePrompt,
		duration_seconds: durationSeconds,
		num_inference_steps: numInferenceSteps,
		guidance_scale: guidanceScale,
		guidance_scale_2: guidanceScale2,
		shift: shift,
		...(seed != null && { seed: seed })
	};

	console.log('[FLF] Full input payload:', { ...inputPayload, start_image: '(url)', end_image: '(url)' });

	const submitRes = await fetch('https://api.replicate.com/v1/predictions', {
		method: 'POST',
		headers: {
			'Authorization': `Token ${REPLICATE_API_TOKEN}`,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({
			version: FLF_MODEL_VERSION,
			input: inputPayload
		})
	});

	if (!submitRes.ok) {
		const errText = await submitRes.text();
		console.error('[FLF] Submit error:', submitRes.status, errText);
		throw new Error(`Replicate FLF submit error (${submitRes.status}): ${errText}`);
	}

	const prediction = await submitRes.json();
	console.log('[FLF] Prediction started:', prediction.id);

	// 3. Poll for completion
	setProgress(jobId, { currentFrame: 0, totalFrames: frameCount, status: 'processing', message: 'Replicate FLF: Queued...' });

	let attempts = 0;
	const pollInterval = 2000;
	const maxAttempts = 150; // ~5 minutes

	while (attempts < maxAttempts) {
		await new Promise(r => setTimeout(r, pollInterval));
		attempts++;

		const statusRes = await fetch(`https://api.replicate.com/v1/predictions/${prediction.id}`, {
			headers: { 'Authorization': `Token ${REPLICATE_API_TOKEN}` }
		});

		if (!statusRes.ok) {
			console.warn('[FLF] Status poll error:', statusRes.status);
			continue;
		}

		const result = await statusRes.json();
		const elapsed = Math.round(attempts * pollInterval / 1000);

		setProgress(jobId, {
			currentFrame: Math.min(Math.floor(attempts / 3), frameCount - 1),
			totalFrames: frameCount,
			status: 'processing',
			message: `Replicate FLF: ${result.status}... (${elapsed}s)`
		});

		if (result.status === 'succeeded') {
			const videoUrl = result.output;
			if (!videoUrl) {
				console.error('[FLF] No output in result:', JSON.stringify(result).substring(0, 500));
				throw new Error('Replicate FLF returned no output');
			}
			console.log('[FLF] Completed, video URL:', videoUrl);
			return videoUrl;
		}

		if (result.status === 'failed') {
			const errMsg = result.error || 'Replicate FLF generation failed';
			console.error('[FLF] Failed:', errMsg);
			throw new Error(errMsg);
		}

		if (result.status === 'canceled') {
			throw new Error('Replicate FLF prediction was canceled');
		}
	}

	throw new Error('Replicate FLF generation timed out after 5 minutes');
}


// ═══════════════════════════════════════════════════════════════════════════════
// Main async processor
// ═══════════════════════════════════════════════════════════════════════════════

async function processAnimationAsync(jobId, referenceImage, prompt, frameCount, motionAmount = 127, fps = 8, modelId = 'wan22', endImage = null, loop = false, guidanceScale = null, seed = null, negativePrompt = null, flfOptions = {}) {
	const isInterpolation = !!endImage;
	
	// Enhanced prompt engineering for better accuracy and loops
	const PIXEL_ART_PRESERVE = 'IMPORTANT: Maintain pixel art style, preserve crisp pixels, no smoothing, no blur, keep pixelated aesthetic, consistent character design';
	
	// Size consistency instructions
	const SIZE_CONSISTENCY = 'CRITICAL: Character must maintain exact same size and scale throughout entire animation. No scaling, no zoom in or out, no size changes, consistent character dimensions from first frame to last frame. Character size must remain constant.';
	
	// Loop-specific instructions for seamless animations
	const LOOP_INSTRUCTIONS = loop 
		? 'SEAMLESS LOOP: The animation must end exactly where it begins. First frame and last frame must be identical. Smooth transition from last frame back to first frame. No visible jump or discontinuity. Perfect loop continuity.'
		: '';
	
	// Enhanced prompt structure
	let enhancedPrompt;
	if (prompt) {
		enhancedPrompt = `${PIXEL_ART_PRESERVE}. ${SIZE_CONSISTENCY} ${LOOP_INSTRUCTIONS} ${prompt}. Consistent character appearance, stable camera position, smooth motion, no jitter, no flickering, high quality animation`;
	} else {
		enhancedPrompt = `${PIXEL_ART_PRESERVE}. ${SIZE_CONSISTENCY} ${LOOP_INSTRUCTIONS} Subtle idle animation, gentle breathing, minimal movement, mouth closed and static, no mouth movement, no talking, no jaw movement, smooth and natural motion`;
	}
	
	// Default negative prompt to avoid common issues
	const defaultNegativePrompt = 'blurry, distorted, inconsistent, flickering, jittery, pixelated artifacts, color bleeding, ghosting, double image, duplicate limbs, extra appendages, deformed, bad anatomy, low quality, mouth movement, talking, jaw movement, lip sync, character scaling, size changes, zoom in, zoom out, character growing, character shrinking, inconsistent character size';
	const finalNegativePrompt = negativePrompt 
		? `${defaultNegativePrompt}, ${negativePrompt}`
		: defaultNegativePrompt;
	
	try {
		// ── Interpolation Mode (Start → End frame via Replicate FLF) ────────
		if (isInterpolation) {
			console.log('[Animation] Interpolation → Replicate WAN 2.2 FLF');
			const videoUrl = await runReplicateInterpolation(jobId, referenceImage, endImage, prompt, frameCount, fps, flfOptions);

			setProgress(jobId, {
				currentFrame: frameCount,
				totalFrames: frameCount,
				status: 'completed',
				message: 'Video generated! Extracting frames...',
				videoUrl: videoUrl,
				loop: true,
				frames: []
			});

			setTimeout(() => clearProgress(jobId), 120000);
			return;
		}

		// ── Standard I2V via Replicate ──────────────────────────────────────
		const model = MODELS[modelId] || MODELS.wan22;

		// SVD uses Replicate API
		if (modelId === 'svd') {
			console.log('Using Replicate SVD API');
			
			setProgress(jobId, {
				currentFrame: 0,
				totalFrames: frameCount,
				status: 'processing',
				message: 'Uploading image for SVD...'
			});

			let imageUrl = referenceImage;
			if (referenceImage.startsWith('data:image/')) {
				imageUrl = await uploadImageToFirebase(referenceImage, `svd-input-${jobId}`);
				console.log('Uploaded input image:', imageUrl);
			}

			setProgress(jobId, {
				currentFrame: 0,
				totalFrames: frameCount,
				status: 'processing',
				message: 'Starting SVD generation...'
			});

			const svdVersion = MODELS.svd.version;
			const svdFrames = Math.min(25, Math.max(14, frameCount));
			console.log(`SVD generating ${svdFrames} frames for ${frameCount} requested`);
			
			const svdMotion = motionAmount ? Math.max(1, Math.min(255, motionAmount)) : 127;
			const svdInput = {
				input_image: imageUrl,
				motion_bucket_id: svdMotion,
				fps: fps,
				num_frames: svdFrames,
				...(seed !== null && { seed: seed })
			};
			
			const response = await fetch('https://api.replicate.com/v1/predictions', {
				method: 'POST',
				headers: {
					'Authorization': `Token ${env.REPLICATE_API_TOKEN}`,
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					version: svdVersion.split(':')[1],
					input: svdInput
				})
			});

			if (!response.ok) {
				const errorText = await response.text();
				throw new Error(`Replicate API error: ${response.status} - ${errorText}`);
			}

			const prediction = await response.json();
			console.log('SVD prediction started:', prediction.id);

			let videoUrl = null;
			let attempts = 0;
			const maxAttempts = 300;

			while (attempts < maxAttempts) {
				await new Promise(resolve => setTimeout(resolve, 2000));

				const statusResponse = await fetch(`https://api.replicate.com/v1/predictions/${prediction.id}`, {
					headers: { 'Authorization': `Token ${env.REPLICATE_API_TOKEN}` }
				});

				const status = await statusResponse.json();

				if (status.status === 'succeeded') {
					videoUrl = status.output;
					break;
				}

				if (status.status === 'failed') {
					throw new Error(status.error || 'SVD generation failed');
				}

				setProgress(jobId, {
					currentFrame: Math.min(Math.floor(attempts / 5), frameCount - 1),
					totalFrames: frameCount,
					status: 'processing',
					message: `SVD generating... (${attempts * 2}s)`
				});

				attempts++;
			}

			if (!videoUrl) {
				throw new Error('SVD generation timed out');
			}

			setProgress(jobId, {
				currentFrame: frameCount,
				totalFrames: frameCount,
				status: 'completed',
				message: 'Video generated! Extracting frames...',
				videoUrl: videoUrl,
				loop: true,
				frames: []
			});

			setTimeout(() => clearProgress(jobId), 120000);
			return;
		}

		// For Replicate API, upload to Firebase first to get public URL
		setProgress(jobId, {
			currentFrame: 0,
			totalFrames: frameCount,
			status: 'processing',
			message: 'Uploading reference image...'
		});

		let imageUrl;
		if (referenceImage.startsWith('data:')) {
			imageUrl = await uploadImageToFirebase(referenceImage, `anim-input-${Date.now()}.png`);
		} else {
			imageUrl = referenceImage;
		}

		setProgress(jobId, {
			currentFrame: 0,
			totalFrames: frameCount,
			status: 'processing',
			message: `Starting ${model.name}...`
		});

		// Build input based on model
		let input;
		
		if (modelId === 'hailuo') {
			// Hailuo supports guidance_scale
			const hailuoGuidance = guidanceScale !== null ? guidanceScale : 7.5;
			input = {
				prompt: enhancedPrompt,
				negative_prompt: finalNegativePrompt,
				first_frame_image: imageUrl,
				guidance_scale: hailuoGuidance,
				...(seed !== null && { seed: seed })
			};
		} else if (modelId === 'ltxv') {
			// LTX Video supports guidance_scale and motion_scale
			const ltxGuidance = guidanceScale !== null ? guidanceScale : 7.5;
			const ltxMotion = motionAmount ? Math.max(0.1, Math.min(2.0, motionAmount / 127)) : 1.0;
			input = {
				input_image: imageUrl,
				prompt: enhancedPrompt,
				negative_prompt: finalNegativePrompt,
				num_frames: Math.min(65, frameCount * 3),
				guidance_scale: ltxGuidance,
				motion_scale: ltxMotion,
				...(seed !== null && { seed: seed })
			};
		} else if (modelId === 'live2d') {
			// Live2D supports guidance_scale
			const live2dGuidance = guidanceScale !== null ? guidanceScale : 7.5;
			input = {
				prompt: enhancedPrompt,
				negative_prompt: finalNegativePrompt,
				first_frame_image: imageUrl,
				guidance_scale: live2dGuidance,
				...(seed !== null && { seed: seed })
			};
		} else if (modelId === 'wan22') {
			const wanFrames = Math.min(121, Math.max(81, frameCount));
			// WAN 2.2 supports motion_bucket_id for motion control
			const wanMotion = motionAmount ? Math.max(1, Math.min(255, motionAmount)) : 127;
			input = {
				prompt: enhancedPrompt,
				negative_prompt: finalNegativePrompt,
				image: imageUrl,
				num_frames: wanFrames,
				fps: fps,
				motion_bucket_id: wanMotion,
				...(seed !== null && { seed: seed })
			};
		} else if (modelId === 'wan25') {
			// WAN 2.5 supports additional parameters
			const wan25Motion = motionAmount ? Math.max(1, Math.min(255, motionAmount)) : 127;
			input = {
				prompt: enhancedPrompt,
				negative_prompt: finalNegativePrompt,
				image: imageUrl,
				max_area: '832x480',
				fast_mode: 'Disabled',
				motion_bucket_id: wan25Motion,
				...(seed !== null && { seed: seed })
			};
		} else {
			input = {
				prompt: enhancedPrompt,
				first_frame_image: imageUrl
			};
		}
		
		console.log(`${model.name} params:`, { fps, motionAmount, frameCount, modelId });

		let apiUrl, body;
		
		if (model.isModelPath) {
			apiUrl = `https://api.replicate.com/v1/models/${model.version}/predictions`;
			body = JSON.stringify({ input });
		} else {
			apiUrl = 'https://api.replicate.com/v1/predictions';
			body = JSON.stringify({ version: model.version, input });
		}
		
		const response = await fetch(apiUrl, {
			method: 'POST',
			headers: {
				'Authorization': `Token ${env.REPLICATE_API_TOKEN}`,
				'Content-Type': 'application/json'
			},
			body: body
		});

		if (!response.ok) {
			const error = await response.text();
			console.error(`${model.name} API error:`, error);
			throw new Error(`${model.name} API error: ${error}`);
		}

		const prediction = await response.json();
		console.log(`${model.name} prediction started:`, prediction.id);
		
		let result = prediction;
		let attempts = 0;
		const pollInterval = model.speed === 'fast' ? 1500 : 2000;
		const maxAttempts = model.speed === 'fast' ? 120 : 300;

		while ((result.status === 'starting' || result.status === 'processing') && attempts < maxAttempts) {
			await new Promise(resolve => setTimeout(resolve, pollInterval));
			
			const statusResponse = await fetch(`https://api.replicate.com/v1/predictions/${result.id}`, {
				headers: {
					'Authorization': `Token ${env.REPLICATE_API_TOKEN}`
				}
			});
			
			result = await statusResponse.json();
			attempts++;

			const elapsedSeconds = Math.round(attempts * pollInterval / 1000);
			setProgress(jobId, {
				currentFrame: Math.min(Math.floor(attempts / 5), frameCount - 1),
				totalFrames: frameCount,
				status: 'processing',
				message: `${model.name}: ${result.status}... (${elapsedSeconds}s)`
			});
		}

		if (result.status === 'failed') {
			console.error(`${model.name} failed:`, result.error);
			throw new Error(result.error || `${model.name} generation failed`);
		}

		if (result.status !== 'succeeded') {
			throw new Error(`${model.name} generation timed out`);
		}

		const videoUrl = result.output;
		console.log(`${model.name} completed, video URL:`, videoUrl);
		
		setProgress(jobId, {
			currentFrame: frameCount,
			totalFrames: frameCount,
			status: 'completed',
			message: 'Video generated! Extracting frames...',
			videoUrl: videoUrl,
			loop: true,
			frames: []
		});

		setTimeout(() => clearProgress(jobId), 120000);

	} catch (error) {
		console.error('Animation generation error:', error);
		setProgress(jobId, {
			currentFrame: 0,
			totalFrames: frameCount,
			status: 'error',
			message: error.message
		});
		setTimeout(() => clearProgress(jobId), 10000);
	}
}

export async function POST({ request }) {
	const jobId = `job-${Date.now()}-${Math.random().toString(36).substring(7)}`;

	try {
		const { 
			referenceImage, endImage, prompt, pose, frameCount, motionAmount, fps, loop, model, interpolate, 
			guidanceScale, seed, negativePrompt,
			// FLF-specific parameters (for interpolation mode)
			flfDurationSeconds, flfInferenceSteps, flfGuidanceScale, flfGuidanceScale2, flfShift, flfSeed, flfNegativePrompt
		} = await request.json();

		if (!referenceImage) {
			return json({ error: 'Reference image is required. Upload an image first.' }, { status: 400 });
		}
		
		if (interpolate && !endImage) {
			return json({ error: 'End image is required for interpolation mode' }, { status: 400 });
		}

		const numFrames = frameCount || 8;
		const isInterpolation = interpolate && !!endImage;
		const modelId = model || 'wan22';
		const selectedModel = MODELS[modelId] || MODELS.wan22;

		// All modes require Replicate
		if (!env.REPLICATE_API_TOKEN) {
			return json({ error: 'Replicate API token not configured. Set REPLICATE_API_TOKEN in .env' }, { status: 500 });
		}

		const displayName = isInterpolation ? 'WAN 2.2 FLF (Replicate)' : selectedModel.name;

		setProgress(jobId, {
			currentFrame: 0,
			totalFrames: numFrames,
			status: 'starting',
			message: isInterpolation
				? 'Interpolating with WAN 2.2 First-Last-Frame...'
				: `Initializing ${selectedModel.name}...`
		});
		
		// Build FLF options object for interpolation mode
		const flfOptions = isInterpolation ? {
			durationSeconds: flfDurationSeconds ?? undefined,
			numInferenceSteps: flfInferenceSteps ?? undefined,
			guidanceScale: flfGuidanceScale ?? undefined,
			guidanceScale2: flfGuidanceScale2 ?? undefined,
			shift: flfShift ?? undefined,
			seed: flfSeed ?? undefined,
			negativePrompt: flfNegativePrompt || negativePrompt || null
		} : {};

		processAnimationAsync(
			jobId, 
			referenceImage, 
			prompt, 
			numFrames, 
			motionAmount || 127, 
			fps || 8, 
			modelId, 
			isInterpolation ? endImage : null,
			loop || false,
			guidanceScale || null,
			seed || null,
			negativePrompt || null,
			flfOptions
		);

		return json({
			jobId,
			status: 'started',
			model: displayName,
			interpolate: isInterpolation
		});

	} catch (error) {
		console.error('API error:', error);
		return json({ error: error.message }, { status: 500 });
	}
}
