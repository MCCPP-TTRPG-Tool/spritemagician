/**
 * Post-process background removal to clean up remaining background pixels
 * Removes pixels with low alpha or pixels that are too similar to common background colors
 */

/**
 * Clean up remaining background pixels from an image
 * Uses aggressive multi-pass approach for better results
 * @param {string} imageDataUrl - Base64 image data URL
 * @param {number} alphaThreshold - Alpha threshold below which pixels are removed (0-255, default 80)
 * @param {boolean} removeWhite - Remove pixels that are very close to white (default true)
 * @param {boolean} removeGray - Remove pixels that are very close to gray backgrounds (default true)
 * @param {boolean} aggressive - Use more aggressive cleanup (default true)
 * @returns {Promise<string>} Cleaned image as data URL
 */
export async function cleanupBackground(imageDataUrl, alphaThreshold = 80, removeWhite = true, removeGray = true, aggressive = true) {
	if (!imageDataUrl) return imageDataUrl;

	return new Promise((resolve, reject) => {
		const img = new Image();
		img.crossOrigin = 'anonymous';

		img.onload = () => {
			const canvas = document.createElement('canvas');
			canvas.width = img.width;
			canvas.height = img.height;
			const ctx = canvas.getContext('2d');
			ctx.drawImage(img, 0, 0);

			const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
			const data = imageData.data;

			// Detect background color by sampling corners and edges
			const sampleSize = 20; // Sample 20px from each corner/edge
			const backgroundSamples = [];
			
			// Sample corners
			for (let y = 0; y < sampleSize; y++) {
				for (let x = 0; x < sampleSize; x++) {
					// Top-left
					const idx1 = (y * canvas.width + x) * 4;
					// Top-right
					const idx2 = (y * canvas.width + (canvas.width - 1 - x)) * 4;
					// Bottom-left
					const idx3 = ((canvas.height - 1 - y) * canvas.width + x) * 4;
					// Bottom-right
					const idx4 = ((canvas.height - 1 - y) * canvas.width + (canvas.width - 1 - x)) * 4;
					
					[idx1, idx2, idx3, idx4].forEach(idx => {
						if (idx >= 0 && idx < data.length && data[idx + 3] > 200) {
							backgroundSamples.push({
								r: data[idx],
								g: data[idx + 1],
								b: data[idx + 2]
							});
						}
					});
				}
			}
			
			// Sample edges (top, bottom, left, right)
			for (let i = 0; i < sampleSize; i++) {
				// Top edge
				const topIdx = (i * canvas.width + Math.floor(canvas.width / 2)) * 4;
				// Bottom edge
				const bottomIdx = ((canvas.height - 1 - i) * canvas.width + Math.floor(canvas.width / 2)) * 4;
				// Left edge
				const leftIdx = (Math.floor(canvas.height / 2) * canvas.width + i) * 4;
				// Right edge
				const rightIdx = (Math.floor(canvas.height / 2) * canvas.width + (canvas.width - 1 - i)) * 4;
				
				[topIdx, bottomIdx, leftIdx, rightIdx].forEach(idx => {
					if (idx >= 0 && idx < data.length && data[idx + 3] > 200) {
						backgroundSamples.push({
							r: data[idx],
							g: data[idx + 1],
							b: data[idx + 2]
						});
					}
				});
			}
			
			// Calculate average background color
			let bgR = 0, bgG = 0, bgB = 0;
			if (backgroundSamples.length > 0) {
				backgroundSamples.forEach(sample => {
					bgR += sample.r;
					bgG += sample.g;
					bgB += sample.b;
				});
				bgR = Math.round(bgR / backgroundSamples.length);
				bgG = Math.round(bgG / backgroundSamples.length);
				bgB = Math.round(bgB / backgroundSamples.length);
			} else {
				// Fallback to white/gray if no samples
				bgR = bgG = bgB = 192; // #C0C0C0
			}
			
			console.log(`Detected background color: RGB(${bgR}, ${bgG}, ${bgB})`);

			// First pass: Mark pixels for removal
			const toRemove = new Set();
			
			// Process each pixel
			for (let i = 0; i < data.length; i += 4) {
				const r = data[i];
				const g = data[i + 1];
				const b = data[i + 2];
				const a = data[i + 3];
				const x = (i / 4) % canvas.width;
				const y = Math.floor((i / 4) / canvas.width);
				const isOnEdge = x < 8 || x > canvas.width - 8 || y < 8 || y > canvas.height - 8;
				
				// Remove pixels with low alpha (more aggressive threshold)
				if (a < alphaThreshold) {
					toRemove.add(i);
					continue;
				}

				// Remove white/light pixels (common background) - more aggressive
				if (removeWhite) {
					const brightness = (r + g + b) / 3;
					// If pixel is very bright and semi-transparent, likely background
					if (brightness > 220 && a < 240) {
						toRemove.add(i);
						continue;
					}
				}

				// Check for opaque neighbors (to distinguish character pixels from background)
				let hasOpaqueNeighbor = false;
				let opaqueNeighborCount = 0;
				if (x > 0 && x < canvas.width - 1 && y > 0 && y < canvas.height - 1) {
					for (let dy = -2; dy <= 2; dy++) {
						for (let dx = -2; dx <= 2; dx++) {
							if (dx === 0 && dy === 0) continue;
							const neighborY = y + dy;
							const neighborX = x + dx;
							if (neighborY >= 0 && neighborY < canvas.height && neighborX >= 0 && neighborX < canvas.width) {
								const neighborIdx = (neighborY * canvas.width + neighborX) * 4;
								if (neighborIdx >= 0 && neighborIdx < data.length && data[neighborIdx + 3] > 200) {
									hasOpaqueNeighbor = true;
									opaqueNeighborCount++;
								}
							}
						}
					}
				}

				// Remove pixels that match the detected background color
				// This is the key fix - remove pixels matching actual background, not guessing
				if (removeGray) {
					// Calculate color distance from detected background
					const colorDistance = Math.sqrt(
						Math.pow(r - bgR, 2) + 
						Math.pow(g - bgG, 2) + 
						Math.pow(b - bgB, 2)
					);
					
					// Remove pixels that are very close to background color
					// Threshold: 30 color distance units (allows for slight variations)
					if (colorDistance < 30) {
						// If pixel matches background color closely, remove it
						// Even if inside character - rembg often misses these
						toRemove.add(i);
						continue;
					}
					
					// Also remove pixels that are moderately close to background (for semi-transparent artifacts)
					if (colorDistance < 50 && a < 200) {
						toRemove.add(i);
						continue;
					}
				}

				// Edge detection: if pixel has low alpha and few opaque neighbors, remove it
				if (aggressive) {
					if (a < 200 && opaqueNeighborCount < 3) {
						toRemove.add(i);
					} else if (isOnEdge && a < 120) {
						// On edge of image with low alpha - likely background
						toRemove.add(i);
					}
				} else {
					// Less aggressive: only remove if no neighbors
					if (a < 180 && !hasOpaqueNeighbor) {
						toRemove.add(i);
					} else if (isOnEdge && a < 100) {
						toRemove.add(i);
					}
				}
			}

			// Second pass: Apply removals and clean up isolated pixels
			if (aggressive) {
				// Remove marked pixels
				for (const idx of toRemove) {
					data[idx + 3] = 0;
				}
				
				// Third pass: Remove any remaining semi-transparent pixels near removed areas
				for (let i = 0; i < data.length; i += 4) {
					if (data[i + 3] === 0) continue; // Already removed
					
					const x = (i / 4) % canvas.width;
					const y = Math.floor((i / 4) / canvas.width);
					
					// Check if surrounded by transparent pixels
					let transparentNeighbors = 0;
					if (x > 0 && x < canvas.width - 1 && y > 0 && y < canvas.height - 1) {
						for (let dy = -1; dy <= 1; dy++) {
							for (let dx = -1; dx <= 1; dx++) {
								if (dx === 0 && dy === 0) continue;
								const neighborY = y + dy;
								const neighborX = x + dx;
								if (neighborY >= 0 && neighborY < canvas.height && neighborX >= 0 && neighborX < canvas.width) {
									const neighborIdx = (neighborY * canvas.width + neighborX) * 4;
									if (neighborIdx >= 0 && neighborIdx < data.length && data[neighborIdx + 3] < 50) {
										transparentNeighbors++;
									}
								}
							}
						}
					}
					
					// If mostly surrounded by transparent pixels and has low alpha, remove it
					if (transparentNeighbors >= 6 && data[i + 3] < 150) {
						data[i + 3] = 0;
					}
				}
			} else {
				// Simple removal for non-aggressive mode
				for (const idx of toRemove) {
					data[idx + 3] = 0;
				}
			}

			ctx.putImageData(imageData, 0, 0);
			resolve(canvas.toDataURL('image/png'));
		};

		img.onerror = () => reject(new Error('Failed to load image for background cleanup'));
		img.src = imageDataUrl;
	});
}

/**
 * Clean up an array of images
 * @param {string[]} images - Array of image data URLs
 * @param {number} alphaThreshold - Alpha threshold (default 80)
 * @param {function} onProgress - Optional progress callback (done, total)
 * @param {boolean} aggressive - Use aggressive cleanup (default true)
 * @returns {Promise<string[]>} Cleaned images
 */
export async function cleanupBackgrounds(images, alphaThreshold = 80, onProgress = null, aggressive = true) {
	const results = [];
	for (let i = 0; i < images.length; i++) {
		const cleaned = await cleanupBackground(images[i], alphaThreshold, true, true, aggressive);
		results.push(cleaned);
		if (onProgress) onProgress(i + 1, images.length);
	}
	return results;
}
