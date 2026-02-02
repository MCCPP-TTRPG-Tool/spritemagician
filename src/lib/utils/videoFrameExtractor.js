/**
 * Extract frames from a video or GIF URL
 * Works in browser using canvas
 */

/**
 * Extract frames from a GIF URL
 */
export async function extractFramesFromGif(gifUrl, maxFrames = 16) {
	return new Promise(async (resolve, reject) => {
		const timeout = setTimeout(() => reject(new Error('GIF extraction timed out')), 30000);
		
		try {
			const img = new Image();
			img.crossOrigin = 'anonymous';
			
			img.onload = () => {
				clearTimeout(timeout);
				const canvas = document.createElement('canvas');
				canvas.width = img.width;
				canvas.height = img.height;
				const ctx = canvas.getContext('2d');
				ctx.drawImage(img, 0, 0);
				
				const dataUrl = canvas.toDataURL('image/png');
				// Duplicate frames to match expected count
				const frames = Array(maxFrames).fill(dataUrl);
				resolve(frames);
			};
			
			img.onerror = () => {
				clearTimeout(timeout);
				reject(new Error('Failed to load GIF'));
			};
			
			img.src = gifUrl;
			
		} catch (error) {
			clearTimeout(timeout);
			reject(error);
		}
	});
}

/**
 * Extract frames from a video URL (mp4, webm)
 * Seeks through the video and captures frames at intervals
 */
export async function extractFramesFromVideo(videoUrl, numFrames = 8) {
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			console.error('Video extraction timed out');
			reject(new Error('Video extraction timed out - CORS issue likely'));
		}, 60000); // 60 second timeout
		
		const video = document.createElement('video');
		video.crossOrigin = 'anonymous';
		video.muted = true;
		video.playsInline = true;
		
		const frames = [];
		let currentFrame = 0;
		
		video.onloadedmetadata = () => {
			console.log(`Video loaded: ${video.duration}s, ${video.videoWidth}x${video.videoHeight}`);
			
			const duration = video.duration;
			if (!duration || duration <= 0) {
				clearTimeout(timeout);
				reject(new Error('Invalid video duration'));
				return;
			}
			
			const interval = duration / numFrames;
			
			const canvas = document.createElement('canvas');
			canvas.width = video.videoWidth || 512;
			canvas.height = video.videoHeight || 512;
			const ctx = canvas.getContext('2d');
			
			function captureFrame() {
				if (currentFrame >= numFrames) {
					clearTimeout(timeout);
					console.log(`Extracted ${frames.length} frames`);
					resolve(frames);
					return;
				}
				
				const targetTime = currentFrame * interval;
				video.currentTime = Math.min(targetTime, duration - 0.01);
			}
			
			video.onseeked = () => {
				try {
					ctx.drawImage(video, 0, 0);
					const dataUrl = canvas.toDataURL('image/png');
					frames.push(dataUrl);
					currentFrame++;
					captureFrame();
				} catch (e) {
					console.error('Frame capture error:', e);
					clearTimeout(timeout);
					reject(new Error('CORS blocked frame capture'));
				}
			};
			
			captureFrame();
		};
		
		video.onerror = (e) => {
			clearTimeout(timeout);
			console.error('Video load error:', e);
			reject(new Error('Failed to load video - check CORS'));
		};
		
		// Try loading the video
		console.log('Loading video:', videoUrl.substring(0, 100) + '...');
		video.src = videoUrl;
		video.load();
	});
}

/**
 * Server-side frame extraction via API
 * Bypasses CORS by fetching video through server, then extracting client-side
 */
export async function extractFramesViaServer(videoUrl, numFrames = 8) {
	console.log('Using server-side proxy for video...');
	
	const response = await fetch('/api/extract-frames', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ videoUrl, numFrames })
	});
	
	if (!response.ok) {
		const error = await response.text();
		throw new Error(`Server proxy failed: ${error}`);
	}
	
	const data = await response.json();
	
	if (data.videoDataUrl) {
		// Extract frames from the proxied data URL (no CORS issues)
		console.log('Got proxied video, extracting frames...');
		return await extractFramesFromVideo(data.videoDataUrl, numFrames);
	}
	
	throw new Error('No video data returned from server');
}

/**
 * Auto-detect format and extract frames
 * Falls back to server-side extraction if CORS fails
 */
export async function extractFrames(url, numFrames = 8) {
	if (!url) {
		throw new Error('No URL provided');
	}
	
	// Handle array of URLs (some models return multiple outputs)
	const videoUrl = Array.isArray(url) ? url[0] : url;
	
	if (!videoUrl || typeof videoUrl !== 'string') {
		throw new Error('Invalid URL format');
	}
	
	const lowerUrl = videoUrl.toLowerCase();
	
	// Determine type
	const isGif = lowerUrl.includes('.gif');
	const isVideo = lowerUrl.includes('.mp4') || lowerUrl.includes('.webm') || lowerUrl.includes('.mov') || lowerUrl.includes('replicate.delivery');
	
	// Try client-side first
	try {
		if (isGif) {
			return await extractFramesFromGif(videoUrl, numFrames);
		} else if (isVideo) {
			return await extractFramesFromVideo(videoUrl, numFrames);
		} else {
			// Try video first
			return await extractFramesFromVideo(videoUrl, numFrames);
		}
	} catch (clientError) {
		console.warn('Client-side extraction failed:', clientError.message);
		
		// Fall back to server-side extraction
		try {
			return await extractFramesViaServer(videoUrl, numFrames);
		} catch (serverError) {
			console.error('Server-side extraction also failed:', serverError.message);
			throw new Error(`Frame extraction failed: ${clientError.message}. Server fallback: ${serverError.message}`);
		}
	}
}
