/**
 * Image-to-Video generation with multiple model options
 * 
 * Models (Replicate — standard I2V):
 * - Wan 2.2 Fast: Cheapest, fast I2V
 * - LTX Video: Fast alternative
 * - Hailuo 2.3: Best quality
 * - SVD: Slow but reliable
 * 
 * Interpolation — First/Last Frame to Video (priority order):
 * 1. RunPod Serverless + ComfyUI WAN 2.2 FLF2V  (RUNPOD_API_KEY + RUNPOD_ENDPOINT_ID)
 * 2. fal.ai Wan FLF2V                             (FAL_KEY)
 * 
 * Flow:
 * 1. Upload reference image to get URL
 * 2. Generate video using selected model/backend
 * 3. Return video URL for client to extract frames
 */

import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { setProgress, clearProgress } from '$lib/utils/generationProgress.js';
import { uploadImageToFirebase } from '$lib/utils/firebaseStorage.js';
import { readFileSync } from 'fs';
import { resolve } from 'path';

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

// ═══════════════════════════════════════════════════════════════════════════════
// RunPod Serverless — WAN 2.2 FLF2V via ComfyUI Worker
// ═══════════════════════════════════════════════════════════════════════════════

/** Cached workflow JSON (loaded once from wan22_flf2v_api.json) */
let _flf2vWorkflow = null;

function loadFLF2VWorkflow() {
	if (_flf2vWorkflow) return JSON.parse(JSON.stringify(_flf2vWorkflow)); // deep clone
	try {
		const filePath = resolve('wan22_flf2v_api.json');
		const raw = readFileSync(filePath, 'utf-8');
		_flf2vWorkflow = JSON.parse(raw);
		console.log('[FLF2V] Loaded wan22_flf2v_api.json workflow');
		return JSON.parse(JSON.stringify(_flf2vWorkflow));
	} catch (err) {
		console.error('[FLF2V] Failed to load wan22_flf2v_api.json:', err.message);
		throw new Error('wan22_flf2v_api.json not found. Export your ComfyUI FLF2V workflow in API format and save it to the project root.');
	}
}

/**
 * Inject dynamic values into the workflow template.
 * Scans nodes by class_type so it works with any exported workflow regardless of node IDs.
 */
function injectWorkflowValues(workflow, prompt) {
	const PIXEL_ART_PRESERVE = 'pixel art style, crisp pixels, no smoothing, no blur, pixelated aesthetic';
	const enhancedPrompt = prompt
		? `Smooth transition from first frame to last frame, consistent character. ${PIXEL_ART_PRESERVE}. ${prompt}`
		: `${PIXEL_ART_PRESERVE}. subtle idle animation transition`;

	for (const nodeId of Object.keys(workflow)) {
		const node = workflow[nodeId];
		if (!node || !node.inputs) continue;

		// Inject positive prompt (CLIPTextEncode or WanVideoTextEncode — skip negative prompts)
		if (
			(node.class_type === 'CLIPTextEncode' || node.class_type === 'WanVideoTextEncode') &&
			node.inputs.text !== undefined &&
			!node.inputs.text.includes('blurry') &&
			!node.inputs.text.includes('watermark') &&
			!node._meta?.title?.toLowerCase().includes('negative')
		) {
			node.inputs.text = enhancedPrompt;
			console.log(`[FLF2V] Injected prompt into node ${nodeId} (${node.class_type})`);
		}

		// Also handle "prompt" field variant (WanVideoTextEncode uses "prompt" not "text")
		if (node.class_type === 'WanVideoTextEncode' && node.inputs.prompt !== undefined) {
			if (!node.inputs.prompt.includes('blurry') && !node.inputs.prompt.includes('watermark')) {
				node.inputs.prompt = enhancedPrompt;
			}
		}

		// Randomize seeds in all KSampler nodes
		if (node.class_type === 'KSampler' && node.inputs.seed !== undefined) {
			node.inputs.seed = Math.floor(Math.random() * 2147483647);
		}

		// Remove metadata fields ComfyUI doesn't accept
		if (node._comment) delete node._comment;
		if (node._meta) delete node._meta;
		if (node._NOTE) delete node._NOTE;
	}

	// Remove top-level metadata
	if (workflow._NOTE) delete workflow._NOTE;
	if (workflow._comment) delete workflow._comment;

	return workflow;
}

