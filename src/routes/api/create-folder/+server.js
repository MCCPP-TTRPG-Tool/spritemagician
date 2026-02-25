/**
 * POST /api/create-folder
 * 
 * Creates a folder in Firestore using server-side auth (session cookie).
 * This bypasses the need for client-side Firebase auth to be signed in.
 * 
 * Body: { name: string, parentId?: string | null, metadata?: object }
 * Returns: { id: string, name: string }
 */
import { json } from '@sveltejs/kit';
import { getAdminDb } from '$lib/firebase/admin.js';
import { CHROMA_KEY_HEX } from '$lib/constants/chromaKey.js';

export async function POST({ request, locals }) {
	try {
		const user = locals.user;
		if (!user) {
			return json({ error: 'Not authenticated' }, { status: 401 });
		}

		const { name, parentId, metadata } = await request.json();

		if (!name || typeof name !== 'string' || !name.trim()) {
			return json({ error: 'Folder name is required' }, { status: 400 });
		}

		const incomingMetadata =
			metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {};
		const tags = Array.isArray(incomingMetadata.tags)
			? incomingMetadata.tags
				.map((t) => String(t || '').trim())
				.filter(Boolean)
				.slice(0, 10)
			: [];
		const folderMetadata = {
			assetType: String(incomingMetadata.assetType || '').trim().slice(0, 40),
			notes: String(incomingMetadata.notes || '').trim().slice(0, 1000),
			tags,
			source: String(incomingMetadata.source || '').trim().slice(0, 40),
			chromaKeyHex:
				typeof incomingMetadata.chromaKeyHex === 'string' &&
				/^#[0-9A-Fa-f]{6}$/.test(incomingMetadata.chromaKeyHex)
					? incomingMetadata.chromaKeyHex.toUpperCase()
					: CHROMA_KEY_HEX
		};

		const db = getAdminDb();
		const folderRef = db.collection('users').doc(user.uid).collection('files').doc();

		await folderRef.set({
			name: name.trim(),
			parentId: parentId || null,
			isFolder: true,
			url: null,
			thumbnailUrl: null,
			fileType: null,
			metadata: folderMetadata,
			size: null,
			createdAt: new Date(),
			updatedAt: new Date()
		});

		return json({
			id: folderRef.id,
			name: name.trim(),
			metadata: folderMetadata
		});
	} catch (error) {
		console.error('[create-folder] Error:', error);
		return json({ error: error.message || 'Failed to create folder' }, { status: 500 });
	}
}
