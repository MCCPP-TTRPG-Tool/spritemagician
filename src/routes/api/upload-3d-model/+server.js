/**
 * POST /api/upload-3d-model
 *
 * Body: { modelData: data URL, filename: string, folder?: string }
 * Returns: { url, path, size }
 */
import { json } from '@sveltejs/kit';
import { saveBuffer } from '$lib/server/localFiles.js';

const MAX_BYTES = 200 * 1024 * 1024;

function sanitizeFileName(name) {
	return String(name || '').trim().replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
}

function parseModelDataUrl(dataUrl) {
	if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) return null;
	const m = dataUrl.match(/^data:([^;,]+);base64,(.+)$/s);
	if (!m) return null;
	return { mimeType: m[1], base64: m[2] };
}

function allowedModelExt(name) {
	const ext = String(name || '').toLowerCase().split('.').pop() || '';
	return ['glb', 'gltf', 'fbx', 'obj'].includes(ext) ? ext : '';
}

export async function POST({ request }) {
	try {
		const { modelData, filename, folder = 'models' } = await request.json();
		const safeFilename = sanitizeFileName(filename);
		const ext = allowedModelExt(safeFilename);
		if (!safeFilename || !ext) {
			return json({ error: 'filename is required (.glb/.gltf/.fbx/.obj)' }, { status: 400 });
		}
		const parsed = parseModelDataUrl(modelData);
		if (!parsed?.base64) {
			return json({ error: 'modelData must be a base64 data URL' }, { status: 400 });
		}
		const buffer = Buffer.from(parsed.base64, 'base64');
		if (buffer.length <= 0 || buffer.length > MAX_BYTES) {
			return json({ error: `Model size must be <= ${MAX_BYTES / (1024 * 1024)}MB` }, { status: 400 });
		}
		const folderSanitized = String(folder || 'models').replace(/[^a-zA-Z0-9/_-]/g, '_');
		const saved = saveBuffer(buffer, `.models/${folderSanitized}/${Date.now()}_${safeFilename}`);
		return json({ url: saved.url, path: saved.relPath, size: saved.size });
	} catch (error) {
		console.error('[upload-3d-model] Error:', error);
		return json({ error: error.message || '3D model upload failed' }, { status: 500 });
	}
}
