import pkg from 'gifenc';
const { GIFEncoder, quantize, applyPalette } = pkg;

/**
 * Generate an animated GIF from an array of image sources
 * @param {string[]} frames - Array of image data URLs or URLs
 * @param {number} frameSize - Size to render each frame
 * @param {number} fps - Frames per second
 * @returns {Promise<Blob>} - GIF blob
 */
export async function generateGif(frames, frameSize = 256, fps = 12) {
	const delay = Math.round(1000 / fps);
	
	// Create GIF encoder
	const gif = GIFEncoder();
	
	// Process each frame
	for (const frameSrc of frames) {
		const img = await loadImage(frameSrc);
		
		// Create canvas and draw frame
		const canvas = document.createElement('canvas');
		canvas.width = frameSize;
		canvas.height = frameSize;
		const ctx = canvas.getContext('2d');
		
		// Clear with transparent background
		ctx.clearRect(0, 0, frameSize, frameSize);
		
		// Draw image centered/scaled
		const scale = Math.min(frameSize / img.width, frameSize / img.height);
		const width = img.width * scale;
		const height = img.height * scale;
		const x = (frameSize - width) / 2;
		const y = (frameSize - height) / 2;
		ctx.drawImage(img, x, y, width, height);
		
		// Get image data
		const imageData = ctx.getImageData(0, 0, frameSize, frameSize);
		const { data } = imageData;
		
		// Convert to RGB array (gifenc expects flat RGB array)
		const rgb = new Uint8Array(frameSize * frameSize * 3);
		for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
			// Handle transparency by using a background color (grey)
			const alpha = data[i + 3] / 255;
			rgb[j] = Math.round(data[i] * alpha + 128 * (1 - alpha));     // R
			rgb[j + 1] = Math.round(data[i + 1] * alpha + 128 * (1 - alpha)); // G
			rgb[j + 2] = Math.round(data[i + 2] * alpha + 128 * (1 - alpha)); // B
		}
		
		// Quantize to 256 colors
		const palette = quantize(rgb, 256);
		const indexed = applyPalette(rgb, palette);
		
		// Write frame
		gif.writeFrame(indexed, frameSize, frameSize, { palette, delay });
	}
	
	// Finish and get bytes
	gif.finish();
	const bytes = gif.bytes();
	
	return new Blob([bytes], { type: 'image/gif' });
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
