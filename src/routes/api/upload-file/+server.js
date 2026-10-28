/**
 * POST /api/upload-file
 *
 * Writes a base64 image into the library folder on disk and returns its
 * local URL. The client then calls createFile() to index it in the tree.
 *
 * Body: { imageData: string, filename?: string, folder?: string (folder item id) }
 * Returns: { url: string, path: string }
 */
import { json } from '@sveltejs/kit';
import { isDataUrl } from '$lib/server/validation.js';
import { saveDataUrl } from '$lib/server/localFiles.js';
import { folderRelPath, getItem } from '$lib/server/library.js';

function sanitizeFileName(name) {
	const raw = String(name || '').trim();
	const cleaned = raw.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 120);
	return cleaned || `${Date.now()}-${Math.random().toString(36).substring(2, 8)}.png`;
}

export async function POST({ request }) {
	try {
		const { imageData, filename, folder } = await request.json();

		if (!imageData || typeof imageData !== 'string') {
			return json({ error: 'imageData is required' }, { status: 400 });
		}
		if (isDataUrl(imageData) && !imageData.startsWith('data:image/')) {
			return json({ error: 'Only image data URLs are supported' }, { status: 400 });
		}

		const safeName = sanitizeFileName(filename);
		const folderId = folder && getItem(String(folder))?.isFolder ? String(folder) : null;
		const dir = folderId ? folderRelPath(folderId) : '.uploads';
		const saved = saveDataUrl(imageData, `${dir}/${safeName}`);

		return json({ url: saved.url, path: saved.relPath, size: saved.size });
	} catch (error) {
		console.error('[upload-file] Error:', error);
		return json({ error: error.message || 'Upload failed' }, { status: 500 });
	}
}
