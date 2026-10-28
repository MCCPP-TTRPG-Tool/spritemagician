/**
 * GET /local/<path>  — serves a file from the user's library folder.
 */
import fs from 'node:fs';
import { error } from '@sveltejs/kit';
import { relPathToAbs, mimeForPath } from '$lib/server/localFiles.js';

export async function GET({ params, request }) {
	let abs;
	try {
		abs = relPathToAbs(params.path);
	} catch {
		throw error(400, 'Bad path');
	}
	if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) throw error(404, 'Not found');

	const stat = fs.statSync(abs);
	const etag = `"${stat.size}-${Math.floor(stat.mtimeMs)}"`;
	if (request.headers.get('if-none-match') === etag) {
		return new Response(null, { status: 304 });
	}
	const body = fs.readFileSync(abs);
	return new Response(body, {
		headers: {
			'Content-Type': mimeForPath(abs),
			'Content-Length': String(stat.size),
			'Cache-Control': 'no-cache',
			ETag: etag,
			'Access-Control-Allow-Origin': '*'
		}
	});
}
