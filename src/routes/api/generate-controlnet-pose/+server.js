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
import { env } from '$lib/server/env.js';
import { resolveForProvider } from '$lib/server/localFiles.js';
import { approxJsonBytes, enforceRateLimit } from '$lib/server/security.js';
import { isDataUrl, normalizeBoundedInt } from '$lib/server/validation.js';
import {
	beginIdempotentRequest,
	completeIdempotentRequest,
	failIdempotentRequest,
	makeRequestHash,
	recordUsageEvent
} from '$lib/server/requestTracking.js';

export async function POST({ request, locals }) {
	let payloadBytes = 0;
	let idempotencyKey = null;
	let requestHash = null;
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
		const safePrompt = String(prompt || '').trim().slice(0, 4000);
		const safeName = String(characterName || '').trim().slice(0, 120);
		const safeWidth = normalizeBoundedInt(width, 512, 256, 1536);
		const safeHeight = normalizeBoundedInt(height, 512, 256, 1536);
		const safeNumSteps = normalizeBoundedInt(numSteps, 30, 10, 60);
		const rawControlnetScale = Number(controlnetScale);
		const safeControlnetScale = Number.isFinite(rawControlnetScale)
			? Math.max(0, Math.min(1.5, rawControlnetScale))
			: 0.8;
		const rawIpAdapterScale = Number(ipAdapterScale);
		const safeIpAdapterScale = Number.isFinite(rawIpAdapterScale)
			? Math.max(0, Math.min(1.5, rawIpAdapterScale))
			: 0.7;
		const payload = {
			characterImage,
			poseReference,
			prompt: safePrompt,
			characterName: safeName,
			controlnetScale: safeControlnetScale,
			ipAdapterScale: safeIpAdapterScale,
			numSteps: safeNumSteps,
			width: safeWidth,
			height: safeHeight
		};
		payloadBytes = approxJsonBytes(payload);
		idempotencyKey = request.headers.get('Idempotency-Key')?.trim() || null;
		requestHash = makeRequestHash(payload);
		if (payloadBytes > 12 * 1024 * 1024) {
			return json({ error: 'Request payload too large' }, { status: 413 });
		}
		const rate = enforceRateLimit({
			uid: locals.user.uid,
			routeKey: 'generate-controlnet-pose',
			maxRequests: 20,
			windowMs: 60_000
		});
		if (!rate.allowed) {
			return json(
				{ error: 'Rate limit exceeded. Please try again shortly.' },
				{ status: 429, headers: { 'Retry-After': String(rate.retryAfterSec) } }
			);
		}
		if (idempotencyKey) {
			const idempotency = await beginIdempotentRequest({
				uid: locals.user.uid,
				routeKey: 'generate-controlnet-pose',
				idempotencyKey,
				requestHash
			});
			if (idempotency.status === 'replay') {
				return json(idempotency.responseBody, { status: idempotency.responseStatus });
			}
			if (idempotency.status === 'processing') {
				return json(
					{ error: 'A request with this Idempotency-Key is already processing.' },
					{ status: 409 }
				);
			}
			if (idempotency.status === 'conflict') {
				return json(
					{ error: 'Idempotency-Key already used with different payload.' },
					{ status: 409 }
				);
			}
		}

		if (!characterImage) {
			return json({ error: 'Styled character image is required (IP-Adapter identity source)' }, { status: 400 });
		}
		if (!safePrompt && !poseReference) {
			return json({ error: 'Provide a pose description, a reference image, or both.' }, { status: 400 });
		}
		if (!isDataUrl(characterImage)) {
			return json({ error: 'characterImage must be a base64 data URL' }, { status: 400 });
		}
		if (poseReference && !isDataUrl(poseReference)) {
			return json({ error: 'poseReference must be a base64 data URL' }, { status: 400 });
		}

		const RUNPOD_API_KEY = env.RUNPOD_API_KEY;
		const POSE_ENDPOINT_ID = env.POSE_ENDPOINT_ID;

		if (!RUNPOD_API_KEY) {
			return json({ error: 'Pose generation needs a self-hosted RunPod pose endpoint. Add RUNPOD_API_KEY and POSE_ENDPOINT_ID in Settings (advanced).', code: 'MISSING_KEY', key: 'RUNPOD_API_KEY' }, { status: 412 });
		}
		if (!POSE_ENDPOINT_ID) {
			return json({ error: 'POSE_ENDPOINT_ID not configured. Deploy the pose handler to RunPod first.' }, { status: 500 });
		}

		console.log(`[Pose Gen] Generating pose for "${safeName}" via RunPod`);
		console.log(`[Pose Gen] Prompt: ${safePrompt || '(none)'}`);
		console.log(`[Pose Gen] Has pose reference: ${!!poseReference}`);

		// ── Upload images to Firebase for URLs ──
		console.log('[Pose Gen] Uploading character image...');
		const characterUrl = await resolveForProvider(characterImage);

		let poseReferenceUrl = null;
		if (poseReference) {
			console.log('[Pose Gen] Uploading pose reference...');
			poseReferenceUrl = await resolveForProvider(poseReference);
		}

		// ── Build prompt ──────────────────────────
		const stylePrompt = safePrompt || `${safeName || 'fantasy creature'} in a dynamic pose`;
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
						controlnet_scale: safeControlnetScale,
						ip_adapter_scale: safeIpAdapterScale,
						num_steps: safeNumSteps,
						guidance_scale: 7.5,
						width: safeWidth,
						height: safeHeight,
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

		console.log(`[Pose Gen] ✓ Pose generated for "${safeName}" in ${output.total_time || '?'}s`);

		const responseBody = {
			image: output.image,
			generationTime: output.generation_time,
			seed: output.seed,
		};
		if (idempotencyKey) {
			await completeIdempotentRequest({
				uid: locals.user.uid,
				routeKey: 'generate-controlnet-pose',
				idempotencyKey,
				requestHash,
				responseStatus: 200,
				responseBody
			});
		}
		await recordUsageEvent({
			uid: locals.user.uid,
			routeKey: 'generate-controlnet-pose',
			provider: 'runpod',
			statusCode: 200,
			requestBytes: payloadBytes,
			metadata: {
				width: safeWidth,
				height: safeHeight,
				hasPoseReference: !!poseReference
			}
		});
		return json(responseBody);

	} catch (error) {
		console.error('[Pose Gen] Error:', error);
		if (idempotencyKey && requestHash && locals.user?.uid) {
			try {
				await failIdempotentRequest({
					uid: locals.user.uid,
					routeKey: 'generate-controlnet-pose',
					idempotencyKey,
					requestHash,
					errorMessage: error.message
				});
			} catch {
				// best effort
			}
		}
		if (locals.user?.uid) {
			await recordUsageEvent({
				uid: locals.user.uid,
				routeKey: 'generate-controlnet-pose',
				provider: 'runpod',
				success: false,
				statusCode: 500,
				requestBytes: payloadBytes,
				metadata: { error: String(error.message || 'unknown').slice(0, 200) }
			});
		}
		return json({ error: error.message || 'Pose generation failed' }, { status: 500 });
	}
}
