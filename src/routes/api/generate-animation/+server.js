/**
 * Image to Video generation with multiple model options
 * 
 * Models:
 * - Minimax Video-01: Faster, better consistency
 * - SVD: Slower but reliable
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

const WAN_SELF_HOSTED_URL = env.WAN_SELF_HOSTED_URL;
const RUNPOD_API_KEY = env.RUNPOD_API_KEY;

// Available models
// Pricing estimates (check replicate.com for current):
// - Wan 2.2 Fast: ~$0.01-0.03 (optimized, cheapest)
// - LTX Video: ~$0.02-0.05 (fast)
// - Hailuo: ~$0.05-0.10 (quality)
// - SVD: ~$0.10-0.15 (slow, expensive)
const MODELS = {
	wan22: {
		name: 'Wan 2.2 Fast (Cheapest)',
		version: 'wan-video/wan-2.2-i2v-fast',
		speed: 'fast',
		isModelPath: true  // Use model path instead of version hash
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

/**
 * Process animation generation asynchronously
 */
async function processAnimationAsync(jobId, referenceImage, prompt, frameCount, motionAmount = 127, fps = 8, modelId = 'minimax') {
	const model = MODELS[modelId] || MODELS.minimax;
	
	try {
		// SVD uses Replicate API
		if (modelId === 'svd') {
			console.log('Using Replicate SVD API');
			
			setProgress(jobId, {
				currentFrame: 0,
				totalFrames: frameCount,
				status: 'processing',
				message: 'Uploading image for SVD...'
			});

			// Upload image to Firebase to get a public URL
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

			// Call Replicate SVD API
			// SVD supports up to 25 frames - for longer animations, we max it out
			const svdVersion = MODELS.svd.version;
			const svdFrames = Math.min(25, Math.max(14, frameCount)); // 14-25 frames
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

			// Poll for completion
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

		// Upload reference image to Firebase to get a public URL
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
			// Hailuo 2.3 - newest Minimax model
			input = {
				prompt: prompt || 'subtle idle animation',
				first_frame_image: imageUrl
			};
		} else if (modelId === 'ltxv') {
			// LTX Video - Lightricks fast video
			// Note: LTX may not support prompts well, try with motion emphasis
			input = {
				input_image: imageUrl,
				prompt: prompt || 'subtle breathing animation, gentle motion, idle stance',
				num_frames: Math.min(65, frameCount * 3), // Match desired frame count
				guidance_scale: 7.5, // Higher for more motion
				motion_scale: 1.0 // Explicit motion parameter if supported
			};
		} else if (modelId === 'live2d') {
			// Video-01 Live - designed for Live2D/animation
			input = {
				prompt: prompt || 'subtle idle animation, breathing',
				first_frame_image: imageUrl
			};
		} else if (modelId === 'wan22') {
			// Wan 2.2 i2v-fast - PrunaAI optimized, cheapest option
			// Frame range: 81-121
			const wanFrames = Math.min(121, Math.max(81, frameCount));
			input = {
				prompt: prompt || 'subtle motion, minimal movement',
				image: imageUrl,
				num_frames: wanFrames,
				fps: fps
			};
		} else if (modelId === 'wan25') {
			// Wan 2.5 I2V (for Replicate, not self-hosted)
			input = {
				prompt: prompt || 'subtle motion, minimal movement',
				image: imageUrl,
				max_area: '832x480',
				fast_mode: 'Disabled'
			};
		} else {
			// Default/fallback
			input = {
				prompt: prompt || 'subtle motion',
				first_frame_image: imageUrl
			};
		}
		
		console.log(`${model.name} params:`, { fps, motionAmount, frameCount, modelId });

		// Use Replicate API - different endpoints for model path vs version hash
		let apiUrl, body;
		
		if (model.isModelPath) {
			// Model path format: owner/model-name
			apiUrl = `https://api.replicate.com/v1/models/${model.version}/predictions`;
			body = JSON.stringify({ input });
		} else {
			// Version hash format
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
		
		// Poll for completion - Minimax is faster, adjust polling accordingly
		let result = prediction;
		let attempts = 0;
		const pollInterval = model.speed === 'fast' ? 1500 : 2000;
		const maxAttempts = model.speed === 'fast' ? 120 : 300; // 3 min for fast, 10 min for slow

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

		// Result is a video URL (mp4)
		const videoUrl = result.output;
		console.log(`${model.name} completed, video URL:`, videoUrl);
		
		setProgress(jobId, {
			currentFrame: frameCount,
			totalFrames: frameCount,
			status: 'completed',
			message: 'Video generated! Extracting frames...',
			videoUrl: videoUrl,
			loop: true, // Signal to client to make loopable
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
		const { referenceImage, prompt, pose, frameCount, motionAmount, fps, loop, model } = await request.json();

		if (!referenceImage) {
			return json({ error: 'Reference image is required. Upload an image first.' }, { status: 400 });
		}

		if (!env.REPLICATE_API_TOKEN) {
			return json({ error: 'Replicate API token not configured' }, { status: 500 });
		}

		const numFrames = frameCount || 8;
		const modelId = model || 'minimax'; // Default to Minimax for speed
		const selectedModel = MODELS[modelId] || MODELS.minimax;

		// Initialize progress
		setProgress(jobId, {
			currentFrame: 0,
			totalFrames: numFrames,
			status: 'starting',
			message: `Initializing ${selectedModel.name}...`
		});

		// Start async processing
		processAnimationAsync(jobId, referenceImage, prompt, numFrames, motionAmount || 127, fps || 8, modelId);

		return json({ jobId, status: 'started', model: selectedModel.name });

	} catch (error) {
		console.error('API error:', error);
		return json({ error: error.message }, { status: 500 });
	}
}

