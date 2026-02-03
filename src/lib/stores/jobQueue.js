import { writable } from 'svelte/store';

// Job statuses: 'pending', 'processing', 'completed', 'failed', 'cancelled'
const createJobQueueStore = () => {
	const { subscribe, set, update } = writable([]);

	return {
		subscribe,
		
		// Add a new job to the queue
		addJob: (job) => {
			const newJob = {
				id: `job-${Date.now()}-${Math.random().toString(36).substring(7)}`,
				createdAt: new Date(),
				status: 'pending',
				progress: 0,
				...job
			};
			update(jobs => [newJob, ...jobs]);
			return newJob.id;
		},
		
		// Update job status/progress
		updateJob: (jobId, updates) => {
			update(jobs => jobs.map(job => 
				job.id === jobId ? { ...job, ...updates } : job
			));
		},
		
		// Mark job as completed
		completeJob: (jobId, result = null) => {
			update(jobs => jobs.map(job => 
				job.id === jobId ? { ...job, status: 'completed', progress: 100, result, completedAt: new Date() } : job
			));
		},
		
		// Mark job as failed
		failJob: (jobId, error) => {
			update(jobs => jobs.map(job => 
				job.id === jobId ? { ...job, status: 'failed', error, completedAt: new Date() } : job
			));
		},
		
		// Cancel a job
		cancelJob: (jobId) => {
			update(jobs => jobs.map(job => 
				job.id === jobId ? { ...job, status: 'cancelled', completedAt: new Date() } : job
			));
		},
		
		// Remove a job from the queue
		removeJob: (jobId) => {
			update(jobs => jobs.filter(job => job.id !== jobId));
		},
		
		// Clear completed/failed jobs
		clearFinished: () => {
			update(jobs => jobs.filter(job => job.status === 'pending' || job.status === 'processing'));
		},
		
		// Clear all jobs
		clearAll: () => {
			set([]);
		}
	};
};

export const jobQueue = createJobQueueStore();
