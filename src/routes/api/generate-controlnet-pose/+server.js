/**
 * ControlNet + IP-Adapter Pose Generation via RunPod
 * 
 * The "Digital Marionette":
 *   - ControlNet DWPose  → forces correct skeletal pose
 *   - IP-Adapter Plus    → locks character visual identity
 * 
 * Flow:
 *   1. Client sends: styled character image + skeleton image + prompt
 *   2. We upload both to Firebase for public URLs
 *   3. Call RunPod serverless endpoint (pose_handler.py)
 *   4. Poll for completion
 *   5. Return generated pose as base64
 * 
 * Env vars needed:
 *   RUNPOD_API_KEY          — RunPod API key
 *   POSE_ENDPOINT_ID        — RunPod endpoint ID for the pose handler
 */

import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { uploadImageToFirebase } from '$lib/utils/firebaseStorage.js';

export async function POST({ request, locals }) {
	try {
		if (!locals.user) {
			return json({ error: 'Authentication required' }, { status: 401 });
		}

		const {
			characterImage,    // base64 — the styled master character (identity source for IP-Adapter)
			skeletonImage,     // base64 — the target pose skeleton (for ControlNet)
			prompt,            // text prompt
			poseName,          // e.g. "Idle Stance"
			characterName,     // e.g. "Fire Dragon"
			controlnetScale,   // 0-1, default 0.8
			ipAdapterScale,    // 0-1, default 0.7
			numSteps,          // inference steps, default 30
			width,             // output width, default 512
			height,            // output height, default 512
		} = await request.json();

		if (!characterImage) {
			return json({ error: 'Styled character image is required (identity source for IP-Adapter)' }, { status: 400 });
		}
		if (!skeletonImage) {
			return json({ error: 'Skeleton pose image is required (for ControlNet)' }, { status: 400 });
		}

		const RUNPOD_API_KEY = env.RUNPOD_API_KEY;
		const POSE_ENDPOINT_ID = env.POSE_ENDPOINT_ID;

		if (!RUNPOD_API_KEY) {
			return json({ error: 'RUNPOD_API_KEY not configured' }, { status: 500 });
		}
		if (!POSE_ENDPOINT_ID) {
			return json({ error: 'POSE_ENDPOINT_ID not configured. Deploy the pose handler to RunPod first.' }, { status: 500 });
		}

		console.log(`[Pose Gen] Generating "${poseName}" for "${characterName}" via RunPod`);

		// ── Upload images to Firebase for public URLs ──
		// RunPod handler can accept base64 directly, but URLs are smaller payloads
		console.log('[Pose Gen] Uploading character image...');
		const characterUrl = await uploadImageToFirebase(
			characterImage,
			`pose-character-${Date.now()}.png`
		);

		console.log('[Pose Gen] Uploading skeleton image...');
		const skeletonUrl = await uploadImageToFirebase(
			skeletonImage,
			`pose-skeleton-${Date.now()}.png`
		);

		// ── Build prompt ──────────────────────────────
		const stylePrompt = prompt || [
			`${characterName || 'fantasy creature'} in ${poseName || 'idle'} pose,`,
			'HoMM3 style, pre-rendered 3D sprite, isometric game character,',
			'rich saturated colors, dramatic lighting from upper-left,',
			'smooth gradient shading, dark outlines,',
			'solid grey background, full body visible, 3/4 view facing right,',
			'game sprite, fantasy RPG character, extremely detailed',
		].join(' ');

		const negativePrompt = [
			'blurry, low quality, watermark, text, signature, logo,',
			'modern digital art, anime, cartoon, cel-shaded, flat colors,',
			'photo, realistic photograph, multiple characters,',
			'cropped, cut off, partial body, deformed, disfigured,',
			'extra limbs, missing limbs, bad anatomy',
		].join(' ');

		// ── Call RunPod ───────────────────────────────
		const runpodUrl = `https://api.runpod.ai/v2/${POSE_ENDPOINT_ID}/run`;

		console.log(`[Pose Gen] Calling RunPod endpoint: ${POSE_ENDPOINT_ID}`);

		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), 5 * 60 * 1000);

		let response;
		try {
			response = await fetch(runpodUrl, {
				method: 'POST',
				headers: {
					'Authorization': `Bearer ${RUNPOD_API_KEY}`,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					input: {
						character_image: characterUrl,
						skeleton_image: skeletonUrl,
						prompt: stylePrompt,
						negative_prompt: negativePrompt,
						controlnet_scale: controlnetScale ?? 0.8,
						ip_adapter_scale: ipAdapterScale ?? 0.7,
						num_steps: numSteps ?? 30,
						guidance_scale: 7.5,
						width: width ?? 512,
						height: height ?? 512,
						seed: -1,
					}
				}),
				signal: controller.signal,
			});
		} catch (fetchErr) {
			clearTimeout(timeoutId);
			if (fetchErr.name === 'AbortError') {
				return json({ error: 'Pose generation timed out after 5 minutes.' }, { status: 504 });
			}
			throw fetchErr;
		}

		if (!response.ok) {
			clearTimeout(timeoutId);
			const errorText = await response.text();
			console.error('[Pose Gen] RunPod error:', response.status, errorText);
			return json({
				error: `RunPod API error: ${response.status}`,
				details: errorText,
			}, { status: 500 });
		}

		const job = await response.json();
		const jobId = job.id;
		console.log(`[Pose Gen] RunPod job started: ${jobId}`);

		// ── Poll for completion ────────────────────────
		const statusUrl = `https://api.runpod.ai/v2/${POSE_ENDPOINT_ID}/status/${jobId}`;
		let result = job;
		let attempts = 0;
		const maxAttempts = 150; // 5 min at 2s intervals
		const pollInterval = 2000;

		while (
			(result.status === 'IN_QUEUE' || result.status === 'IN_PROGRESS') &&
			attempts < maxAttempts
		) {
			await new Promise(resolve => setTimeout(resolve, pollInterval));

			const statusResponse = await fetch(statusUrl, {
				headers: { 'Authorization': `Bearer ${RUNPOD_API_KEY}` },
			});

			result = await statusResponse.json();
			attempts++;

			if (attempts % 10 === 0) {
				console.log(`[Pose Gen] Status: ${result.status} (${attempts * 2}s)`);
			}
		}

		clearTimeout(timeoutId);

		// ── Handle result ─────────────────────────────
		if (result.status === 'FAILED') {
			console.error('[Pose Gen] RunPod job failed:', result.output?.error || result.error);
			return json({
				error: 'Pose generation failed',
				details: result.output?.error || result.error || 'Unknown error',
			}, { status: 500 });
		}

		if (result.status !== 'COMPLETED') {
			return json({ error: `Pose generation timed out (status: ${result.status})` }, { status: 504 });
		}

		const output = result.output;

		if (!output?.image) {
			console.error('[Pose Gen] No image in output:', JSON.stringify(output).slice(0, 500));
			return json({ error: 'No image returned from pose generator' }, { status: 500 });
		}

		console.log(`[Pose Gen] ✓ Generated pose "${poseName}" for "${characterName}" in ${output.total_time || '?'}s`);

		return json({
			image: output.image,
			generationTime: output.generation_time,
			seed: output.seed,
		});

	} catch (error) {
		console.error('[Pose Gen] Error:', error);
		if (error.name === 'AbortError') {
			return json({ error: 'Request timed out.' }, { status: 504 });
		}
		return json({ error: error.message }, { status: 500 });
	}
}
