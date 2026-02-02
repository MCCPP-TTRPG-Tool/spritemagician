/**
 * Proxy endpoint to fetch images and return as base64
 * Bypasses CORS issues with Firebase Storage
 */

import { json } from '@sveltejs/kit';

export async function POST({ request }) {
	try {
		const { url } = await request.json();

		if (!url) {
			return json({ error: 'URL required' }, { status: 400 });
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
