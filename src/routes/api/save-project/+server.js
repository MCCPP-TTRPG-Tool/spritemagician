/**
 * Save project to Firebase Storage
 * Stores project metadata and frame URLs
 */

import { json } from '@sveltejs/kit';
import { uploadImageToFirebase } from '$lib/utils/firebaseStorage.js';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getStorage } from 'firebase-admin/storage';
import { env } from '$env/dynamic/private';
import { approxJsonBytes, enforceRateLimit } from '$lib/server/security.js';
import { isDataUrl, isHttpUrl, normalizeBoundedInt } from '$lib/server/validation.js';
import {
	beginIdempotentRequest,
	completeIdempotentRequest,
	failIdempotentRequest,
	makeRequestHash,
	recordUsageEvent
} from '$lib/server/requestTracking.js';

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

export async function POST({ request, locals }) {
	let payloadBytes = 0;
	let idempotencyKey = null;
	let requestHash = null;
	try {
		if (!locals.user) {
			return json({ error: 'Authentication required' }, { status: 401 });
		}

		const { project } = await request.json();
		payloadBytes = approxJsonBytes({ project });
		idempotencyKey = request.headers.get('Idempotency-Key')?.trim() || null;
		requestHash = makeRequestHash({ project });
		if (payloadBytes > 30 * 1024 * 1024) {
			return json({ error: 'Request payload too large' }, { status: 413 });
		}
		const rate = enforceRateLimit({
			uid: locals.user.uid,
			routeKey: 'save-project',
			maxRequests: 15,
			windowMs: 60_000
		});
		if (!rate.allowed) {
			return json(
				{ error: 'Rate limit exceeded. Please try again shortly.' },
				{ status: 429, headers: { 'Retry-After': String(rate.retryAfterSec) } }
			);
		}
		if (idempotencyKey) {
			const idempotency = await beginIdempotentRequest({
				uid: locals.user.uid,
				routeKey: 'save-project',
				idempotencyKey,
				requestHash
			});
			if (idempotency.status === 'replay') {
				return json(idempotency.responseBody, { status: idempotency.responseStatus });
			}
			if (idempotency.status === 'processing') {
				return json(
					{ error: 'A request with this Idempotency-Key is already processing.' },
					{ status: 409 }
				);
			}
			if (idempotency.status === 'conflict') {
				return json(
					{ error: 'Idempotency-Key already used with different payload.' },
					{ status: 409 }
				);
			}
		}

		if (!project) {
			return json({ error: 'Project data required' }, { status: 400 });
		}
		const inputFrames = Array.isArray(project.frames) ? project.frames.slice(0, 240) : [];
		for (let i = 0; i < inputFrames.length; i += 1) {
			const frame = inputFrames[i];
			if (typeof frame !== 'string') {
				return json({ error: `project.frames[${i}] must be a string` }, { status: 400 });
			}
			if (!isDataUrl(frame) && !isHttpUrl(frame)) {
				return json({ error: `project.frames[${i}] must be a data URL or http(s) URL` }, { status: 400 });
			}
			if (frame.length > 2_000_000) {
				return json({ error: `project.frames[${i}] is too large` }, { status: 400 });
			}
		}

		const bucket = initFirebase();
		const requestedProjectId = String(project.projectId || '').trim();
		const projectId = /^[a-zA-Z0-9_-]{1,128}$/.test(requestedProjectId)
			? requestedProjectId
			: `project-${Date.now()}`;
		const projectPath = `users/${locals.user.uid}/projects/${projectId}`;

		// Upload frames to Firebase Storage
		const frameUrls = [];
		if (inputFrames.length > 0) {
			for (let i = 0; i < inputFrames.length; i++) {
				const frame = inputFrames[i];
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
			ownerUid: locals.user.uid,
			projectName: String(project.projectName || 'Untitled Project').slice(0, 120),
			fps: normalizeBoundedInt(project.fps, 12, 1, 60),
			prompt: project.prompt || '',
			firstFrame: firstFrameUrl,
			lastFrame: project.lastFrame || null,
			generationMode: project.generationMode || 'prompt',
			frameCount: normalizeBoundedInt(project.frameCount, inputFrames.length || 8, 1, 240),
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

		const responseBody = {
			success: true,
			projectId,
			projectUrl: `https://storage.googleapis.com/${bucket.name}/${projectPath}/project.json`,
			frameCount: frameUrls.length
		};
		if (idempotencyKey) {
			await completeIdempotentRequest({
				uid: locals.user.uid,
				routeKey: 'save-project',
				idempotencyKey,
				requestHash,
				responseStatus: 200,
				responseBody
			});
		}
		await recordUsageEvent({
			uid: locals.user.uid,
			routeKey: 'save-project',
			provider: 'firebase',
			statusCode: 200,
			requestBytes: payloadBytes,
			metadata: { frameCount: frameUrls.length, projectId }
		});
		return json(responseBody);

	} catch (error) {
		console.error('Save project error:', error);
		if (idempotencyKey && requestHash && locals.user?.uid) {
			try {
				await failIdempotentRequest({
					uid: locals.user.uid,
					routeKey: 'save-project',
					idempotencyKey,
					requestHash,
					errorMessage: error.message
				});
			} catch {
				// best effort
			}
		}
		if (locals.user?.uid) {
			await recordUsageEvent({
				uid: locals.user.uid,
				routeKey: 'save-project',
				provider: 'firebase',
				success: false,
				statusCode: 500,
				requestBytes: payloadBytes,
				metadata: { error: String(error.message || 'unknown').slice(0, 200) }
			});
		}
		return json({ error: error.message || 'Failed to save project' }, { status: 500 });
	}
}
