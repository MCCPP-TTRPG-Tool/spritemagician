/**
 * GET /local/<path>  — serves a file from the user's library folder.
 * Streams from disk and supports Range requests so video seeking works
 * and large models are not buffered in memory.
 */
import fs from 'node:fs';
import { Readable } from 'node:stream';
import { error } from '@sveltejs/kit';
import { relPathToAbs, mimeForPath } from '$lib/server/localFiles.js';

function parseRange(header, size) {
	const m = /^bytes=(\d*)-(\d*)$/.exec(String(header || ''));
	if (!m) return null;
	let start = m[1] === '' ? null : Number(m[1]);
	let end = m[2] === '' ? null : Number(m[2]);
	if (start === null && end === null) return null;
	if (start === null) {
		start = Math.max(0, size - end);
		end = size - 1;
	} else if (end === null || end >= size) {
		end = size - 1;
	}
	if (start > end || start >= size) return { invalid: true };
	return { start, end };
}

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
	const mime = mimeForPath(abs);
	const baseHeaders = {
		'Content-Type': mime === 'image/svg+xml' ? 'image/svg+xml' : mime,
		'Cache-Control': 'no-cache',
		ETag: etag,
		'Accept-Ranges': 'bytes',
		'X-Content-Type-Options': 'nosniff',
		// Never let a served file run script against the app origin.
		'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:"
	};

	if (request.headers.get('if-none-match') === etag) {
		return new Response(null, { status: 304, headers: baseHeaders });
	}

	const range = parseRange(request.headers.get('range'), stat.size);
	if (range?.invalid) {
		return new Response(null, { status: 416, headers: { ...baseHeaders, 'Content-Range': `bytes */${stat.size}` } });
	}

	if (range) {
		const stream = fs.createReadStream(abs, { start: range.start, end: range.end });
		return new Response(Readable.toWeb(stream), {
			status: 206,
			headers: {
				...baseHeaders,
				'Content-Range': `bytes ${range.start}-${range.end}/${stat.size}`,
				'Content-Length': String(range.end - range.start + 1)
			}
		});
	}

	const stream = fs.createReadStream(abs);
	return new Response(Readable.toWeb(stream), {
		status: 200,
		headers: { ...baseHeaders, 'Content-Length': String(stat.size) }
	});
}
