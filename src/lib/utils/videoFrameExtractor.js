/**
 * Extract frames from a video, GIF, or animated WebP URL
 * Works in browser using canvas and video/image elements
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
 * Extract frames from an animated WebP URL.
 * 
 * Strategy:
 * 1. Try loading as a <video> (Chrome/Edge support WebP in <video> natively)
 * 2. Fall back to loading as <img> and capturing the visible frame
 * 3. If both fail, route through server proxy
 */
export async function extractFramesFromWebP(webpUrl, numFrames = 8) {
	// First try the video element path — Chrome can seek through animated WebP
	try {
		return await extractFramesFromVideo(webpUrl, numFrames);
	} catch {
		console.log('[WebP] Video path failed, trying image capture...');
	}

	// Fallback: load as image (only captures current/first frame)
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => reject(new Error('WebP extraction timed out')), 30000);

		const img = new Image();
		img.crossOrigin = 'anonymous';

		img.onload = () => {
			clearTimeout(timeout);
			try {
				const canvas = document.createElement('canvas');
				canvas.width = img.naturalWidth || img.width;
				canvas.height = img.naturalHeight || img.height;
				const ctx = canvas.getContext('2d');
				ctx.drawImage(img, 0, 0);

				const dataUrl = canvas.toDataURL('image/png');
				// Duplicate the captured frame to fill the expected count
				const frames = Array(numFrames).fill(dataUrl);
				console.log(`[WebP] Captured first frame, duplicated to ${numFrames} frames`);
				resolve(frames);
			} catch (e) {
				reject(new Error('CORS blocked WebP frame capture'));
			}
		};

		img.onerror = () => {
			clearTimeout(timeout);
			reject(new Error('Failed to load animated WebP'));
		};

		img.src = webpUrl;
	});
}

/**
 * Extract frames from a video URL (mp4, webm)
 */
export async function extractFramesFromVideo(videoUrl, numFrames = 8) {
	return new Promise((resolve, reject) => {
		let settled = false;
		let timeout = null;
		
		const video = document.createElement('video');
		video.crossOrigin = 'anonymous';
		video.muted = true;
		video.playsInline = true;
		// CRITICAL: Set video to natural size - prevent CSS scaling
		video.style.width = 'auto';
		video.style.height = 'auto';
		video.style.position = 'absolute';
		video.style.visibility = 'hidden';
		video.style.pointerEvents = 'none';
		
		const frames = [];
		let currentFrame = 0;
		
		let canvas, ctx, videoWidth, videoHeight, duration, interval;

		function cleanup() {
			if (timeout) {
				clearTimeout(timeout);
				timeout = null;
			}
			video.onseeked = null;
			video.onloadedmetadata = null;
			video.oncanplaythrough = null;
			video.onerror = null;
			video.removeAttribute('src');
			video.load();
			video.remove();
		}

		function safeResolve(value) {
			if (settled) return;
			settled = true;
			cleanup();
			resolve(value);
		}

		function safeReject(error) {
			if (settled) return;
			settled = true;
			cleanup();
			reject(error);
		}

		timeout = setTimeout(() => {
			console.error('Video extraction timed out');
			safeReject(new Error('Video extraction timed out - CORS issue likely'));
		}, 120000);
		
		function initializeExtraction() {
			if (settled) return;
			videoWidth = video.videoWidth;
			videoHeight = video.videoHeight;
			
			if (!videoWidth || !videoHeight) {
				safeReject(new Error('Video dimensions not available'));
				return;
			}
			
			duration = video.duration;
			if (!duration || duration <= 0) {
				safeReject(new Error('Invalid video duration'));
				return;
			}
			
			console.log(`Video loaded: ${duration}s, ${videoWidth}x${videoHeight}`);
			
			interval = duration / numFrames;
			
			canvas = document.createElement('canvas');
			// Use exact video resolution - no scaling
			canvas.width = videoWidth;
			canvas.height = videoHeight;
			ctx = canvas.getContext('2d', { willReadFrequently: true });
			
			// Disable smoothing to preserve crisp quality from video
			// This prevents browser from blurring frames during extraction
			ctx.imageSmoothingEnabled = false;
			
			// Start capturing frames
			captureFrame();
		}
		
		function captureFrame() {
			if (settled) return;
			if (currentFrame >= numFrames) {
				console.log(`Extracted ${frames.length} frames at ${videoWidth}x${videoHeight}`);
				safeResolve(frames);
				return;
			}
			
			const targetTime = currentFrame * interval;
			video.currentTime = Math.min(targetTime, duration - 0.01);
		}
		
		video.onseeked = () => {
			if (settled) return;
			try {
				// Draw video frame at exact resolution - use natural video dimensions
				ctx.drawImage(video, 0, 0, videoWidth, videoHeight);
				// PNG is lossless - no quality parameter needed
				const dataUrl = canvas.toDataURL('image/png');
				frames.push(dataUrl);
				currentFrame++;
				captureFrame();
			} catch (e) {
				console.error('Frame capture error:', e);
				safeReject(new Error('CORS blocked frame capture'));
			}
		};
		
		video.onloadedmetadata = () => {
			if (settled) return;
			// Check if video is already ready
			if (video.readyState >= 2) { // HAVE_CURRENT_DATA
				initializeExtraction();
			} else {
				// Wait for video to be ready
				video.oncanplaythrough = initializeExtraction;
			}
		};
		
		video.onerror = (e) => {
			if (settled) return;
			console.error('Video load error:', e);
			safeReject(new Error('Failed to load video - check CORS'));
		};
		
		// Try loading the video
		console.log('Loading video:', videoUrl.substring(0, 100) + '...');
		video.src = videoUrl;
		video.load();
	});
}

/**
 * Server-side frame extraction via API
 * Bypasses CORS by fetching media through server, then extracting client-side.
 * Handles video (mp4/webm), animated WebP, and GIF via content-type routing.
 */
export async function extractFramesViaServer(videoUrl, numFrames = 8) {
	console.log('Using server-side proxy for media...');
	
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
		const ct = (data.contentType || '').toLowerCase();
		console.log(`Got proxied media (${ct}), extracting frames...`);

		// Route by content type returned from the server
		if (ct.includes('webp')) {
			return await extractFramesFromWebP(data.videoDataUrl, numFrames);
		} else if (ct.includes('gif')) {
			return await extractFramesFromGif(data.videoDataUrl, numFrames);
		} else {
			return await extractFramesFromVideo(data.videoDataUrl, numFrames);
		}
	}
	
	throw new Error('No media data returned from server');
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
	const isWebP = lowerUrl.includes('.webp');
	const isVideo = lowerUrl.includes('.mp4') || lowerUrl.includes('.webm') || lowerUrl.includes('.mov') || lowerUrl.includes('replicate.delivery');
	
	// Try client-side first
	try {
		if (isGif) {
			return await extractFramesFromGif(videoUrl, numFrames);
		} else if (isWebP) {
			return await extractFramesFromWebP(videoUrl, numFrames);
		} else if (isVideo) {
			return await extractFramesFromVideo(videoUrl, numFrames);
		} else {
			// Unknown format — try video first
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
