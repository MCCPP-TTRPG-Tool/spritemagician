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
import { REPLICATE_API_TOKEN } from '$env/static/private';
import { setProgress, clearProgress } from '$lib/utils/generationProgress.js';
import { uploadImageToFirebase } from '$lib/utils/firebaseStorage.js';

// Available models
const MODELS = {
	live2d: {
		name: 'Video-01 Live (2D Animation)',
		version: '7574e16b8f1ad52c6332ecb264c0f132e555f46c222255a738131ec1bb614092',
		speed: 'fast'
	},
	wan25: {
		name: 'Wan 2.5 I2V',
		version: '1b29bbbbfdbc25bba2294de3acd2b58b82e5b623f183880cdb37d76133d80f00',
		speed: 'medium'
	},
	minimax: {
		name: 'Minimax Video-01',
		version: '5aa835260ff7f40f4069c41185f72036accf99e29957bb4a3b3a911f3b6c1912',
		speed: 'fast'
	},
	svd: {
		name: 'Stable Video Diffusion',
		version: '3f0457e4619daac51203dedb472816fd4af51f3149fa7a9e0b5ffcf1b8172438',
		speed: 'slow'
	}
};

/**
 * Process animation generation asynchronously
 */
async function processAnimationAsync(jobId, referenceImage, prompt, frameCount, motionAmount = 127, fps = 8, modelId = 'minimax') {
	const model = MODELS[modelId] || MODELS.minimax;
	
	try {
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
		
		if (modelId === 'live2d') {
			// Video-01 Live - designed for Live2D/animation
			input = {
				prompt: prompt || 'subtle idle animation, breathing',
				first_frame_image: imageUrl
			};
		} else if (modelId === 'wan25') {
			// Wan 2.5 I2V
			input = {
				prompt: prompt || 'subtle motion, minimal movement',
				image: imageUrl,
				max_area: '832x480', // 16:9 small
				fast_mode: 'Disabled'
			};
		} else if (modelId === 'minimax') {
			// Minimax Video-01 parameters
			input = {
				prompt: prompt || 'subtle motion, breathing, idle animation',
				first_frame_image: imageUrl
			};
		} else {
			// SVD parameters
			input = {
				input_image: imageUrl,
				frames_per_second: fps,
				sizing_strategy: 'maintain_aspect_ratio',
				motion_bucket_id: motionAmount,
				cond_aug: 0.02,
				decoding_t: 7,
				seed: Math.floor(Math.random() * 1000000)
			};
		}
		
		console.log(`${model.name} params:`, { fps, motionAmount, frameCount, modelId });

		// Start prediction
		const response = await fetch('https://api.replicate.com/v1/predictions', {
			method: 'POST',
			headers: {
				'Authorization': `Token ${REPLICATE_API_TOKEN}`,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				version: model.version,
				input: input
			})
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
					'Authorization': `Token ${REPLICATE_API_TOKEN}`
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

		if (!REPLICATE_API_TOKEN) {
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

