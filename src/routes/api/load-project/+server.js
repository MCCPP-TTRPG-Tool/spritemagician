/**
 * GET  /api/load-project?projectId=…  → project with frames
 * POST /api/load-project               → { projects: [...] } (list)
 */
import { json } from '@sveltejs/kit';
import * as db from '$lib/server/db.js';

export async function GET({ url }) {
	try {
		const projectId = url.searchParams.get('projectId')?.trim();
		if (!projectId || !/^[a-zA-Z0-9_-]{1,128}$/.test(projectId)) {
			return json({ error: 'Valid projectId is required' }, { status: 400 });
		}
		const projectData = db.getDoc('projects', projectId);
		if (!projectData) return json({ error: 'Project not found' }, { status: 404 });
		return json({ ...projectData, frames: projectData.frameUrls || [] });
	} catch (error) {
		console.error('Load project error:', error);
		return json({ error: error.message || 'Failed to load project' }, { status: 500 });
	}
}

export async function POST() {
	try {
		const projects = db.listDocs('projects').map((p) => ({
			projectId: p.projectId || p.id,
			projectName: p.projectName,
			lastSaved: p.lastSaved,
			frameCount: p.frameUrls?.length || 0
		}));
		projects.sort((a, b) => new Date(b.lastSaved) - new Date(a.lastSaved));
		return json({ projects });
	} catch (error) {
		console.error('List projects error:', error);
		return json({ error: error.message || 'Failed to list projects' }, { status: 500 });
	}
}
