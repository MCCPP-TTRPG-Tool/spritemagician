// In-memory progress store (in production, use Redis or similar)
const progressStore = new Map();

/**
 * Set generation progress
 */
export function setProgress(jobId, progressData) {
	progressStore.set(jobId, {
		...progressData,
		updatedAt: Date.now()
	});
}

/**
 * Get generation progress
 */
export function getProgress(jobId) {
	return progressStore.get(jobId);
}

/**
 * Clear progress after completion
 */
export function clearProgress(jobId) {
	progressStore.delete(jobId);
}

