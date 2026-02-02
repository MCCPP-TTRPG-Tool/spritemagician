/**
 * Generates a grid-based sprite sheet from individual frame images
 * @param {Array<ImageData|HTMLImageElement>} frames - Array of frame images
 * @param {number} frameWidth - Width of each frame
 * @param {number} frameHeight - Height of each frame
 * @param {number} columns - Number of columns in the grid
 * @returns {Promise<Blob>} - PNG blob of the sprite sheet
 */
export async function generateSpriteSheet(frames, frameWidth, frameHeight, columns) {
	const rows = Math.ceil(frames.length / columns);
	const canvas = document.createElement('canvas');
	canvas.width = columns * frameWidth;
	canvas.height = rows * frameHeight;
	const ctx = canvas.getContext('2d');

	// Ensure transparent background
	ctx.clearRect(0, 0, canvas.width, canvas.height);

	for (let i = 0; i < frames.length; i++) {
		const col = i % columns;
		const row = Math.floor(i / columns);
		const x = col * frameWidth;
		const y = row * frameHeight;

		const frame = frames[i];
		
		if (frame instanceof ImageData) {
			ctx.putImageData(frame, x, y);
		} else if (frame instanceof HTMLImageElement) {
			ctx.drawImage(frame, x, y, frameWidth, frameHeight);
		} else if (frame instanceof HTMLCanvasElement) {
			ctx.drawImage(frame, x, y, frameWidth, frameHeight);
		}
	}

	return new Promise((resolve) => {
		canvas.toBlob((blob) => {
			resolve(blob);
		}, 'image/png');
	});
}

/**
 * Converts a data URL or blob to an Image element
 * Uses server proxy for external URLs to bypass CORS
 */
export async function loadImage(src) {
	// If it's an external URL, proxy it through our server to get base64
	if (src && !src.startsWith('data:') && src.startsWith('http')) {
		try {
			const response = await fetch('/api/proxy-image', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ url: src })
			});
			
			if (response.ok) {
				const { dataUrl } = await response.json();
				src = dataUrl;
			} else {
				console.error('Proxy failed, trying direct load');
			}
		} catch (e) {
			console.error('Proxy error:', e);
		}
	}
	
	return new Promise((resolve, reject) => {
		const img = new Image();
		img.onload = () => resolve(img);
		img.onerror = (e) => {
			console.error('Failed to load image:', src?.substring(0, 100));
			reject(e);
		};
		img.src = src;
	});
}

/**
 * Downloads a blob as a file
 */
export function downloadBlob(blob, filename) {
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	URL.revokeObjectURL(url);
}

