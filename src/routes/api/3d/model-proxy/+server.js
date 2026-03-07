import { enforceRateLimit } from '$lib/server/security.js';

const ALLOWED_HOSTS = new Set([
	'firebasestorage.googleapis.com',
	'storage.googleapis.com'
]);

function isAllowedRemoteUrl(raw) {
	try {
		const u = new URL(String(raw || ''));
		if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
		return ALLOWED_HOSTS.has(u.hostname);
	} catch {
		return false;
	}
}

export async function GET({ url, locals, fetch }) {
	if (!locals.user) {
		return new Response('Authentication required', { status: 401 });
	}
	const rate = enforceRateLimit({
		uid: locals.user.uid,
		routeKey: '3d-model-proxy',
		maxRequests: 240,
		windowMs: 60_000
	});
	if (!rate.allowed) {
		return new Response('Rate limit exceeded', {
			status: 429,
			headers: { 'Retry-After': String(rate.retryAfterSec) }
		});
	}

	const remote = url.searchParams.get('url')?.trim() || '';
	if (!isAllowedRemoteUrl(remote)) {
		return new Response('Invalid or disallowed model URL', { status: 400 });
	}

	const upstream = await fetch(remote);
	if (!upstream.ok) {
		return new Response(`Upstream fetch failed (${upstream.status})`, { status: 502 });
	}
	const body = await upstream.arrayBuffer();
	const contentType = upstream.headers.get('content-type') || 'application/octet-stream';

	return new Response(body, {
		status: 200,
		headers: {
			'Content-Type': contentType,
			'Cache-Control': 'public, max-age=300'
		}
	});
}
