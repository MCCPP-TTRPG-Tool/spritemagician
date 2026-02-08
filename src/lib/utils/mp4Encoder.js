/**
 * Generate MP4 video from canvas frames using MediaRecorder API
 * More reliable than GIF, smaller file sizes, better quality
 */

/**
 * Generate an MP4 video from an array of image sources
 * @param {string[]} frames - Array of image data URLs or URLs
 * @param {number} frameSize - Size to render each frame
 * @param {number} fps - Frames per second
 * @returns {Promise<Blob>} - MP4 blob
 */
export async function generateMp4(frames, frameSize = 256, fps = 12) {
	// Load all images first
	const images = await Promise.all(frames.map(loadImage));
	
	// Determine actual dimensions from first frame
	const firstImg = images[0];
	const maxDimension = Math.max(firstImg.width, firstImg.height);
	const videoSize = frameSize > 0 ? Math.max(frameSize, maxDimension) : maxDimension;
	
	console.log(`[MP4] Frame dimensions: ${firstImg.width}x${firstImg.height}, Video size: ${videoSize}x${videoSize}`);
	
	// Create canvas for rendering frames
	const canvas = document.createElement('canvas');
	canvas.width = videoSize;
	canvas.height = videoSize;
	const ctx = canvas.getContext('2d', { willReadFrequently: true });
	
	// Disable smoothing to preserve crisp quality
	ctx.imageSmoothingEnabled = false;
	
	// Create a stream from the canvas
	const stream = canvas.captureStream(fps);
	
	// Use MediaRecorder to encode as MP4
	const mimeType = getSupportedMimeType();
	if (!mimeType) {
		throw new Error('MP4 encoding not supported in this browser. Try using a modern browser like Chrome or Edge.');
	}
	
	const mediaRecorder = new MediaRecorder(stream, {
		mimeType,
		videoBitsPerSecond: 2500000 // 2.5 Mbps for good quality
	});
	
	const chunks = [];
	
	return new Promise((resolve, reject) => {
		mediaRecorder.ondataavailable = (e) => {
			if (e.data.size > 0) {
				chunks.push(e.data);
			}
		};
		
		mediaRecorder.onstop = () => {
			const blob = new Blob(chunks, { type: mimeType });
			console.log(`[MP4] Generated video: ${(blob.size / 1024).toFixed(1)} KB`);
			resolve(blob);
		};
		
		mediaRecorder.onerror = (e) => {
			reject(new Error('MediaRecorder error: ' + e.error));
		};
		
		// Start recording
		mediaRecorder.start();
		
		// Draw frames at the specified FPS using setInterval for precise timing
		let frameIndex = 0;
		const frameInterval = 1000 / fps;
		
		// Draw first frame immediately
		ctx.clearRect(0, 0, videoSize, videoSize);
		const firstImg = images[0];
		const scale = Math.min(videoSize / firstImg.width, videoSize / firstImg.height);
		const width = firstImg.width * scale;
		const height = firstImg.height * scale;
		const x = (videoSize - width) / 2;
		const y = (videoSize - height) / 2;
		ctx.drawImage(firstImg, x, y, width, height);
		frameIndex++;
		
		// Draw remaining frames at specified interval
		const intervalId = setInterval(() => {
			if (frameIndex >= images.length) {
				// All frames drawn, stop recording after one more frame interval
				clearInterval(intervalId);
				setTimeout(() => {
					mediaRecorder.stop();
					stream.getTracks().forEach(track => track.stop());
				}, frameInterval);
				return;
			}
			
			// Clear canvas
			ctx.clearRect(0, 0, videoSize, videoSize);
			
			// Draw current frame
			const img = images[frameIndex];
			const scale = Math.min(videoSize / img.width, videoSize / img.height);
			const width = img.width * scale;
			const height = img.height * scale;
			const x = (videoSize - width) / 2;
			const y = (videoSize - height) / 2;
			ctx.drawImage(img, x, y, width, height);
			
			frameIndex++;
		}, frameInterval);
	});
}

/**
 * Get supported MIME type for MP4 encoding
 */
function getSupportedMimeType() {
	const types = [
		'video/webm;codecs=vp9',
		'video/webm;codecs=vp8',
		'video/webm',
		'video/mp4'
	];
	
	for (const type of types) {
		if (MediaRecorder.isTypeSupported(type)) {
			console.log(`[MP4] Using MIME type: ${type}`);
			return type;
		}
	}
	
	return null;
}

function loadImage(src) {
	return new Promise((resolve, reject) => {
		const img = new Image();
		img.crossOrigin = 'anonymous';
		img.onload = () => resolve(img);
		img.onerror = () => reject(new Error('Failed to load image'));
		img.src = src;
	});
}
