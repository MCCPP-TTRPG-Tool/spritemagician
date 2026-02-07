/**
 * ControlNet + IP-Adapter Pose Generation via RunPod
 * 
 * Flow:
 *   1. Client sends: styled character image + text prompt + optional pose reference
 *   2. We upload images to Firebase for URLs
 *   3. RunPod handler:
 *      - IP-Adapter locks character identity from the styled image
 *      - If pose reference provided: DWPose extracts skeleton → ControlNet enforces pose
 *      - If no reference: IP-Adapter + text prompt only
 *   4. Poll for completion
 *   5. Return generated pose as base64
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
			characterImage,    // base64 — styled master character (IP-Adapter identity source)
			poseReference,     // base64 — optional reference image to extract pose from (DWPose)
			prompt,            // text — what pose the character should be in
			characterName,     // e.g. "Fire Dragon"
			controlnetScale,   // 0-1, default 0.8
			ipAdapterScale,    // 0-1, default 0.7
			numSteps,          // inference steps, default 30
			width,             // output width, default 512
			height,            // output height, default 512
		} = await request.json();

		if (!characterImage) {
			return json({ error: 'Styled character image is required (IP-Adapter identity source)' }, { status: 400 });
		}
		if (!prompt && !poseReference) {
			return json({ error: 'Provide a pose description, a reference image, or both.' }, { status: 400 });
		}

		const RUNPOD_API_KEY = env.RUNPOD_API_KEY;
		const POSE_ENDPOINT_ID = env.POSE_ENDPOINT_ID;

		if (!RUNPOD_API_KEY) {
			return json({ error: 'RUNPOD_API_KEY not configured' }, { status: 500 });
		}
		if (!POSE_ENDPOINT_ID) {
			return json({ error: 'POSE_ENDPOINT_ID not configured. Deploy the pose handler to RunPod first.' }, { status: 500 });
		}

		console.log(`[Pose Gen] Generating pose for "${characterName}" via RunPod`);
		console.log(`[Pose Gen] Prompt: ${prompt || '(none)'}`);
		console.log(`[Pose Gen] Has pose reference: ${!!poseReference}`);

		// ── Upload images to Firebase for URLs ──
		console.log('[Pose Gen] Uploading character image...');
		const characterUrl = await uploadImageToFirebase(
			characterImage,
			`pose-character-${Date.now()}.png`
		);

		let poseReferenceUrl = null;
		if (poseReference) {
			console.log('[Pose Gen] Uploading pose reference...');
			poseReferenceUrl = await uploadImageToFirebase(
				poseReference,
				`pose-reference-${Date.now()}.png`
			);
		}

		// ── Build prompt ──────────────────────────
		const stylePrompt = prompt || `${characterName || 'fantasy creature'} in a dynamic pose`;
		const fullPrompt = [
			stylePrompt + ',',
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

		// ── Call RunPod ───────────────────────────
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
						pose_reference: poseReferenceUrl,  // null if no reference
						prompt: fullPrompt,
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
			return json({ error: `RunPod API error: ${response.status}`, details: errorText }, { status: 500 });
		}

		const job = await response.json();
		const jobId = job.id;
		console.log(`[Pose Gen] RunPod job started: ${jobId}`);

		// ── Poll for completion ──────────────────
		const statusUrl = `https://api.runpod.ai/v2/${POSE_ENDPOINT_ID}/status/${jobId}`;
		let result = job;
		let attempts = 0;
		const maxAttempts = 150;

		while (
			(result.status === 'IN_QUEUE' || result.status === 'IN_PROGRESS') &&
			attempts < maxAttempts
		) {
			await new Promise(resolve => setTimeout(resolve, 2000));
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

		console.log(`[Pose Gen] ✓ Pose generated for "${characterName}" in ${output.total_time || '?'}s`);

		return json({
			image: output.image,
			generationTime: output.generation_time,
			seed: output.seed,
		});

	} catch (error) {
		console.error('[Pose Gen] Error:', error);
		return json({ error: error.message }, { status: 500 });
	}
}
