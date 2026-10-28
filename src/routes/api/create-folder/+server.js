/**
 * POST /api/create-folder
 *
 * Body: { name: string, parentId?: string | null, metadata?: object }
 * Returns: { id: string, name: string, metadata }
 */
import { json } from '@sveltejs/kit';
import { createFolder } from '$lib/server/library.js';

export async function POST({ request }) {
	try {
		const { name, parentId, metadata } = await request.json();
		if (!name || typeof name !== 'string' || !name.trim()) {
			return json({ error: 'Folder name is required' }, { status: 400 });
		}
		const incoming = metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {};
		const tags = Array.isArray(incoming.tags)
			? incoming.tags.map((t) => String(t || '').trim()).filter(Boolean).slice(0, 10)
			: [];
		const folderMetadata = {
			notes: String(incoming.notes || '').trim().slice(0, 1000),
			tags,
			source: String(incoming.source || '').trim().slice(0, 40)
		};
		const item = createFolder(parentId ? String(parentId) : null, name.trim().slice(0, 120), folderMetadata);
		return json({ id: item.id, name: item.name, metadata: item.metadata, item });
	} catch (error) {
		console.error('[create-folder] Error:', error);
		return json({ error: error.message || 'Failed to create folder' }, { status: 500 });
	}
}
