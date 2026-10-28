/**
 * POST /api/replace-file
 *
 * Overwrites an existing library file in place (e.g. after background removal).
 *
 * Body: { imageData: string, existingUrl: string }
 * Returns: { url: string, path: string }
 */
import { json } from '@sveltejs/kit';
import { isDataUrl } from '$lib/server/validation.js';
import { isLocalUrl, urlToRelPath } from '$lib/server/localFiles.js';
import { replaceFileContents } from '$lib/server/library.js';

export async function POST({ request }) {
	try {
		const { imageData, existingUrl } = await request.json();
		if (!imageData || typeof imageData !== 'string') {
			return json({ error: 'imageData is required' }, { status: 400 });
		}
		if (isDataUrl(imageData) && !imageData.startsWith('data:image/')) {
			return json({ error: 'Only image data URLs are supported' }, { status: 400 });
		}
		if (!isLocalUrl(existingUrl)) {
			return json({ error: 'existingUrl must be a local library URL' }, { status: 400 });
		}
		const saved = replaceFileContents(existingUrl, imageData);
		// Cache-bust so <img> tags pick up the new bytes
		const url = `${saved.url}?v=${Date.now()}`;
		return json({ url, path: urlToRelPath(saved.url), size: saved.size });
	} catch (error) {
		console.error('[replace-file] Error:', error);
		return json({ error: error.message || 'File replacement failed' }, { status: 500 });
	}
}
