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
import { env } from '$env/dynamic/private';
import { setProgress, clearProgress } from '$lib/utils/generationProgress.js';
import { uploadImageToFirebase } from '$lib/utils/firebaseStorage.js';

const WAN_SELF_HOSTED_URL = env.WAN_SELF_HOSTED_URL;
const RUNPOD_API_KEY = env.RUNPOD_API_KEY;

// Available models
const MODELS = {
	hailuo: {
		name: 'Hailuo 2.3 (Newest)',
		version: '23a02633b5a44780345a59d4d43f8bd510efa239c56f08f29639ff24fa6615e1',
		speed: 'fast'
	},
	ltxv: {
		name: 'LTX Video (Fastest)',
		version: '8c47da666861d081eeb4d1261853087de23923a268a69b63febdf5dc1dee08e4',
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
		} else if (modelId === 'wan25') {
			// Wan 2.5 I2V
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

		// Check if using self-hosted Wan 2.5
		if (modelId === 'wan25' && WAN_SELF_HOSTED_URL) {
			console.log('Using self-hosted Wan 2.5 endpoint:', WAN_SELF_HOSTED_URL);
			
			setProgress(jobId, {
				currentFrame: 0,
				totalFrames: frameCount,
				status: 'processing',
				message: 'Calling self-hosted Wan 2.5...'
			});

			// Determine if it's a RunPod endpoint ID or full URL
			let apiUrl = WAN_SELF_HOSTED_URL;
			let headers = {
				'Content-Type': 'application/json'
			};

			// If it's a RunPod endpoint ID (no http), construct the URL
			if (!WAN_SELF_HOSTED_URL.startsWith('http')) {
				if (!RUNPOD_API_KEY) {
					throw new Error('RUNPOD_API_KEY required for RunPod endpoints');
				}
				apiUrl = `https://api.runpod.ai/v2/${WAN_SELF_HOSTED_URL}/run`;
				headers['Authorization'] = `Bearer ${RUNPOD_API_KEY}`;
			}

			// Call self-hosted endpoint (RunPod format)
			const response = await fetch(apiUrl, {
				method: 'POST',
				headers: headers,
				body: JSON.stringify({
					input: {
						image: imageUrl,
						prompt: prompt || 'subtle motion',
						num_frames: Math.round(frameCount * 2.5)
					}
				})
			});

			if (!response.ok) {
				const errorText = await response.text();
				throw new Error(`Self-hosted API error: ${response.status} - ${errorText}`);
			}

			const jobResult = await response.json();
			
			// RunPod serverless can return sync (result) or async (job ID)
			// Our handler polls internally, so it should return sync, but handle both
			
			let videoUrl = null;
			
			// Check for async job ID
			if (jobResult.id && (jobResult.status === 'IN_QUEUE' || jobResult.status === 'IN_PROGRESS')) {
				// Async - poll RunPod for status
				const runpodJobId = jobResult.id;
				const endpointId = WAN_SELF_HOSTED_URL.startsWith('http') 
					? WAN_SELF_HOSTED_URL.split('/').slice(-2, -1)[0]
					: WAN_SELF_HOSTED_URL;
				
				let attempts = 0;
				const maxAttempts = 300;
				
				while (attempts < maxAttempts) {
					await new Promise(resolve => setTimeout(resolve, 2000));
					
					const statusUrl = `https://api.runpod.ai/v2/${endpointId}/status/${runpodJobId}`;
					const statusResponse = await fetch(statusUrl, {
						headers: headers
					});
					
					if (!statusResponse.ok) {
						throw new Error(`Status check failed: ${statusResponse.status}`);
					}
					
					const statusResult = await statusResponse.json();
					
					if (statusResult.status === 'COMPLETED') {
						const output = statusResult.output;
						videoUrl = output?.video || output?.videoUrl || output?.output;
						break;
					}
					
					if (statusResult.status === 'FAILED') {
						throw new Error(statusResult.error || 'Generation failed');
					}
					
					setProgress(jobId, {
						currentFrame: Math.min(Math.floor(attempts / 5), frameCount - 1),
						totalFrames: frameCount,
						status: 'processing',
						message: `Self-hosted: ${statusResult.status}... (${attempts * 2}s)`
					});
					
					attempts++;
				}
				
				if (!videoUrl) {
					throw new Error('Self-hosted generation timed out');
				}
			} else {
				// Sync - result returned directly (handler completed)
				const output = jobResult.output || jobResult;
				videoUrl = output?.video || output?.videoUrl || output?.output || jobResult.video;
				
				// Check for error in response
				if (jobResult.error) {
					throw new Error(jobResult.error);
				}
			}
			
			if (!videoUrl) {
				console.error('RunPod response:', jobResult);
				throw new Error('No video URL in response. Check RunPod logs.');
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

		// Use Replicate API
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

