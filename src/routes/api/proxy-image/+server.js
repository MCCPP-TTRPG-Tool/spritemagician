/**
 * Proxy endpoint to fetch images and return as base64
 * Bypasses CORS issues with Firebase Storage
 *
 * Domain allowlist prevents SSRF — only trusted origins are fetched.
 */

import { json } from '@sveltejs/kit';

const ALLOWED_DOMAINS = [
	'firebasestorage.googleapis.com',
	'storage.googleapis.com',
	'replicate.delivery',
	'pbxt.replicate.delivery',
];

function isAllowedUrl(urlStr) {
	try {
		const parsed = new URL(urlStr);
		return ALLOWED_DOMAINS.some(d => parsed.hostname === d || parsed.hostname.endsWith('.' + d));
	} catch {
		return false;
	}
}

export async function POST({ request }) {
	try {
		const { url } = await request.json();

		if (!url) {
			return json({ error: 'URL required' }, { status: 400 });
		}

		if (!isAllowedUrl(url)) {
			return json({ error: 'Domain not allowed' }, { status: 403 });
		}

		// Fetch the image
		const response = await fetch(url);
		
		if (!response.ok) {
			return json({ error: `Failed to fetch image: ${response.status}` }, { status: 500 });
		}

		const contentType = response.headers.get('content-type') || 'image/png';
		const arrayBuffer = await response.arrayBuffer();
		const base64 = Buffer.from(arrayBuffer).toString('base64');
		const dataUrl = `data:${contentType};base64,${base64}`;

		return json({ dataUrl });
	} catch (error) {
		console.error('Proxy image error:', error);
		return json({ error: error.message }, { status: 500 });
	}
}
