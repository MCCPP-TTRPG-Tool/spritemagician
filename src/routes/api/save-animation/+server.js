/**
 * POST /api/save-animation
 *
 * Dedicated endpoint for saving animation files (.anim.json) to Firebase Storage.
 * Unlike /api/upload-file, this accepts the raw animation JSON directly,
 * avoiding the double-base64 encoding overhead (which can double payload size).
 *
 * Body: { name: string, frames: string[], fps: number, prompt?: string }
 * Returns: { url: string, path: string, frameCount: number }
 */
import { json } from '@sveltejs/kit';
import { getAdminStorage } from '$lib/firebase/admin.js';

export async function POST({ request, locals }) {
	try {
		const user = locals.user;
		if (!user) {
			return json({ error: 'Not authenticated' }, { status: 401 });
		}

		const body = await request.json();
		const { name, frames, fps, prompt } = body;

		if (!frames || !Array.isArray(frames) || frames.length === 0) {
			return json({ error: 'frames array is required and must not be empty' }, { status: 400 });
		}

		// Build the animation JSON
		const animData = {
			type: 'animation',
			name: name || 'animation',
			frames,
			fps: fps || 12,
			frameCount: frames.length,
			prompt: prompt || '',
			createdAt: new Date().toISOString()
		};

		const jsonString = JSON.stringify(animData);
		const buffer = Buffer.from(jsonString, 'utf-8');

		// Upload to Firebase Storage (timestamp prevents overwrites)
		const safeName = (name || 'animation').slice(0, 40).replace(/[^a-zA-Z0-9_-]/g, '_');
		const fname = `${safeName}_${Date.now()}.anim.json`;
		const storagePath = `users/${user.uid}/animations/${fname}`;

		const bucket = getAdminStorage();
		const file = bucket.file(storagePath);

		await file.save(buffer, {
			metadata: {
				contentType: 'application/json',
				cacheControl: 'public, max-age=3600'
			},
			public: true
		});
		await file.makePublic();

		const publicUrl = `https://storage.googleapis.com/${bucket.name}/${storagePath}`;
		console.log(`[save-animation] Saved ${fname}: ${frames.length} frames, ${(buffer.length / 1024).toFixed(1)} KB`);

		return json({ url: publicUrl, path: storagePath, frameCount: frames.length });
	} catch (error) {
		console.error('[save-animation] Error:', error);
		return json({ error: error.message || 'Save failed' }, { status: 500 });
	}
}
