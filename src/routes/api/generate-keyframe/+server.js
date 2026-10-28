import { json } from '@sveltejs/kit';
import { inlineLocalInputs } from '$lib/server/localFiles.js';
import { createHash } from 'node:crypto';
import {
	loadWorkflowTemplate,
	parseDataUrlImage,
	replaceTemplatePlaceholders,
	resolveWorkflowTemplatePath,
	submitRunpodJob
} from '$lib/server/runpod.js';
import { approxJsonBytes, enforceRateLimit } from '$lib/server/security.js';
import { normalizeBoundedInt } from '$lib/server/validation.js';
import {
	beginIdempotentRequest,
	completeIdempotentRequest,
	failIdempotentRequest,
	makeRequestHash,
	registerRunpodJobOwnership,
	recordUsageEvent
} from '$lib/server/requestTracking.js';

const DEFAULT_NEGATIVE_PROMPT =
	'low quality, worst quality, blurry, out of frame, cropped, extra limbs, extra fingers, fused fingers, missing fingers, bad hands, bad anatomy, deformed body, duplicate body, mutated, disfigured, text, watermark, logo, background clutter';

export async function POST({ request, locals }) {
	let payloadBytes = 0;
	let idempotencyKey = null;
	let requestHash = null;
	try {
		if (!locals.user) {
			return json({ error: 'Authentication required' }, { status: 401 });
		}

		const {
			poseImage,
			referenceImage,
			depthImage = null,
			workflowFile = '',
			prompt,
			negativePrompt = '',
			seed = 0,
			width = 1024,
			height = 1024
		} = inlineLocalInputs(await request.json());
		const safeWidth = normalizeBoundedInt(width, 1024, 256, 2048);
		const safeHeight = normalizeBoundedInt(height, 1024, 256, 2048);
		const safePrompt = String(prompt || '').slice(0, 8000);
		const safeNegPrompt = String(negativePrompt || '').slice(0, 4000);
		const payload = {
			poseImage,
			referenceImage,
			depthImage,
			workflowFile,
			prompt: safePrompt,
			negativePrompt: safeNegPrompt,
			seed,
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
			routeKey: 'generate-keyframe',
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
				routeKey: 'generate-keyframe',
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

		if (!poseImage || !referenceImage || !safePrompt) {
			return json(
				{ error: 'poseImage, referenceImage, and prompt are required' },
				{ status: 400 }
			);
		}

		const pose = parseDataUrlImage(poseImage, 'poseImage');
		const reference = parseDataUrlImage(referenceImage, 'referenceImage');
		const depth = depthImage ? parseDataUrlImage(depthImage, 'depthImage') : null;
		const workflowPathOverride = String(workflowFile || '').trim();
		if (workflowPathOverride && !workflowPathOverride.toLowerCase().endsWith('.json')) {
			return json({ error: 'workflowFile must point to a .json file' }, { status: 400 });
		}

		const workflowTemplate = await loadWorkflowTemplate(workflowPathOverride);
		const workflowPath = resolveWorkflowTemplatePath(workflowPathOverride);
		const parsedSeed = Number(seed);
		const finalNegativePrompt = safeNegPrompt.trim()
			? `${DEFAULT_NEGATIVE_PROMPT}, ${safeNegPrompt.trim()}`
			: DEFAULT_NEGATIVE_PROMPT;
		// Avoid ambiguous "0 means random?" behavior by always submitting an explicit positive seed.
		const seedUsed =
			Number.isInteger(parsedSeed) && parsedSeed > 0
				? parsedSeed
				: Math.floor(Math.random() * 4294967295) + 1;

		const replacements = {
			__PROMPT__: safePrompt,
			__NEGATIVE_PROMPT__: finalNegativePrompt,
			__SEED__: seedUsed,
			__WIDTH__: safeWidth,
			__HEIGHT__: safeHeight,
			__POSE_FILENAME__: 'pose.png',
			__REFERENCE_FILENAME__: 'reference.png',
			__DEPTH_FILENAME__: depth ? 'depth.png' : 'pose.png',
			__DEPTH_STRENGTH__: depth ? 0.3 : 0.0,
			__POSE_IMAGE_BASE64__: pose.data,
			__POSE_MIME__: pose.mimeType,
			__REFERENCE_IMAGE_BASE64__: reference.data,
			__REFERENCE_MIME__: reference.mimeType,
			__DEPTH_IMAGE_BASE64__: depth?.data || '',
			__DEPTH_MIME__: depth?.mimeType || ''
		};

		const workflow = replaceTemplatePlaceholders(workflowTemplate, replacements);
		const workflowHash = createHash('sha256').update(JSON.stringify(workflow)).digest('hex').slice(0, 12);
		const runpodResponse = await submitRunpodJob({
			workflow,
			prompt: safePrompt,
			negative_prompt: finalNegativePrompt,
			seed: seedUsed,
			width: safeWidth,
			height: safeHeight,
			pose_image: pose,
			reference_image: reference,
			depth_image: depth
		});
		const runpodId = String(runpodResponse?.id || '').trim();
		if (!runpodId) {
			throw new Error('RunPod response missing job id');
		}
		await registerRunpodJobOwnership({
			uid: locals.user.uid,
			runpodId,
			routeKey: 'generate-keyframe',
			metadata: { workflowHash }
		});

		const responseBody = {
			runpodId,
			status: runpodResponse.status || 'IN_QUEUE',
			seedUsed,
			workflowHash,
			workflowPath
		};
		if (idempotencyKey) {
			await completeIdempotentRequest({
				uid: locals.user.uid,
				routeKey: 'generate-keyframe',
				idempotencyKey,
				requestHash,
				responseStatus: 200,
				responseBody
			});
		}
		await recordUsageEvent({
			uid: locals.user.uid,
			routeKey: 'generate-keyframe',
			provider: 'runpod',
			statusCode: 200,
			requestBytes: payloadBytes,
			metadata: { width: safeWidth, height: safeHeight, hasDepth: !!depthImage }
		});
		return json(responseBody);
	} catch (error) {
		if (idempotencyKey && requestHash && locals.user?.uid) {
			try {
				await failIdempotentRequest({
					uid: locals.user.uid,
					routeKey: 'generate-keyframe',
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
				routeKey: 'generate-keyframe',
				provider: 'runpod',
				success: false,
				statusCode: 500,
				requestBytes: payloadBytes,
				metadata: { error: String(error.message || 'unknown').slice(0, 200) }
			});
		}
		return json({ error: error.message || 'Failed to submit keyframe job' }, { status: 500 });
	}
}
