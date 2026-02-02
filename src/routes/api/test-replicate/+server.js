/**
 * Test endpoint for Replicate model integration
 * 
 * Models we need to test:
 * 1. IP-Adapter - for character consistency
 * 2. ControlNet OpenPose - for pose-guided generation
 * 3. SDXL base - for image generation
 */

import { json } from '@sveltejs/kit';
import { REPLICATE_API_TOKEN } from '$env/static/private';

// Known working models on Replicate
const MODELS = {
	// IP-Adapter for character consistency - uses reference image to maintain identity
	ipAdapter: 'lucataco/ip-adapter-faceid:9ba39696b015ff40a77a3f9e225ab30bc0ec71987e1b92c3bd97f0ce6fd69e87',
	
	// ControlNet with OpenPose for pose guidance
	controlnetPose: 'rossjillian/controlnet:795433b19458d0f4fa172a7ccf93178d2adb1cb8ab2ad6c8fdc33fdbcd49f477',
	
	// SDXL for base generation
	sdxl: 'stability-ai/sdxl:39ed52f2a78e934b3ba6e2a89f5b1c712de7dfea535525255b1aa35c5565e08b',
	
	// AnimateDiff for video-based animation
	animateDiff: 'lucataco/animate-diff:beecf59c4aee8d81bf04f0381033dfa10dc16e845b4ae00d281e2fa377e48a9f'
};

/**
 * Test Replicate API connection and model availability
 */
export async function GET() {
	if (!REPLICATE_API_TOKEN) {
		return json({ error: 'REPLICATE_API_TOKEN not configured' }, { status: 500 });
	}
	
	const results = {
		apiConnected: false,
		models: {}
	};
	
	try {
		// Test API connection
		const response = await fetch('https://api.replicate.com/v1/models', {
			headers: {
				'Authorization': `Token ${REPLICATE_API_TOKEN}`
			}
		});
		
		results.apiConnected = response.ok;
		
		if (!response.ok) {
			const error = await response.text();
			return json({ error: `API connection failed: ${error}` }, { status: 500 });
		}
		
		// Test each model availability by getting its info
		for (const [name, modelVersion] of Object.entries(MODELS)) {
			try {
				// Extract model name from version string
				const [modelPath] = modelVersion.split(':');
				
				const modelResponse = await fetch(`https://api.replicate.com/v1/models/${modelPath}`, {
					headers: {
						'Authorization': `Token ${REPLICATE_API_TOKEN}`
					}
				});
				
				if (modelResponse.ok) {
					const modelData = await modelResponse.json();
					results.models[name] = {
						available: true,
						name: modelData.name,
						description: modelData.description?.substring(0, 100),
						version: modelVersion.split(':')[1]?.substring(0, 12) + '...'
					};
				} else {
					results.models[name] = {
						available: false,
						error: `HTTP ${modelResponse.status}`
					};
				}
			} catch (error) {
				results.models[name] = {
					available: false,
					error: error.message
				};
			}
		}
		
		return json(results);
		
	} catch (error) {
		return json({ error: error.message }, { status: 500 });
	}
}

/**
 * Test generation with a specific model
 */
export async function POST({ request }) {
	if (!REPLICATE_API_TOKEN) {
		return json({ error: 'REPLICATE_API_TOKEN not configured' }, { status: 500 });
	}
	
	try {
		const { model, input } = await request.json();
		
		if (!model || !MODELS[model]) {
			return json({ 
				error: `Invalid model. Available: ${Object.keys(MODELS).join(', ')}` 
			}, { status: 400 });
		}
		
		const version = MODELS[model].split(':')[1];
		
		// Start prediction
		const response = await fetch('https://api.replicate.com/v1/predictions', {
			method: 'POST',
			headers: {
				'Authorization': `Token ${REPLICATE_API_TOKEN}`,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				version: version,
				input: input
			})
		});
		
		if (!response.ok) {
			const error = await response.text();
			return json({ error: `Prediction failed: ${error}` }, { status: 500 });
		}
		
		const prediction = await response.json();
		
		// Poll for completion
		let result = prediction;
		let attempts = 0;
		const maxAttempts = 120;
		
		while ((result.status === 'starting' || result.status === 'processing') && attempts < maxAttempts) {
			await new Promise(resolve => setTimeout(resolve, 1000));
			
			const statusResponse = await fetch(`https://api.replicate.com/v1/predictions/${result.id}`, {
				headers: {
					'Authorization': `Token ${REPLICATE_API_TOKEN}`
				}
			});
			
			result = await statusResponse.json();
			attempts++;
		}
		
		if (result.status === 'failed') {
			return json({ error: result.error || 'Prediction failed' }, { status: 500 });
		}
		
		if (result.status !== 'succeeded') {
			return json({ error: 'Prediction timed out' }, { status: 500 });
		}
		
		return json({
			success: true,
			output: result.output,
			metrics: result.metrics
		});
		
	} catch (error) {
		return json({ error: error.message }, { status: 500 });
	}
}

