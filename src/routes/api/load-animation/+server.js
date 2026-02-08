/**
 * GET /api/load-animation?url=<firebase-storage-url>
 *
 * Proxy endpoint that fetches an .anim.json file from Firebase Storage
 * and returns its contents. This avoids CORS issues when loading
 * animation files from the client.
 */
import { json } from '@sveltejs/kit';

export async function GET({ url }) {
	const animUrl = url.searchParams.get('url');

	if (!animUrl) {
		return json({ error: 'url parameter is required' }, { status: 400 });
	}

	// Only allow fetching from our Firebase Storage bucket
	if (!animUrl.includes('storage.googleapis.com') && !animUrl.includes('firebasestorage.app')) {
		return json({ error: 'Invalid URL — only Firebase Storage URLs allowed' }, { status: 403 });
	}

	try {
		const res = await fetch(animUrl);
		if (!res.ok) {
			throw new Error(`Upstream fetch failed: ${res.status} ${res.statusText}`);
		}

		const data = await res.json();

		// Validate it's actually an animation file
		if (!data.type || data.type !== 'animation' || !Array.isArray(data.frames)) {
			return json({ error: 'Not a valid animation file' }, { status: 422 });
		}

		return json(data);
	} catch (err) {
		console.error('[load-animation] Error:', err);
		return json({ error: err.message || 'Failed to load animation' }, { status: 500 });
	}
}
