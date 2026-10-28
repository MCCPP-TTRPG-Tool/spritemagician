/**
 * POST /api/save-animation
 *
 * Saves an animation file (.anim.json) plus a first-frame thumbnail to the
 * local library. The client then indexes it with createFile().
 *
 * Body: { name: string, frames: string[], fps: number, prompt?: string }
 * Returns: { url: string, path: string, frameCount: number, thumbnailUrl: string }
 */
import { json } from '@sveltejs/kit';
import { normalizeBoundedInt, validateImageArray } from '$lib/server/validation.js';
import { saveBuffer, saveDataUrl } from '$lib/server/localFiles.js';

export async function POST({ request }) {
	try {
		const { name, frames, fps, prompt } = await request.json();
		const framesValidation = validateImageArray(frames, {
			minItems: 1,
			maxItems: 240,
			maxItemChars: 2_000_000
		});
		if (!framesValidation.ok) {
			return json({ error: framesValidation.error }, { status: 400 });
		}
		const safeFps = normalizeBoundedInt(fps, 12, 1, 60);
		const safeName = (name || 'animation').slice(0, 40).replace(/[^a-zA-Z0-9_-]/g, '_');
		const ts = Date.now();

		let thumbnailUrl = '';
		if (frames[0] && String(frames[0]).startsWith('data:')) {
			thumbnailUrl = saveDataUrl(frames[0], `.thumbs/${safeName}_${ts}_thumb`).url;
		}

		const animData = {
			type: 'animation',
			name: name || 'animation',
			frames,
			fps: safeFps,
			frameCount: frames.length,
			prompt: prompt || '',
			thumbnailUrl,
			createdAt: new Date().toISOString()
		};
		const buffer = Buffer.from(JSON.stringify(animData), 'utf-8');
		const fname = `${safeName}_${ts}.anim.json`;
		const saved = saveBuffer(buffer, `.animations/${fname}`);

		console.log(`[save-animation] Saved ${fname}: ${frames.length} frames, ${(buffer.length / 1024).toFixed(1)} KB`);
		return json({ url: saved.url, path: saved.relPath, frameCount: frames.length, thumbnailUrl });
	} catch (error) {
		console.error('[save-animation] Error:', error);
		return json({ error: error.message || 'Save failed' }, { status: 500 });
	}
}
