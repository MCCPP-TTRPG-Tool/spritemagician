import { json } from '@sveltejs/kit';
import {
	loadWorkflowTemplate,
	parseDataUrlImage,
	replaceTemplatePlaceholders,
	submitRunpodJob
} from '$lib/server/runpod.js';

export async function POST({ request, locals }) {
	try {
		if (!locals.user) {
			return json({ error: 'Authentication required' }, { status: 401 });
		}

		const {
			poseImage,
			referenceImage,
			depthImage = null,
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

		const workflowTemplate = await loadWorkflowTemplate();
		const replacements = {
			__PROMPT__: prompt,
			__NEGATIVE_PROMPT__: negativePrompt,
			__SEED__: Number(seed) || 0,
			__WIDTH__: Number(width) || 1024,
			__HEIGHT__: Number(height) || 1024,
			__POSE_IMAGE_BASE64__: pose.data,
			__POSE_MIME__: pose.mimeType,
			__REFERENCE_IMAGE_BASE64__: reference.data,
			__REFERENCE_MIME__: reference.mimeType,
			__DEPTH_IMAGE_BASE64__: depth?.data || '',
			__DEPTH_MIME__: depth?.mimeType || ''
		};

		const workflow = replaceTemplatePlaceholders(workflowTemplate, replacements);
		const runpodResponse = await submitRunpodJob({
			workflow,
			prompt,
			negative_prompt: negativePrompt,
			seed: Number(seed) || 0,
			width: Number(width) || 1024,
			height: Number(height) || 1024,
			pose_image: pose,
			reference_image: reference,
			depth_image: depth
		});

		return json({
			runpodId: runpodResponse.id,
			status: runpodResponse.status || 'IN_QUEUE'
		});
	} catch (error) {
		return json({ error: error.message || 'Failed to submit keyframe job' }, { status: 500 });
	}
}
