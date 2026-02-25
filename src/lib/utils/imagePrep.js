/**
 * Image preparation utilities for AI model input
 * 
 * Key insight: Pixel art sprites are often very small (64x64, 128x128).
 * AI video models expect ~480-1024px inputs. Sending tiny images produces
 * terrible quality. This module upscales small images with nearest-neighbor
 * to preserve pixel art crispness while giving the model enough resolution
 * to work with.
 */

/**
 * Upscale a small image to at least `minSize` px on each dimension.
 * Uses nearest-neighbor interpolation to preserve pixel art crispness.
 * If the image is already large enough, returns it unchanged.
 *
 * @param {string} dataUrl - Base64 data URL of the image
 * @param {number} minSize - Minimum dimension in pixels (default 480)
 * @returns {Promise<string>} Upscaled image as data URL
 */
export async function prepareImageForModel(dataUrl, minSize = 480) {
	if (!dataUrl || !dataUrl.startsWith('data:')) return dataUrl;

	return new Promise((resolve, reject) => {
		const img = new Image();
		img.onload = () => {
			const { width, height } = img;

			// Already large enough — no upscaling needed
			if (width >= minSize && height >= minSize) {
				console.log(`[imagePrep] Image ${width}x${height} already >= ${minSize}px, no upscale`);
				resolve(dataUrl);
				return;
			}

			// Compute integer scale factor so both dimensions reach minSize
			const scaleX = Math.ceil(minSize / width);
			const scaleY = Math.ceil(minSize / height);
			const scale = Math.max(scaleX, scaleY, 2); // at least 2x

			const newW = width * scale;
			const newH = height * scale;

			const canvas = document.createElement('canvas');
			canvas.width = newW;
			canvas.height = newH;

			const ctx = canvas.getContext('2d');
			// CRITICAL: nearest-neighbor for pixel art
			ctx.imageSmoothingEnabled = false;
			ctx.drawImage(img, 0, 0, newW, newH);

			const upscaled = canvas.toDataURL('image/png');
			console.log(`[imagePrep] Upscaled ${width}x${height} → ${newW}x${newH} (${scale}x) for model input`);
			resolve(upscaled);
		};
		img.onerror = () => reject(new Error('Failed to load image for upscaling'));
		img.src = dataUrl;
	});
}

/**
 * Resize an image so its longest edge is capped at `maxLongEdge`.
 * If the image is already within the cap, it is returned unchanged.
 *
 * @param {string} imageUrlOrDataUrl - Data URL or regular URL
 * @param {number} maxLongEdge - Maximum long edge in px (default 1024)
 * @returns {Promise<string>} Resized PNG data URL or original input when unchanged
 */
export async function clampImageLongEdge(imageUrlOrDataUrl, maxLongEdge = 1024) {
	if (!imageUrlOrDataUrl || !Number.isFinite(maxLongEdge) || maxLongEdge <= 0) {
		return imageUrlOrDataUrl;
	}

	return new Promise((resolve) => {
		const img = new Image();
		img.crossOrigin = 'anonymous';
		img.onload = () => {
			const width = img.naturalWidth || img.width;
			const height = img.naturalHeight || img.height;
			if (!width || !height) {
				resolve(imageUrlOrDataUrl);
				return;
			}

			const longEdge = Math.max(width, height);
			if (longEdge <= maxLongEdge) {
				resolve(imageUrlOrDataUrl);
				return;
			}

			const scale = maxLongEdge / longEdge;
			const targetWidth = Math.max(1, Math.round(width * scale));
			const targetHeight = Math.max(1, Math.round(height * scale));

			const canvas = document.createElement('canvas');
			canvas.width = targetWidth;
			canvas.height = targetHeight;
			const ctx = canvas.getContext('2d');
			if (!ctx) {
				resolve(imageUrlOrDataUrl);
				return;
			}
			ctx.imageSmoothingEnabled = true;
			ctx.imageSmoothingQuality = 'high';
			ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
			resolve(canvas.toDataURL('image/png'));
		};
		img.onerror = () => resolve(imageUrlOrDataUrl);
		img.src = imageUrlOrDataUrl;
	});
}

