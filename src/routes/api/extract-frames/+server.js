/**
 * Server-side video frame extraction
 * Two modes:
 * 1. Quick mode: Return video as data URL for client-side extraction
 * 2. Direct mode: Extract frames server-side (for large videos or CORS issues)
 */

import { json } from '@sveltejs/kit';

// Maximum video size for base64 mode (10MB)
const MAX_BASE64_SIZE = 10 * 1024 * 1024;

export async function POST({ request }) {
	try {
		const { videoUrl, numFrames = 8, mode = 'auto' } = await request.json();
		
		if (!videoUrl) {
			return json({ error: 'videoUrl required' }, { status: 400 });
		}
		
		console.log(`[extract-frames] Fetching video: ${videoUrl.substring(0, 80)}...`);
		
		// Fetch video
		const response = await fetch(videoUrl);
		if (!response.ok) {
			throw new Error(`Failed to fetch video: ${response.status}`);
		}
		
		const contentType = response.headers.get('content-type');
		const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
		console.log(`[extract-frames] Content-Type: ${contentType}, Size: ${(contentLength / 1024 / 1024).toFixed(2)} MB`);
		
		// Get video as buffer
		const buffer = await response.arrayBuffer();
		const actualSize = buffer.byteLength;
		
		console.log(`[extract-frames] Actual size: ${(actualSize / 1024 / 1024).toFixed(2)} MB`);
		
		// If video is small enough, return as data URL
		if (actualSize <= MAX_BASE64_SIZE) {
			const base64 = Buffer.from(buffer).toString('base64');
			const dataUrl = `data:${contentType || 'video/mp4'};base64,${base64}`;
			
			return json({
				videoDataUrl: dataUrl,
				size: actualSize,
				message: 'Video fetched - extract frames client-side'
			});
		}
		
		// For large videos, we can't easily send the full video
		// Instead, return an error with guidance
		console.warn(`[extract-frames] Video too large for base64 (${(actualSize / 1024 / 1024).toFixed(2)} MB)`);
		
		return json({ 
			error: 'Video too large for server-side processing',
			size: actualSize,
			suggestion: 'Try a shorter duration or lower quality'
		}, { status: 413 });
		
	} catch (error) {
		console.error('[extract-frames] Error:', error);
		return json({ error: error.message }, { status: 500 });
	}
}
