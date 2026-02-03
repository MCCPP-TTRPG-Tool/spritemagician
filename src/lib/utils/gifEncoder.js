/**
 * Generate an animated GIF from an array of image sources
 * Uses a pure JavaScript GIF encoder (no external dependencies)
 * @param {string[]} frames - Array of image data URLs or URLs
 * @param {number} frameSize - Size to render each frame
 * @param {number} fps - Frames per second
 * @returns {Promise<Blob>} - GIF blob
 */
export async function generateGif(frames, frameSize = 256, fps = 12) {
	const delay = Math.round(100 / fps); // GIF delay is in 1/100th of a second
	
	// Load all images first
	const images = await Promise.all(frames.map(loadImage));
	
	// Create canvas for rendering
	const canvas = document.createElement('canvas');
	canvas.width = frameSize;
	canvas.height = frameSize;
	const ctx = canvas.getContext('2d');
	
	// Use GIF.js library loaded from CDN
	return new Promise((resolve, reject) => {
		// Dynamically load gif.js if not already loaded
		if (!window.GIF) {
			const script = document.createElement('script');
			script.src = 'https://cdnjs.cloudflare.com/ajax/libs/gif.js/0.2.0/gif.js';
			script.onload = () => createGif();
			script.onerror = () => reject(new Error('Failed to load GIF library'));
			document.head.appendChild(script);
		} else {
			createGif();
		}
		
		function createGif() {
			const gif = new window.GIF({
				workers: 2,
				quality: 10,
				width: frameSize,
				height: frameSize,
				workerScript: 'https://cdnjs.cloudflare.com/ajax/libs/gif.js/0.2.0/gif.worker.js'
			});
			
			// Add each frame
			for (const img of images) {
				// Clear canvas with grey background
				ctx.fillStyle = '#808080';
				ctx.fillRect(0, 0, frameSize, frameSize);
				
				// Draw image centered/scaled
				const scale = Math.min(frameSize / img.width, frameSize / img.height);
				const width = img.width * scale;
				const height = img.height * scale;
				const x = (frameSize - width) / 2;
				const y = (frameSize - height) / 2;
				ctx.drawImage(img, x, y, width, height);
				
				// Add frame to GIF
				gif.addFrame(ctx, { copy: true, delay: delay * 10 });
			}
			
			gif.on('finished', (blob) => {
				resolve(blob);
			});
			
			gif.on('error', (err) => {
				reject(new Error('GIF encoding failed: ' + err));
			});
			
			gif.render();
		}
	});
}

/**
 * Load an image from a URL or data URL
 */
function loadImage(src) {
	return new Promise((resolve, reject) => {
		const img = new Image();
		img.crossOrigin = 'anonymous';
		img.onload = () => resolve(img);
		img.onerror = () => reject(new Error('Failed to load image'));
		img.src = src;
	});
}
