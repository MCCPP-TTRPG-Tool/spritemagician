/**
 * GET /api/3d/model-proxy?url=…
 * Serves a 3D model from the local library, or proxies a remote one so the
 * viewer never hits CORS problems.
 */
import { isLocalUrl, readLocalUrl } from '$lib/server/localFiles.js';

function isRemoteHttp(raw) {
	try {
		const u = new URL(String(raw || ''));
		return u.protocol === 'https:' || u.protocol === 'http:';
	} catch {
		return false;
	}
}

export async function GET({ url, fetch }) {
	const remote = url.searchParams.get('url')?.trim() || '';

	if (isLocalUrl(remote)) {
		const file = readLocalUrl(remote);
		if (!file) return new Response('Model not found', { status: 404 });
		return new Response(file.buffer, {
			status: 200,
			headers: { 'Content-Type': file.mimeType, 'Cache-Control': 'no-cache' }
		});
	}

	if (!isRemoteHttp(remote)) {
		return new Response('Invalid model URL', { status: 400 });
	}
	const upstream = await fetch(remote);
	if (!upstream.ok) {
		return new Response(`Upstream fetch failed (${upstream.status})`, { status: 502 });
	}
	const body = await upstream.arrayBuffer();
	return new Response(body, {
		status: 200,
		headers: {
			'Content-Type': upstream.headers.get('content-type') || 'application/octet-stream',
			'Cache-Control': 'public, max-age=300'
		}
	});
}
