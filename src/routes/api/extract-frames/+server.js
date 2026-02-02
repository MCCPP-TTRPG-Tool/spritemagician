/**
 * Server-side video frame extraction
 * Bypasses CORS by fetching video server-side
 */

import { json } from '@sveltejs/kit';

export async function POST({ request }) {
	try {
		const { videoUrl, numFrames = 8 } = await request.json();
		
		if (!videoUrl) {
			return json({ error: 'videoUrl required' }, { status: 400 });
		}
		
		console.log(`[extract-frames] Fetching video: ${videoUrl.substring(0, 80)}...`);
		
		// Fetch video as buffer
		const response = await fetch(videoUrl);
		if (!response.ok) {
			throw new Error(`Failed to fetch video: ${response.status}`);
		}
		
		const contentType = response.headers.get('content-type');
		console.log(`[extract-frames] Content-Type: ${contentType}`);
		
		// Get video as base64
		const buffer = await response.arrayBuffer();
		const base64 = Buffer.from(buffer).toString('base64');
		const dataUrl = `data:${contentType || 'video/mp4'};base64,${base64}`;
		
		console.log(`[extract-frames] Video size: ${(buffer.byteLength / 1024 / 1024).toFixed(2)} MB`);
		
		// Return video as data URL - client can extract frames from this
		// This bypasses CORS since the data URL is same-origin
		return json({
			videoDataUrl: dataUrl,
			size: buffer.byteLength,
			message: 'Video fetched - extract frames client-side from dataUrl'
		});
		
	} catch (error) {
		console.error('[extract-frames] Error:', error);
		return json({ error: error.message }, { status: 500 });
	}
}
