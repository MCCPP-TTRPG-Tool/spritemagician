import { json } from '@sveltejs/kit';
import { REPLICATE_API_TOKEN } from '$env/static/private';

/**
 * List available image-to-video models on Replicate
 */
export async function GET() {
	const models = [
		// Current models
		{
			id: 'video01live',
			name: 'Minimax Video-01 Live',
			model: 'minimax/video-01-live',
			version: null,
			speed: 'Fast (20-40s)',
			quality: 'High',
			consistency: 'Excellent',
			notes: 'Designed for Live2D/animation'
		},
		{
			id: 'wan25',
			name: 'Wan 2.5 I2V',
			model: 'wan-video/wan-2.5-i2v',
			version: null,
			speed: 'Medium (30-60s)',
			quality: 'High',
			consistency: 'Good',
			notes: 'Alibaba latest model'
		},
		// New models to try
		{
			id: 'hailuo',
			name: 'Hailuo 2.3',
			model: 'minimax/hailuo-2.3',
			version: null,
			speed: 'Fast (20-40s)',
			quality: 'Very High',
			consistency: 'Excellent',
			notes: 'Newest Minimax model'
		},
		{
			id: 'ltxv',
			name: 'LTX Video',
			model: 'lightricks/ltx-video',
			version: null,
			speed: 'Fast (15-30s)',
			quality: 'High',
			consistency: 'Good',
			notes: 'Lightricks fast video'
		},
		{
			id: 'cogvideox',
			name: 'CogVideoX-5B I2V',
			model: 'fofr/cogvideox-5b',
			version: null,
			speed: 'Medium (30-60s)',
			quality: 'Very High',
			consistency: 'Excellent',
			notes: 'Character consistency focused'
		},
		{
			id: 'animatediff',
			name: 'AnimateDiff Lightning',
			model: 'lucataco/animate-diff-lightning',
			version: null,
			speed: 'Fast (10-20s)',
			quality: 'Medium',
			consistency: 'Good',
			notes: 'Fast animation generation'
		},
		{
			id: 'svd',
			name: 'Stable Video Diffusion',
			model: 'stability-ai/stable-video-diffusion',
			version: '3f0457e4619daac51203dedb472816fd4af51f3149fa7a9e0b5ffcf1b8172438',
			speed: 'Slow (1-2 min)',
			quality: 'High',
			consistency: 'Good',
			notes: 'Reliable fallback'
		}
	];

	// Try to verify which models are available
	const availableModels = [];
	
	for (const model of models) {
		try {
			const response = await fetch(`https://api.replicate.com/v1/models/${model.model}`, {
				headers: {
					'Authorization': `Token ${REPLICATE_API_TOKEN}`
				}
			});
			
			if (response.ok) {
				const data = await response.json();
				availableModels.push({
					...model,
					available: true,
					latestVersion: data.latest_version?.id || model.version,
					runs: data.run_count
				});
			} else {
				availableModels.push({
					...model,
					available: false,
					error: response.status
				});
			}
		} catch (error) {
			availableModels.push({
				...model,
				available: false,
				error: error.message
			});
		}
	}

	return json({
		models: availableModels,
		recommendation: 'For sprites, try CogVideoX or Minimax for best character consistency. SVD is reliable but slower.'
	});
}