/**
 * Apply an unsharp-mask sharpening filter to a single frame.
 * This counteracts the softness/blur that video generation models introduce.
 *
 * Algorithm: output = original + amount * (original - blurred)
 *
 * @param {string} dataUrl - Base64 image data URL
 * @param {number} amount  - Sharpening strength (0.3 = subtle, 0.6 = medium, 1.0 = strong)
 * @returns {Promise<string>} Sharpened image as data URL
 */
export async function sharpenFrame(dataUrl, amount = 0.5) {
	if (!dataUrl) return dataUrl;

	return new Promise((resolve, reject) => {
		const img = new Image();
		img.crossOrigin = 'anonymous';

		img.onload = () => {
			const w = img.width;
			const h = img.height;

			// Original canvas
			const origCanvas = document.createElement('canvas');
			origCanvas.width = w;
			origCanvas.height = h;
			const origCtx = origCanvas.getContext('2d');
			origCtx.drawImage(img, 0, 0);
			const origData = origCtx.getImageData(0, 0, w, h);

			// Blurred canvas (box blur via downscale → upscale with smoothing ON)
			const blurScale = 0.5; // 50% downscale for blur kernel
			const smallW = Math.max(1, Math.round(w * blurScale));
			const smallH = Math.max(1, Math.round(h * blurScale));

			const blurCanvas = document.createElement('canvas');
			blurCanvas.width = smallW;
			blurCanvas.height = smallH;
			const blurCtx = blurCanvas.getContext('2d');
			blurCtx.imageSmoothingEnabled = true;
			blurCtx.imageSmoothingQuality = 'high';
			blurCtx.drawImage(img, 0, 0, smallW, smallH);

			// Upscale back with smoothing for blur effect
			const blur2 = document.createElement('canvas');
			blur2.width = w;
			blur2.height = h;
			const blur2Ctx = blur2.getContext('2d');
			blur2Ctx.imageSmoothingEnabled = true;
			blur2Ctx.imageSmoothingQuality = 'high';
			blur2Ctx.drawImage(blurCanvas, 0, 0, w, h);
			const blurData = blur2Ctx.getImageData(0, 0, w, h);

			// Unsharp mask: out = orig + amount * (orig - blur)
			const out = origCtx.createImageData(w, h);
			const od = origData.data;
			const bd = blurData.data;
			const dd = out.data;

			for (let i = 0; i < od.length; i += 4) {
				dd[i]     = clamp(od[i]     + amount * (od[i]     - bd[i]));     // R
				dd[i + 1] = clamp(od[i + 1] + amount * (od[i + 1] - bd[i + 1])); // G
				dd[i + 2] = clamp(od[i + 2] + amount * (od[i + 2] - bd[i + 2])); // B
				dd[i + 3] = od[i + 3]; // Alpha unchanged
			}

			origCtx.putImageData(out, 0, 0);
			resolve(origCanvas.toDataURL('image/png'));
		};
		img.onerror = () => reject(new Error('Failed to load image for sharpening'));
		img.src = dataUrl;
	});
}

function clamp(v) {
	return Math.max(0, Math.min(255, Math.round(v)));
}

/**
 * Sharpen an array of frames with progress callback.
 *
 * @param {string[]} frames     - Array of base64 data URL images
 * @param {number}   amount     - Sharpening amount (default 0.5)
 * @param {function} onProgress - Optional callback (done, total)
 * @returns {Promise<string[]>} Sharpened frames
 */
export async function sharpenFrames(frames, amount = 0.5, onProgress = null) {
	const result = [];
	for (let i = 0; i < frames.length; i++) {
		const sharp = await sharpenFrame(frames[i], amount);
		result.push(sharp);
		if (onProgress) onProgress(i + 1, frames.length);
	}
	return result;
}
