/**
 * Save project to Firebase Storage
 * Stores project metadata and frame URLs
 */

import { json } from '@sveltejs/kit';
import { uploadImageToFirebase } from '$lib/utils/firebaseStorage.js';
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

export async function POST({ request }) {
	try {
		const { project } = await request.json();

		if (!project) {
			return json({ error: 'Project data required' }, { status: 400 });
		}

		const bucket = initFirebase();
		const projectId = project.projectId || `project-${Date.now()}`;
		const projectPath = `projects/${projectId}`;

		// Upload frames to Firebase Storage
		const frameUrls = [];
		if (project.frames && project.frames.length > 0) {
			for (let i = 0; i < project.frames.length; i++) {
				const frame = project.frames[i];
				if (frame && frame.startsWith('data:')) {
					// Upload base64 frame
					const frameUrl = await uploadImageToFirebase(
						frame,
						`${projectPath}/frames/frame-${i.toString().padStart(4, '0')}.png`
					);
					frameUrls.push(frameUrl);
				} else if (frame && frame.startsWith('http')) {
					// Already a URL, keep it
					frameUrls.push(frame);
				}
			}
		}

		// Upload reference image if it's base64
		let firstFrameUrl = project.firstFrame;
		if (project.firstFrame && project.firstFrame.startsWith('data:')) {
			firstFrameUrl = await uploadImageToFirebase(
				project.firstFrame,
				`${projectPath}/firstFrame.png`
			);
		}

		// Create project metadata (without frame data, just URLs)
		const projectData = {
			projectId,
			projectName: project.projectName || 'Untitled Project',
			fps: project.fps || 12,
			prompt: project.prompt || '',
			firstFrame: firstFrameUrl,
			lastFrame: project.lastFrame || null,
			generationMode: project.generationMode || 'prompt',
			frameCount: project.frameCount || 8,
			duration: project.duration || null,
			frameUrls, // Array of Firebase Storage URLs
			lastSaved: new Date().toISOString(),
			createdAt: project.createdAt || new Date().toISOString()
		};

		// Save project metadata as JSON file in Firebase Storage
		const metadataFile = bucket.file(`${projectPath}/project.json`);
		await metadataFile.save(JSON.stringify(projectData, null, 2), {
			metadata: {
				contentType: 'application/json',
				cacheControl: 'public, max-age=3600'
			},
			public: true
		});
		await metadataFile.makePublic();

		return json({
			success: true,
			projectId,
			projectUrl: `https://storage.googleapis.com/${bucket.name}/${projectPath}/project.json`,
			frameCount: frameUrls.length
		});

	} catch (error) {
		console.error('Save project error:', error);
		return json({ error: error.message || 'Failed to save project' }, { status: 500 });
	}
}
