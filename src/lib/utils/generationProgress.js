// In-memory progress store (in production, use Redis or similar)
const progressStore = new Map();
const progressOwnerStore = new Map();

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
	progressOwnerStore.delete(jobId);
}

/**
 * Bind a job id to an owning uid for secure progress polling.
 */
export function setProgressOwner(jobId, uid) {
	if (!jobId || !uid) return;
	progressOwnerStore.set(jobId, uid);
}

/**
 * Check whether a uid owns the given job id.
 */
export function isProgressOwner(jobId, uid) {
	if (!jobId || !uid) return false;
	return progressOwnerStore.get(jobId) === uid;
}

