/**
 * GET /api/load-animation?url=<firebase-storage-url>
 *
 * Proxy endpoint that fetches an .anim.json file from Firebase Storage
 * and returns its contents. This avoids CORS issues when loading
 * animation files from the client.
 */
import { json } from '@sveltejs/kit';
import { approxJsonBytes, enforceRateLimit, isAllowedUpstreamUrl } from '$lib/server/security.js';
import { isHttpUrl } from '$lib/server/validation.js';
import { isLocalUrl, fetchLocalOrRemote } from '$lib/server/localFiles.js';
import { recordUsageEvent } from '$lib/server/requestTracking.js';

const ALLOWED_STORAGE_DOMAINS = [
	'storage.googleapis.com',
	'firebasestorage.googleapis.com',
	'firebasestorage.app'
];

export async function GET({ url, locals }) {
	let requestBytes = 0;
	if (!locals.user) {
		return json({ error: 'Authentication required' }, { status: 401 });
	}

	const animUrl = url.searchParams.get('url');
	requestBytes = approxJsonBytes({ url: animUrl });
	const rate = enforceRateLimit({
		uid: locals.user.uid,
		routeKey: 'load-animation',
		maxRequests: 60,
		windowMs: 60_000
	});
	if (!rate.allowed) {
		return json(
			{ error: 'Rate limit exceeded. Please try again shortly.' },
			{ status: 429, headers: { 'Retry-After': String(rate.retryAfterSec) } }
		);
	}

	if (!animUrl) {
		return json({ error: 'url parameter is required' }, { status: 400 });
	}
	if (!isLocalUrl(animUrl) && !isHttpUrl(animUrl)) {
		return json({ error: 'url must be an http(s) URL' }, { status: 400 });
	}

	// Only allow fetching from our Firebase Storage bucket
	if (!isLocalUrl(animUrl) && !isAllowedUpstreamUrl(animUrl, ALLOWED_STORAGE_DOMAINS)) {
		return json({ error: 'URL not allowed' }, { status: 403 });
	}

	try {
		const res = await fetchLocalOrRemote(animUrl);
		if (!res.ok) {
			throw new Error(`Upstream fetch failed: ${res.status} ${res.statusText}`);
		}

		const data = await res.json();

		// Validate it's actually an animation file
		if (!data.type || data.type !== 'animation' || !Array.isArray(data.frames)) {
			return json({ error: 'Not a valid animation file' }, { status: 422 });
		}
		await recordUsageEvent({
			uid: locals.user.uid,
			routeKey: 'load-animation',
			provider: 'firebase',
			statusCode: 200,
			requestBytes,
			metadata: { frameCount: data.frames.length || 0 }
		});

		return json(data);
	} catch (err) {
		console.error('[load-animation] Error:', err);
		await recordUsageEvent({
			uid: locals.user.uid,
			routeKey: 'load-animation',
			provider: 'firebase',
			success: false,
			statusCode: 500,
			requestBytes,
			metadata: { error: String(err.message || 'unknown').slice(0, 200) }
		});
		return json({ error: err.message || 'Failed to load animation' }, { status: 500 });
	}
}
