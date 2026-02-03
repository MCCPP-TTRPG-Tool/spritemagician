/**
 * Pixelate an image to force a consistent pixel art look
 * Works by downscaling then upscaling with nearest-neighbor
 */

/**
 * Pixelate a single image
 * @param {string} imageDataUrl - Base64 image data URL
 * @param {number} pixelSize - Size of each "pixel" (higher = more pixelated). Default 4
 * @param {number} colorLevels - Number of color levels per channel (lower = more posterized). Default 8
 * @returns {Promise<string>} Pixelated image as data URL
 */
export async function pixelateImage(imageDataUrl, pixelSize = 4, colorLevels = 8) {
	return new Promise((resolve, reject) => {
		const img = new Image();
		img.crossOrigin = 'anonymous';
		
		img.onload = () => {
			const canvas = document.createElement('canvas');
			const ctx = canvas.getContext('2d');
			
			// Original size
			const width = img.width;
			const height = img.height;
			
			// Small size for pixelation
			const smallWidth = Math.floor(width / pixelSize);
			const smallHeight = Math.floor(height / pixelSize);
			
			// Set canvas to small size first
			canvas.width = smallWidth;
			canvas.height = smallHeight;
			
			// Disable smoothing for crisp pixels
			ctx.imageSmoothingEnabled = false;
			
			// Draw scaled down
			ctx.drawImage(img, 0, 0, smallWidth, smallHeight);
			
			// Get image data for color quantization
			const imageData = ctx.getImageData(0, 0, smallWidth, smallHeight);
			const data = imageData.data;
			
			// Posterize - reduce color levels
			const step = 255 / (colorLevels - 1);
			for (let i = 0; i < data.length; i += 4) {
				// Quantize RGB channels
				data[i] = Math.round(data[i] / step) * step;     // R
				data[i + 1] = Math.round(data[i + 1] / step) * step; // G
				data[i + 2] = Math.round(data[i + 2] / step) * step; // B
				// Keep alpha as-is
			}
			
			// Put modified data back
			ctx.putImageData(imageData, 0, 0);
			
			// Create output canvas at original size
			const outputCanvas = document.createElement('canvas');
			const outputCtx = outputCanvas.getContext('2d');
			outputCanvas.width = width;
			outputCanvas.height = height;
			
			// Disable smoothing for crisp upscale
			outputCtx.imageSmoothingEnabled = false;
			
			// Draw scaled up (nearest neighbor due to imageSmoothingEnabled = false)
			outputCtx.drawImage(canvas, 0, 0, width, height);
			
			resolve(outputCanvas.toDataURL('image/png'));
		};
		
		img.onerror = () => reject(new Error('Failed to load image for pixelation'));
		img.src = imageDataUrl;
	});
}

/**
 * Pixelate an array of frames
 * @param {string[]} frames - Array of base64 image data URLs
 * @param {number} pixelSize - Size of each "pixel"
 * @param {number} colorLevels - Number of color levels per channel
 * @param {function} onProgress - Progress callback (index, total)
 * @returns {Promise<string[]>} Array of pixelated frames
 */
export async function pixelateFrames(frames, pixelSize = 4, colorLevels = 8, onProgress = null) {
	const pixelatedFrames = [];
	
	for (let i = 0; i < frames.length; i++) {
		const pixelated = await pixelateImage(frames[i], pixelSize, colorLevels);
		pixelatedFrames.push(pixelated);
		
		if (onProgress) {
			onProgress(i + 1, frames.length);
		}
	}
	
	return pixelatedFrames;
}
