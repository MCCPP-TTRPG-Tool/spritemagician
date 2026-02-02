import { json } from '@sveltejs/kit';
import { getProgress } from '$lib/utils/generationProgress.js';

/**
 * Get generation progress
 */
export async function GET({ url }) {
	const jobId = url.searchParams.get('jobId');
	if (!jobId) {
		return json({ error: 'jobId required' }, { status: 400 });
	}

	const progress = getProgress(jobId);
	if (!progress) {
		return json({ error: 'Job not found' }, { status: 404 });
	}

	return json(progress);
}

