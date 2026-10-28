/**
 * POST /api/save-project
 *
 * Saves an animation project to <library>/.projects/<projectId>/ with frames
 * as PNG files and metadata in the local JSON db.
 */
import { json } from '@sveltejs/kit';
import { isDataUrl, isHttpUrl, normalizeBoundedInt } from '$lib/server/validation.js';
import { saveDataUrl, isLocalUrl } from '$lib/server/localFiles.js';
import * as db from '$lib/server/db.js';

export async function POST({ request }) {
	try {
		const { project } = await request.json();
		if (!project) {
			return json({ error: 'Project data required' }, { status: 400 });
		}
		const inputFrames = Array.isArray(project.frames) ? project.frames.slice(0, 240) : [];
		for (let i = 0; i < inputFrames.length; i += 1) {
			const frame = inputFrames[i];
			if (typeof frame !== 'string' || !(isDataUrl(frame) || isHttpUrl(frame) || isLocalUrl(frame))) {
				return json({ error: `project.frames[${i}] must be a data URL or URL` }, { status: 400 });
			}
		}

		const requestedProjectId = String(project.projectId || '').trim();
		const projectId = /^[a-zA-Z0-9_-]{1,128}$/.test(requestedProjectId)
			? requestedProjectId
			: `project-${Date.now()}`;
		const projectDir = `.projects/${projectId}`;

		const frameUrls = inputFrames.map((frame, i) =>
			frame.startsWith('data:')
				? saveDataUrl(frame, `${projectDir}/frames/frame-${String(i).padStart(4, '0')}.png`, { overwrite: true }).url
				: frame
		);

		let firstFrameUrl = project.firstFrame;
		if (project.firstFrame && project.firstFrame.startsWith('data:')) {
			firstFrameUrl = saveDataUrl(project.firstFrame, `${projectDir}/firstFrame.png`, { overwrite: true }).url;
		}

		const existing = db.getDoc('projects', projectId);
		const projectData = {
			projectId,
			projectName: String(project.projectName || 'Untitled Project').slice(0, 120),
			fps: normalizeBoundedInt(project.fps, 12, 1, 60),
			prompt: project.prompt || '',
			firstFrame: firstFrameUrl,
			lastFrame: project.lastFrame || null,
			generationMode: project.generationMode || 'prompt',
			frameCount: normalizeBoundedInt(project.frameCount, inputFrames.length || 8, 1, 240),
			duration: project.duration || null,
			frameUrls,
			lastSaved: new Date().toISOString(),
			createdAt: existing?.createdAt || project.createdAt || new Date().toISOString()
		};
		db.setDoc('projects', projectId, projectData);

		return json({ success: true, projectId, frameCount: frameUrls.length });
	} catch (error) {
		console.error('Save project error:', error);
		return json({ error: error.message || 'Failed to save project' }, { status: 500 });
	}
}
