import { generateSpriteSheet, loadImage, downloadBlob } from './spriteSheet.js';

const FRAME_WIDTH = 300;
const FRAME_HEIGHT = 300;

/**
 * Exports all frames as individual PNG files
 */
export async function exportIndividualFrames(frames) {
	for (let i = 0; i < frames.length; i++) {
		const frame = frames[i];
		const img = await loadImage(frame);
		
		const canvas = document.createElement('canvas');
		canvas.width = FRAME_WIDTH;
		canvas.height = FRAME_HEIGHT;
		const ctx = canvas.getContext('2d');
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		ctx.drawImage(img, 0, 0, FRAME_WIDTH, FRAME_HEIGHT);
		
		canvas.toBlob((blob) => {
			downloadBlob(blob, `frame_${String(i).padStart(3, '0')}.png`);
		}, 'image/png');
		
		// Small delay to avoid browser blocking multiple downloads
		await new Promise(resolve => setTimeout(resolve, 100));
	}
}

/**
 * Exports frames as a grid-based sprite sheet
 */
export async function exportSpriteSheet(frames, frameCount) {
	const columns = Math.ceil(Math.sqrt(frameCount));
	const images = await Promise.all(frames.map(loadImage));
	const blob = await generateSpriteSheet(images, FRAME_WIDTH, FRAME_HEIGHT, columns);
	downloadBlob(blob, 'sprite_sheet.png');
}

