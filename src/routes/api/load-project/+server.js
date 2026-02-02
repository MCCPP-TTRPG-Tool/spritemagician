/**
 * Load project from Firebase Storage
 */

import { json } from '@sveltejs/kit';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getStorage } from 'firebase-admin/storage';
import { env } from '$env/dynamic/private';

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

export async function GET({ url }) {
	try {
		const projectId = url.searchParams.get('projectId');
		
		if (!projectId) {
			return json({ error: 'projectId required' }, { status: 400 });
		}

		const bucket = initFirebase();
		const projectPath = `projects/${projectId}/project.json`;

		// Load project metadata
		const file = bucket.file(projectPath);
		const [exists] = await file.exists();
		
		if (!exists) {
			return json({ error: 'Project not found' }, { status: 404 });
		}

		const [contents] = await file.download();
		const projectData = JSON.parse(contents.toString());

		// Load frames from URLs (they're already public URLs)
		const frames = projectData.frameUrls || [];

		return json({
			...projectData,
			frames // Return frames as URLs
		});

	} catch (error) {
		console.error('Load project error:', error);
		return json({ error: error.message || 'Failed to load project' }, { status: 500 });
	}
}

/**
 * List all saved projects
 */
export async function POST({ request }) {
	try {
		const bucket = initFirebase();
		const [files] = await bucket.getFiles({ prefix: 'projects/' });

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

		return json({ projects });

	} catch (error) {
		console.error('List projects error:', error);
		return json({ error: error.message || 'Failed to list projects' }, { status: 500 });
	}
}
