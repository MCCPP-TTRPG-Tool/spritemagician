function loadImage(dataUrl) {
	return new Promise((resolve, reject) => {
		const image = new Image();
		image.onload = () => resolve(image);
		image.onerror = () => reject(new Error('Could not load a frame for canvas padding.'));
		image.src = dataUrl;
	});
}

/** Adds the same transparent canvas space on every side of each image frame. */
export async function addCanvasPadding(frames, padding, onProgress = null) {
	const amount = Math.max(0, Math.floor(Number(padding) || 0));
	if (!amount) return frames;

	const output = [];
	for (let index = 0; index < frames.length; index += 1) {
		const image = await loadImage(frames[index]);
		const canvas = document.createElement('canvas');
		canvas.width = image.naturalWidth + amount * 2;
		canvas.height = image.naturalHeight + amount * 2;
		const context = canvas.getContext('2d');
		context.clearRect(0, 0, canvas.width, canvas.height);
		context.drawImage(image, amount, amount);
		output.push(canvas.toDataURL('image/png'));
		onProgress?.(index + 1, frames.length);
	}
	return output;
}
