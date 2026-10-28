/**
 * Wan input preparation.
 *
 * Image-to-video models work at 480p/720p 16:9. A 300 px sprite dropped
 * straight in occupies a tiny patch of that frame and detail smears.
 * prepareWanInput() paints the sprite large and centered on a chroma-key
 * canvas at the model's native size; cropFramesBack() undoes it after
 * frame extraction so the output is the sprite at its original size.
 */
import { CHROMA_KEY_HEX } from '$lib/constants/chromaKey.js';

export const WAN_CANVAS = { width: 832, height: 480 };

function loadImage(src) {
	return new Promise((resolve, reject) => {
		const img = new Image();
		img.onload = () => resolve(img);
		img.onerror = () => reject(new Error('Failed to load image'));
		img.src = src;
	});
}

/**
 * @param {string} dataUrl  sprite (any size, ideally transparent or chroma)
 * @param {{chromaHex?: string, fill?: number, width?: number, height?: number}} [opts]
 *   fill: fraction of the canvas height the sprite should occupy (0.6–0.95)
 * @returns {Promise<{dataUrl: string, crop: {x:number,y:number,w:number,h:number}, original: {w:number,h:number}}>}
 */
export async function prepareWanInput(dataUrl, opts = {}) {
	const { chromaHex = CHROMA_KEY_HEX, fill = 0.85, width = WAN_CANVAS.width, height = WAN_CANVAS.height } = opts;
	const img = await loadImage(dataUrl);
	const original = { w: img.naturalWidth, h: img.naturalHeight };

	// Scale so the sprite fills `fill` of the height (or width if it is wide).
	const maxH = height * fill;
	const maxW = width * fill;
	const scale = Math.min(maxH / original.h, maxW / original.w);
	const w = Math.round(original.w * scale);
	const h = Math.round(original.h * scale);
	const x = Math.round((width - w) / 2);
	const y = Math.round((height - h) / 2);

	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const ctx = canvas.getContext('2d');
	ctx.fillStyle = chromaHex;
	ctx.fillRect(0, 0, width, height);
	ctx.imageSmoothingEnabled = true;
	ctx.imageSmoothingQuality = 'high';
	ctx.drawImage(img, x, y, w, h);

	return { dataUrl: canvas.toDataURL('image/png'), crop: { x, y, w, h }, original };
}

/**
 * Crop generated frames back to the sprite region and resize to the
 * original sprite size. Frames may be any size (the model may output
 * a different resolution than requested); the crop is scaled accordingly.
 */
export async function cropFramesBack(frames, crop, original, onProgress) {
	if (!crop || !original) return frames;
	const out = [];
	for (let i = 0; i < frames.length; i++) {
		const img = await loadImage(frames[i]);
		const sx = img.naturalWidth / WAN_CANVAS.width;
		const sy = img.naturalHeight / WAN_CANVAS.height;
		const canvas = document.createElement('canvas');
		canvas.width = original.w;
		canvas.height = original.h;
		const ctx = canvas.getContext('2d');
		ctx.imageSmoothingEnabled = true;
		ctx.imageSmoothingQuality = 'high';
		ctx.drawImage(img, crop.x * sx, crop.y * sy, crop.w * sx, crop.h * sy, 0, 0, original.w, original.h);
		out.push(canvas.toDataURL('image/png'));
		onProgress?.(i + 1, frames.length);
	}
	return out;
}
