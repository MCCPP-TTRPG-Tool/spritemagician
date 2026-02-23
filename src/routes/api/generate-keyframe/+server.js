import { json } from '@sveltejs/kit';
import { createHash } from 'node:crypto';
import {
	loadWorkflowTemplate,
	parseDataUrlImage,
	replaceTemplatePlaceholders,
	resolveWorkflowTemplatePath,
	submitRunpodJob
} from '$lib/server/runpod.js';

const DEFAULT_NEGATIVE_PROMPT =
	'low quality, worst quality, blurry, out of frame, cropped, extra limbs, extra fingers, fused fingers, missing fingers, bad hands, bad anatomy, deformed body, duplicate body, mutated, disfigured, text, watermark, logo, background clutter';

export async function POST({ request, locals }) {
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
		} = await request.json();

		if (!poseImage || !referenceImage || !prompt) {
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
		const finalNegativePrompt = negativePrompt?.trim()
			? `${DEFAULT_NEGATIVE_PROMPT}, ${negativePrompt.trim()}`
			: DEFAULT_NEGATIVE_PROMPT;
		// Avoid ambiguous "0 means random?" behavior by always submitting an explicit positive seed.
		const seedUsed =
			Number.isInteger(parsedSeed) && parsedSeed > 0
				? parsedSeed
				: Math.floor(Math.random() * 4294967295) + 1;

		const replacements = {
			__PROMPT__: prompt,
			__NEGATIVE_PROMPT__: finalNegativePrompt,
			__SEED__: seedUsed,
			__WIDTH__: Number(width) || 1024,
			__HEIGHT__: Number(height) || 1024,
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
			prompt,
			negative_prompt: finalNegativePrompt,
			seed: seedUsed,
			width: Number(width) || 1024,
			height: Number(height) || 1024,
			pose_image: pose,
			reference_image: reference,
			depth_image: depth
		});

		return json({
			runpodId: runpodResponse.id,
			status: runpodResponse.status || 'IN_QUEUE',
			seedUsed,
			workflowHash,
			workflowPath
		});
	} catch (error) {
		return json({ error: error.message || 'Failed to submit keyframe job' }, { status: 500 });
	}
}
