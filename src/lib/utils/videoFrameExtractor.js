/**
 * Extract frames from a video or GIF URL
 * Works in browser using canvas
 */

/**
 * Extract frames from a GIF URL
 * Uses gifuct-js approach with canvas
 */
export async function extractFramesFromGif(gifUrl, maxFrames = 16) {
	return new Promise(async (resolve, reject) => {
		try {
			// Fetch the GIF as array buffer
			const response = await fetch(gifUrl);
			const arrayBuffer = await response.arrayBuffer();
			
			// For GIF parsing, we'll use a simple approach with Image
			// Load as image and capture frames via animation
			const frames = [];
			
			// Create an image element
			const img = new Image();
			img.crossOrigin = 'anonymous';
			
			img.onload = () => {
				// For static image/single frame, just capture it
				const canvas = document.createElement('canvas');
				canvas.width = img.width;
				canvas.height = img.height;
				const ctx = canvas.getContext('2d');
				ctx.drawImage(img, 0, 0);
				
				const dataUrl = canvas.toDataURL('image/png');
				frames.push(dataUrl);
				
				resolve(frames);
			};
			
			img.onerror = () => {
				reject(new Error('Failed to load GIF'));
			};
			
			img.src = gifUrl;
			
		} catch (error) {
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
		const video = document.createElement('video');
		video.crossOrigin = 'anonymous';
		video.muted = true;
		
		const frames = [];
		let currentFrame = 0;
		
		video.onloadedmetadata = () => {
			const duration = video.duration;
			const interval = duration / numFrames;
			
			const canvas = document.createElement('canvas');
			canvas.width = video.videoWidth;
			canvas.height = video.videoHeight;
			const ctx = canvas.getContext('2d');
			
			function captureFrame() {
				if (currentFrame >= numFrames) {
					resolve(frames);
					return;
				}
				
				const targetTime = currentFrame * interval;
				video.currentTime = Math.min(targetTime, duration - 0.01);
			}
			
			video.onseeked = () => {
				ctx.drawImage(video, 0, 0);
				const dataUrl = canvas.toDataURL('image/png');
				frames.push(dataUrl);
				currentFrame++;
				captureFrame();
			};
			
			captureFrame();
		};
		
		video.onerror = () => {
			reject(new Error('Failed to load video'));
		};
		
		video.src = videoUrl;
		video.load();
	});
}

/**
 * Auto-detect format and extract frames
 */
export async function extractFrames(url, numFrames = 8) {
	if (!url) {
		throw new Error('No URL provided');
	}
	
	const lowerUrl = url.toLowerCase();
	
	if (lowerUrl.includes('.gif')) {
		// For GIFs, we need a specialized parser
		// For now, treat as single image and duplicate
		const frames = await extractFramesFromGif(url, numFrames);
		return frames;
	} else if (lowerUrl.includes('.mp4') || lowerUrl.includes('.webm') || lowerUrl.includes('.mov')) {
		return await extractFramesFromVideo(url, numFrames);
	} else {
		// Try video first, fall back to image
		try {
			return await extractFramesFromVideo(url, numFrames);
		} catch {
			return await extractFramesFromGif(url, numFrames);
		}
	}
}

