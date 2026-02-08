/**
 * POST /api/create-folder
 * 
 * Creates a folder in Firestore using server-side auth (session cookie).
 * This bypasses the need for client-side Firebase auth to be signed in.
 * 
 * Body: { name: string, parentId?: string | null }
 * Returns: { id: string, name: string }
 */
import { json } from '@sveltejs/kit';
import { getAdminDb } from '$lib/firebase/admin.js';

export async function POST({ request, locals }) {
	try {
		const user = locals.user;
		if (!user) {
			return json({ error: 'Not authenticated' }, { status: 401 });
		}

		const { name, parentId } = await request.json();

		if (!name || typeof name !== 'string' || !name.trim()) {
			return json({ error: 'Folder name is required' }, { status: 400 });
		}

		const db = getAdminDb();
		const folderRef = db.collection('users').doc(user.uid).collection('files').doc();

		await folderRef.set({
			name: name.trim(),
			parentId: parentId || null,
			isFolder: true,
			url: null,
			thumbnailUrl: null,
			fileType: null,
			metadata: {},
			size: null,
			createdAt: new Date(),
			updatedAt: new Date()
		});

		return json({
			id: folderRef.id,
			name: name.trim()
		});
	} catch (error) {
		console.error('[create-folder] Error:', error);
		return json({ error: error.message || 'Failed to create folder' }, { status: 500 });
	}
}
