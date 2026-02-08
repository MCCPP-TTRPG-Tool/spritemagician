/**
 * POST /api/upload-file
 *
 * Accepts base64 image data, uploads to Firebase Storage,
 * returns the public URL so the client can create a Firestore doc.
 *
 * Body: { imageData: string, filename?: string, folder?: string }
 * Returns: { url: string, path: string }
 */
import { json } from '@sveltejs/kit';
import { uploadImageToFirebase } from '$lib/utils/firebaseStorage.js';

export async function POST({ request, locals }) {
	try {
		const user = locals.user;
		if (!user) {
			return json({ error: 'Not authenticated' }, { status: 401 });
		}

		const { imageData, filename, folder } = await request.json();

		if (!imageData) {
			return json({ error: 'imageData is required' }, { status: 400 });
		}

		// Build a namespaced storage path
		const safeName = filename || `${Date.now()}-${Math.random().toString(36).substring(2, 8)}.png`;
		const storagePath = `users/${user.uid}/${folder || 'files'}/${safeName}`;

		const url = await uploadImageToFirebase(imageData, storagePath);

		return json({ url, path: storagePath });
	} catch (error) {
		console.error('[upload-file] Error:', error);
		return json({ error: error.message || 'Upload failed' }, { status: 500 });
	}
}
