/**
 * Library REST API — the client-side replacement for Firestore.
 *
 * GET    /api/library?parentId=<id|null>   → { items }
 * GET    /api/library?id=<id>              → { item }
 * POST   /api/library  { action, ... }     → see handlers below
 */
import { json } from '@sveltejs/kit';
import * as library from '$lib/server/library.js';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/** Open Explorer / Finder / the file manager with the item selected. */
function revealInFileManager(abs) {
	const isDir = fs.existsSync(abs) && fs.statSync(abs).isDirectory();
	let cmd;
	let args;
	if (process.platform === 'win32') {
		cmd = 'explorer.exe';
		args = isDir ? [abs] : [`/select,${abs}`];
	} else if (process.platform === 'darwin') {
		cmd = 'open';
		args = isDir ? [abs] : ['-R', abs];
	} else {
		cmd = 'xdg-open';
		args = [isDir ? abs : path.dirname(abs)];
	}
	spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
}

function normId(v) {
	if (v === null || v === undefined || v === '' || v === 'null') return null;
	return String(v);
}

export async function GET({ url }) {
	try {
		const id = url.searchParams.get('id');
		if (id) return json({ item: library.getItem(id) });
		if (url.searchParams.get('all') === '1') return json({ items: library.listAll() });
		const parentId = normId(url.searchParams.get('parentId'));
		return json({ items: library.getChildren(parentId) });
	} catch (error) {
		return json({ error: error.message }, { status: 500 });
	}
}

export async function POST({ request }) {
	let body;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400 });
	}
	const action = String(body?.action || '');
	try {
		switch (action) {
			case 'createFolder': {
				const item = library.createFolder(normId(body.parentId), body.name, body.metadata || {});
				return json({ item, id: item.id });
			}
			case 'createFile': {
				// url may be a /local URL produced by another route, or a data URL
				const { parentId, name, url, fileType, metadata } = body;
				const item = typeof url === 'string' && url.startsWith('data:')
					? library.createFileFromDataUrl(normId(parentId), name, url, fileType || 'image', metadata || {})
					: library.createFileFromUrl(normId(parentId), name, url, fileType || 'image', metadata || {});
				return json({ item, id: item.id });
			}
			case 'upsertFileByName': {
				const { parentId, name, url, fileType, metadata } = body;
				const { item, replaced } = library.upsertFileByName(normId(parentId), name, url, fileType || 'image', metadata || {});
				return json({ item, id: item.id, replaced });
			}
			case 'rename':
				return json({ item: library.renameItem(String(body.id), body.name) });
			case 'move':
				return json({ item: library.moveItem(String(body.id), normId(body.parentId)) });
			case 'update':
				return json({ item: library.updateItem(String(body.id), body.updates || {}) });
			case 'delete':
				return json({ ok: library.deleteItem(String(body.id)) });
			case 'ensureDefaults':
				library.ensureDefaultFolders();
				return json({ ok: true });
			case 'rescan':
				return json(library.rescanLibrary());
			case 'reveal': {
				const abs = library.absolutePathOf(String(body.id));
				if (!abs) return json({ error: 'Not found' }, { status: 404 });
				revealInFileManager(abs);
				return json({ ok: true, path: abs });
			}
			default:
				return json({ error: `Unknown action: ${action}` }, { status: 400 });
		}
	} catch (error) {
		console.error('[api/library]', action, error);
		return json({ error: error.message || 'Library operation failed' }, { status: 500 });
	}
}
