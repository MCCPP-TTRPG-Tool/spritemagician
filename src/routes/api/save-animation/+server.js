/**
 * POST /api/save-animation
 *
 * Dedicated endpoint for saving animation files (.anim.json) to Firebase Storage.
 * Unlike /api/upload-file, this accepts the raw animation JSON directly,
 * avoiding the double-base64 encoding overhead (which can double payload size).
 *
 * Also uploads the first frame as a thumbnail image so the file tree can display it.
 *
 * Body: { name: string, frames: string[], fps: number, prompt?: string }
 * Returns: { url: string, path: string, frameCount: number, thumbnailUrl: string }
 */
import { json } from '@sveltejs/kit';
import { getAdminStorage } from '$lib/firebase/admin.js';

/** Extract raw bytes + content type from a data-URL string */
function parseDataUrl(dataUrl) {
	const match = dataUrl.match(/^data:([^;,]+);base64,(.+)$/s);
	if (!match) return null;
	return { mime: match[1], buffer: Buffer.from(match[2], 'base64') };
}

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

		const bucket = getAdminStorage();
		const safeName = (name || 'animation').slice(0, 40).replace(/[^a-zA-Z0-9_-]/g, '_');
		const ts = Date.now();

		// ── 1. Upload first frame as thumbnail ──────────────────
		let thumbnailUrl = '';
		const firstFrame = frames[0];
		if (firstFrame) {
			const parsed = parseDataUrl(firstFrame);
			if (parsed) {
				const ext = parsed.mime === 'image/webp' ? 'webp' : 'png';
				const thumbPath = `users/${user.uid}/animations/${safeName}_${ts}_thumb.${ext}`;
				const thumbFile = bucket.file(thumbPath);
				await thumbFile.save(parsed.buffer, {
					metadata: { contentType: parsed.mime, cacheControl: 'public, max-age=31536000' },
					public: true
				});
				await thumbFile.makePublic();
				thumbnailUrl = `https://storage.googleapis.com/${bucket.name}/${thumbPath}`;
			}
		}

		// ── 2. Build and upload the animation JSON ──────────────
		const animData = {
			type: 'animation',
			name: name || 'animation',
			frames,
			fps: fps || 12,
			frameCount: frames.length,
			prompt: prompt || '',
			thumbnailUrl,
			createdAt: new Date().toISOString()
		};

		const jsonString = JSON.stringify(animData);
		const buffer = Buffer.from(jsonString, 'utf-8');

		const fname = `${safeName}_${ts}.anim.json`;
		const storagePath = `users/${user.uid}/animations/${fname}`;
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
		console.log(`[save-animation] Saved ${fname}: ${frames.length} frames, ${(buffer.length / 1024).toFixed(1)} KB, thumb=${!!thumbnailUrl}`);

		return json({ url: publicUrl, path: storagePath, frameCount: frames.length, thumbnailUrl });
	} catch (error) {
		console.error('[save-animation] Error:', error);
		return json({ error: error.message || 'Save failed' }, { status: 500 });
	}
}