/**
 * Run WAN 2.2 FLF2V interpolation via RunPod Serverless.
 * Sends the ComfyUI workflow + base64 images to the RunPod endpoint.
 * Polls /status/{id} until COMPLETED or FAILED.
 */
async function runRunPodFLF2V(jobId, startImageDataUrl, endImageDataUrl, prompt, frameCount, fps) {
	const RUNPOD_API_KEY = env.RUNPOD_API_KEY;
	const RUNPOD_ENDPOINT_ID = env.RUNPOD_ENDPOINT_ID;

	if (!RUNPOD_API_KEY || !RUNPOD_ENDPOINT_ID) {
		throw new Error('RUNPOD_API_KEY and RUNPOD_ENDPOINT_ID must be set in .env');
	}

	const RUNPOD_BASE = `https://api.runpod.ai/v2/${RUNPOD_ENDPOINT_ID}`;

	// 1. Extract raw base64 from data URLs
	let startBase64 = startImageDataUrl;
	if (startImageDataUrl.startsWith('data:')) {
		startBase64 = startImageDataUrl.split(',')[1];
	}
	let endBase64 = endImageDataUrl;
	if (endImageDataUrl.startsWith('data:')) {
		endBase64 = endImageDataUrl.split(',')[1];
	}

	// 2. Load and prepare workflow
	setProgress(jobId, { currentFrame: 0, totalFrames: frameCount, status: 'processing', message: 'Preparing FLF2V workflow...' });

	const workflow = loadFLF2VWorkflow();
	injectWorkflowValues(workflow, prompt);

	console.log('[FLF2V] Workflow prepared, submitting to RunPod Serverless...');

	// 3. Submit to RunPod Serverless
	setProgress(jobId, { currentFrame: 0, totalFrames: frameCount, status: 'processing', message: 'Submitting to RunPod...' });

	const payload = {
		input: {
			workflow: workflow,
			images: [
				{ name: 'first_frame.png', image: startBase64 },
				{ name: 'last_frame.png', image: endBase64 }
			]
		}
	};

	const submitRes = await fetch(`${RUNPOD_BASE}/run`, {
		method: 'POST',
		headers: {
			'Authorization': `Bearer ${RUNPOD_API_KEY}`,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify(payload)
	});

	if (!submitRes.ok) {
		const errText = await submitRes.text();
		console.error('[FLF2V] RunPod submit error:', submitRes.status, errText);
		throw new Error(`RunPod submit error (${submitRes.status}): ${errText}`);
	}

	const submitData = await submitRes.json();
	const runpodJobId = submitData.id;
	console.log('[FLF2V] Job submitted, RunPod job ID:', runpodJobId);

	// 4. Poll for completion
	setProgress(jobId, { currentFrame: 0, totalFrames: frameCount, status: 'processing', message: 'RunPod FLF2V: Queued...' });

	let attempts = 0;
	const pollInterval = 3000; // 3 seconds
	const maxAttempts = 200;   // ~10 minutes

	while (attempts < maxAttempts) {
		await new Promise(r => setTimeout(r, pollInterval));
		attempts++;

		let statusData;
		try {
			const statusRes = await fetch(`${RUNPOD_BASE}/status/${runpodJobId}`, {
				headers: { 'Authorization': `Bearer ${RUNPOD_API_KEY}` }
			});
			if (!statusRes.ok) {
				console.warn('[FLF2V] Status poll HTTP error:', statusRes.status);
				continue;
			}
			statusData = await statusRes.json();
		} catch (fetchErr) {
			console.warn('[FLF2V] Status fetch failed:', fetchErr.message);
			continue;
		}

		const elapsed = Math.round(attempts * pollInterval / 1000);

		setProgress(jobId, {
			currentFrame: Math.min(Math.floor(attempts / 4), frameCount - 1),
			totalFrames: frameCount,
			status: 'processing',
			message: `RunPod FLF2V: ${statusData.status}... (${elapsed}s)`
		});

		// ── COMPLETED ────────────────────────────────────────────────────────
		if (statusData.status === 'COMPLETED') {
			const output = statusData.output;
			console.log('[FLF2V] Job completed. Output keys:', output ? Object.keys(output) : 'null');

			let videoUrl;

			// The runpod-worker-comfy returns output in several possible formats:
			// Format A: { message: "success", images: ["base64..."] }
			// Format B: { images: [{ image: "base64...", ... }] }
			// Format C: { video_url: "https://..." }
			// Format D: raw string URL

			if (output?.images && output.images.length > 0) {
				// Base64 output — upload to Firebase for a public URL
				const rawB64 = typeof output.images[0] === 'string'
					? output.images[0]
					: output.images[0].image;

				setProgress(jobId, { currentFrame: frameCount - 1, totalFrames: frameCount, status: 'processing', message: 'Uploading result video...' });
				const videoDataUrl = `data:video/mp4;base64,${rawB64}`;
				videoUrl = await uploadImageToFirebase(videoDataUrl, `flf2v-output-${Date.now()}.mp4`);
			} else if (output?.video_url) {
				videoUrl = output.video_url;
			} else if (typeof output === 'string' && output.startsWith('http')) {
				videoUrl = output;
			} else {
				console.error('[FLF2V] Unexpected output format:', JSON.stringify(output).substring(0, 500));
				throw new Error('RunPod returned unexpected output format. Check your ComfyUI worker configuration.');
			}

			console.log('[FLF2V] Video URL:', videoUrl);
			return videoUrl;
		}

		// ── FAILED ───────────────────────────────────────────────────────────
		if (statusData.status === 'FAILED') {
			const errMsg = statusData.error || JSON.stringify(statusData.output) || 'RunPod FLF2V generation failed';
			console.error('[FLF2V] Job failed:', errMsg);
			throw new Error(errMsg);
		}

		if (statusData.status === 'CANCELLED') {
			throw new Error('RunPod job was cancelled');
		}
	}

	throw new Error('RunPod FLF2V generation timed out after 10 minutes');
}


// ═══════════════════════════════════════════════════════════════════════════════
// fal.ai FLF2V — Hosted fallback
// ═══════════════════════════════════════════════════════════════════════════════

const FAL_FLF_ENDPOINT = 'fal-ai/wan-flf2v';

/**
 * Run frame interpolation via fal.ai queue API.
 * Submits start + end frame URLs, polls for completion, returns video URL.
 */
async function runFalInterpolation(jobId, startImageUrl, endImageUrl, prompt, frameCount, fps) {
	const FAL_KEY = env.FAL_KEY;
	if (!FAL_KEY) throw new Error('FAL_KEY not configured. Add FAL_KEY to your .env file (get one at https://fal.ai/dashboard/keys)');

	const PIXEL_ART_PRESERVE = 'IMPORTANT: Maintain pixel art style, preserve crisp pixels, no smoothing, no blur, keep pixelated aesthetic';
	const enhancedPrompt = prompt
		? `Smooth seamless motion transition from first frame to last frame, maintaining perfect character consistency throughout. ${PIXEL_ART_PRESERVE}. ${prompt}`
		: `${PIXEL_ART_PRESERVE}. subtle idle animation transition`;

	const numFrames = Math.max(81, Math.min(129, frameCount));

	// 1. Submit to fal.ai queue
	setProgress(jobId, { currentFrame: 0, totalFrames: frameCount, status: 'processing', message: 'Submitting to fal.ai FLF2V...' });

	const submitRes = await fetch(`https://queue.fal.run/${FAL_FLF_ENDPOINT}`, {
		method: 'POST',
		headers: {
			'Authorization': `Key ${FAL_KEY}`,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({
			prompt: enhancedPrompt,
			start_image_url: startImageUrl,
			end_image_url: endImageUrl,
			resolution: '720p',
			num_frames: numFrames,
			fps: fps,
			num_inference_steps: 30,
			flow_shift: 5.0,
			enable_prompt_expansion: true
		})
	});

	if (!submitRes.ok) {
		const errText = await submitRes.text();
		console.error('[FLF2V-fal] Submit error:', submitRes.status, errText);
		throw new Error(`fal.ai submit error (${submitRes.status}): ${errText}`);
	}

	const { request_id } = await submitRes.json();
	console.log('[FLF2V-fal] Queued, request_id:', request_id);

	// 2. Poll for completion
	let attempts = 0;
	const pollInterval = 2000;
	const maxAttempts = 150; // 5 minutes

	while (attempts < maxAttempts) {
		await new Promise(r => setTimeout(r, pollInterval));
		attempts++;

		const statusRes = await fetch(`https://queue.fal.run/${FAL_FLF_ENDPOINT}/requests/${request_id}/status`, {
			headers: { 'Authorization': `Key ${FAL_KEY}` }
		});

		if (!statusRes.ok) {
			console.warn('[FLF2V-fal] Status poll error:', statusRes.status);
			continue;
		}

		const status = await statusRes.json();
		const elapsed = Math.round(attempts * pollInterval / 1000);

		setProgress(jobId, {
			currentFrame: Math.min(Math.floor(attempts / 3), frameCount - 1),
			totalFrames: frameCount,
			status: 'processing',
			message: `fal.ai FLF2V: ${status.status}... (${elapsed}s)`
		});

		if (status.status === 'COMPLETED') {
			const resultRes = await fetch(`https://queue.fal.run/${FAL_FLF_ENDPOINT}/requests/${request_id}`, {
				headers: { 'Authorization': `Key ${FAL_KEY}` }
			});
			const result = await resultRes.json();

			const videoUrl = result?.video?.url;
			if (!videoUrl) {
				console.error('[FLF2V-fal] No video URL in result:', JSON.stringify(result).substring(0, 500));
				throw new Error('fal.ai returned no video URL');
			}

			console.log('[FLF2V-fal] Completed, video URL:', videoUrl);
			return videoUrl;
		}

		if (status.status === 'FAILED') {
			const errMsg = status.error || 'fal.ai interpolation failed';
			console.error('[FLF2V-fal] Failed:', errMsg);
			throw new Error(errMsg);
		}
	}

	throw new Error('fal.ai interpolation timed out after 5 minutes');
}


// ═══════════════════════════════════════════════════════════════════════════════
// Main async processor
// ═══════════════════════════════════════════════════════════════════════════════

async function processAnimationAsync(jobId, referenceImage, prompt, frameCount, motionAmount = 127, fps = 8, modelId = 'wan22', endImage = null) {
	const isInterpolation = !!endImage;
	
	const PIXEL_ART_PRESERVE = 'IMPORTANT: Maintain pixel art style, preserve crisp pixels, no smoothing, no blur, keep pixelated aesthetic';
	const enhancedPrompt = prompt ? `${PIXEL_ART_PRESERVE}. ${prompt}` : `${PIXEL_ART_PRESERVE}. subtle idle animation`;
	
	try {
		// ── Interpolation Mode (Start → End frame) ──────────────────────────
		if (isInterpolation) {
			const hasRunPod = !!env.RUNPOD_API_KEY && !!env.RUNPOD_ENDPOINT_ID;
			const hasFal = !!env.FAL_KEY;
			const backendName = hasRunPod ? 'RunPod FLF2V' : 'fal.ai FLF2V';
			console.log(`[Animation] Interpolation → ${backendName}`);

			let videoUrl;

			if (hasRunPod) {
				// ── Priority 1: RunPod Serverless + ComfyUI WAN 2.2 FLF2V ──
				videoUrl = await runRunPodFLF2V(jobId, referenceImage, endImage, prompt, frameCount, fps);
			} else if (hasFal) {
				// ── Priority 2: fal.ai FLF2V (hosted fallback) ──────────────
				setProgress(jobId, { currentFrame: 0, totalFrames: frameCount, status: 'processing', message: 'Uploading start & end frames...' });

				let startUrl = referenceImage;
				if (referenceImage.startsWith('data:')) {
					startUrl = await uploadImageToFirebase(referenceImage, `flf-start-${Date.now()}.png`);
				}
				let endUrl = endImage;
				if (endImage.startsWith('data:')) {
					endUrl = await uploadImageToFirebase(endImage, `flf-end-${Date.now()}.png`);
				}

				videoUrl = await runFalInterpolation(jobId, startUrl, endUrl, prompt, frameCount, fps);
			} else {
				throw new Error('No interpolation backend configured. Set RUNPOD_API_KEY + RUNPOD_ENDPOINT_ID, or FAL_KEY in .env');
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
			
			const response = await fetch('https://api.replicate.com/v1/predictions', {
				method: 'POST',
				headers: {
					'Authorization': `Token ${env.REPLICATE_API_TOKEN}`,
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					version: svdVersion.split(':')[1],
					input: {
						input_image: imageUrl,
						motion_bucket_id: motionAmount,
						fps: fps,
						num_frames: svdFrames
					}
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
			input = {
				prompt: enhancedPrompt,
				first_frame_image: imageUrl
			};
		} else if (modelId === 'ltxv') {
			input = {
				input_image: imageUrl,
				prompt: enhancedPrompt,
				num_frames: Math.min(65, frameCount * 3),
				guidance_scale: 7.5,
				motion_scale: 1.0
			};
		} else if (modelId === 'live2d') {
			input = {
				prompt: enhancedPrompt,
				first_frame_image: imageUrl
			};
		} else if (modelId === 'wan22') {
			const wanFrames = Math.min(121, Math.max(81, frameCount));
			input = {
				prompt: enhancedPrompt,
				image: imageUrl,
				num_frames: wanFrames,
				fps: fps
			};
		} else if (modelId === 'wan25') {
			input = {
				prompt: enhancedPrompt,
				image: imageUrl,
				max_area: '832x480',
				fast_mode: 'Disabled'
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
		const { referenceImage, endImage, prompt, pose, frameCount, motionAmount, fps, loop, model, interpolate } = await request.json();

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

		// Validate API keys based on mode
		if (isInterpolation) {
			const hasRunPod = !!env.RUNPOD_API_KEY && !!env.RUNPOD_ENDPOINT_ID;
			const hasFal = !!env.FAL_KEY;
			if (!hasRunPod && !hasFal) {
				return json({
					error: 'No interpolation backend configured. Set RUNPOD_API_KEY + RUNPOD_ENDPOINT_ID (preferred) or FAL_KEY in .env'
				}, { status: 500 });
			}
		} else {
			if (!env.REPLICATE_API_TOKEN) {
				return json({ error: 'Replicate API token not configured' }, { status: 500 });
			}
		}

		// Determine backend name for UI
		const interpolationBackend = (env.RUNPOD_API_KEY && env.RUNPOD_ENDPOINT_ID)
			? 'RunPod FLF2V'
			: 'fal.ai FLF2V';

		setProgress(jobId, {
			currentFrame: 0,
			totalFrames: numFrames,
			status: 'starting',
			message: isInterpolation
				? `Interpolating with ${interpolationBackend}...`
				: `Initializing ${selectedModel.name}...`
		});

		processAnimationAsync(jobId, referenceImage, prompt, numFrames, motionAmount || 127, fps || 8, modelId, isInterpolation ? endImage : null);

		return json({
			jobId,
			status: 'started',
			model: isInterpolation ? interpolationBackend : selectedModel.name,
			interpolate: isInterpolation
		});

	} catch (error) {
		console.error('API error:', error);
		return json({ error: error.message }, { status: 500 });
	}
}
