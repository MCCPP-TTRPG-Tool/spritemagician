import { json } from '@sveltejs/kit';
import {
	extractFirstImageDataUrl,
	extractFirstImageUrl,
	getRunpodJobStatus,
	normalizeRunpodStatus
} from '$lib/server/runpod.js';

export async function GET({ url, locals }) {
	try {
		if (!locals.user) {
			return json({ error: 'Authentication required' }, { status: 401 });
		}

		const runpodId = url.searchParams.get('runpodId');
		if (!runpodId) {
			return json({ error: 'runpodId is required' }, { status: 400 });
		}

		const data = await getRunpodJobStatus(runpodId);
		const normalized = normalizeRunpodStatus(data.status);
		const imageUrl = normalized === 'completed' ? extractFirstImageUrl(data.output) : null;
		const imageDataUrl = normalized === 'completed' ? extractFirstImageDataUrl(data.output) : null;

		return json({
			status: normalized,
			runpodStatus: data.status || null,
			delayTime: data.delayTime || null,
			executionTime: data.executionTime || null,
			imageUrl,
			imageDataUrl,
			error: data.error || null,
			raw: normalized === 'failed' ? data : undefined
		});
	} catch (error) {
		return json({ error: error.message || 'Failed to fetch keyframe status' }, { status: 500 });
	}
}
