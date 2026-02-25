/**
 * Load project from Firebase Storage
 */

import { json } from '@sveltejs/kit';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getStorage } from 'firebase-admin/storage';
import { env } from '$env/dynamic/private';
import { approxJsonBytes, enforceRateLimit } from '$lib/server/security.js';
import { recordUsageEvent } from '$lib/server/requestTracking.js';

function initFirebase() {
	if (getApps().length === 0) {
		initializeApp({
			credential: cert({
				projectId: env.FIREBASE_PROJECT_ID,
				clientEmail: env.FIREBASE_CLIENT_EMAIL,
				privateKey: env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
			}),
			storageBucket: env.FIREBASE_STORAGE_BUCKET || `${env.FIREBASE_PROJECT_ID}.firebasestorage.app`
		});
	}
	return getStorage().bucket();
}

export async function GET({ url, locals }) {
	let requestBytes = 0;
	try {
		if (!locals.user) {
			return json({ error: 'Authentication required' }, { status: 401 });
		}
		requestBytes = approxJsonBytes({ projectId: url.searchParams.get('projectId') });
		const rate = enforceRateLimit({
			uid: locals.user.uid,
			routeKey: 'load-project:get',
			maxRequests: 60,
			windowMs: 60_000
		});
		if (!rate.allowed) {
			return json(
				{ error: 'Rate limit exceeded. Please try again shortly.' },
				{ status: 429, headers: { 'Retry-After': String(rate.retryAfterSec) } }
			);
		}

		const projectId = url.searchParams.get('projectId');
		
		if (!projectId) {
			return json({ error: 'projectId required' }, { status: 400 });
		}
		if (!/^[a-zA-Z0-9_-]{1,128}$/.test(projectId)) {
			return json({ error: 'Invalid projectId format' }, { status: 400 });
		}

		const bucket = initFirebase();
		const projectPath = `users/${locals.user.uid}/projects/${projectId}/project.json`;

		// Load project metadata
		const file = bucket.file(projectPath);
		const [exists] = await file.exists();
		
		if (!exists) {
			// Legacy fallback (pre-user-scoped project path) only if ownerUid matches.
			const legacyPath = `projects/${projectId}/project.json`;
			const legacyFile = bucket.file(legacyPath);
			const [legacyExists] = await legacyFile.exists();
			if (!legacyExists) {
				return json({ error: 'Project not found' }, { status: 404 });
			}
			const [legacyContents] = await legacyFile.download();
			const legacyData = JSON.parse(legacyContents.toString());
			if (legacyData?.ownerUid !== locals.user.uid) {
				return json({ error: 'Project not found' }, { status: 404 });
			}
			const legacyFrames = Array.isArray(legacyData.frameUrls) ? legacyData.frameUrls : [];
			await recordUsageEvent({
				uid: locals.user.uid,
				routeKey: 'load-project:get',
				provider: 'firebase',
				statusCode: 200,
				requestBytes,
				metadata: { projectId, legacy: true }
			});
			return json({
				...legacyData,
				frames: legacyFrames
			});
		}

		const [contents] = await file.download();
		const projectData = JSON.parse(contents.toString());
		if (projectData?.ownerUid && projectData.ownerUid !== locals.user.uid) {
			return json({ error: 'Project not found' }, { status: 404 });
		}

		// Load frames from URLs (they're already public URLs)
		const frames = projectData.frameUrls || [];
		await recordUsageEvent({
			uid: locals.user.uid,
			routeKey: 'load-project:get',
			provider: 'firebase',
			statusCode: 200,
			requestBytes,
			metadata: { projectId, frameCount: Array.isArray(frames) ? frames.length : 0 }
		});

		return json({
			...projectData,
			frames // Return frames as URLs
		});

	} catch (error) {
		console.error('Load project error:', error);
		if (locals.user?.uid) {
			await recordUsageEvent({
				uid: locals.user.uid,
				routeKey: 'load-project:get',
				provider: 'firebase',
				success: false,
				statusCode: 500,
				requestBytes,
				metadata: { error: String(error.message || 'unknown').slice(0, 200) }
			});
		}
		return json({ error: error.message || 'Failed to load project' }, { status: 500 });
	}
}

/**
 * List all saved projects
 */
export async function POST({ locals }) {
	let requestBytes = 0;
	try {
		if (!locals.user) {
			return json({ error: 'Authentication required' }, { status: 401 });
		}
		requestBytes = approxJsonBytes({ action: 'list-projects' });
		const rate = enforceRateLimit({
			uid: locals.user.uid,
			routeKey: 'load-project:list',
			maxRequests: 60,
			windowMs: 60_000
		});
		if (!rate.allowed) {
			return json(
				{ error: 'Rate limit exceeded. Please try again shortly.' },
				{ status: 429, headers: { 'Retry-After': String(rate.retryAfterSec) } }
			);
		}

		const bucket = initFirebase();
		const [files] = await bucket.getFiles({ prefix: `users/${locals.user.uid}/projects/` });

		// Extract project IDs and load metadata
		const projects = [];
		for (const file of files) {
			if (file.name.endsWith('/project.json')) {
				try {
					const [contents] = await file.download();
					const projectData = JSON.parse(contents.toString());
					projects.push({
						projectId: projectData.projectId,
						projectName: projectData.projectName,
						lastSaved: projectData.lastSaved,
						frameCount: projectData.frameUrls?.length || 0
					});
				} catch (e) {
					console.error('Error loading project:', file.name, e);
				}
			}
		}

		// Sort by last saved (newest first)
		projects.sort((a, b) => new Date(b.lastSaved) - new Date(a.lastSaved));
		await recordUsageEvent({
			uid: locals.user.uid,
			routeKey: 'load-project:list',
			provider: 'firebase',
			statusCode: 200,
			requestBytes,
			metadata: { count: projects.length }
		});

		return json({ projects });

	} catch (error) {
		console.error('List projects error:', error);
		if (locals.user?.uid) {
			await recordUsageEvent({
				uid: locals.user.uid,
				routeKey: 'load-project:list',
				provider: 'firebase',
				success: false,
				statusCode: 500,
				requestBytes,
				metadata: { error: String(error.message || 'unknown').slice(0, 200) }
			});
		}
		return json({ error: error.message || 'Failed to list projects' }, { status: 500 });
	}
}
