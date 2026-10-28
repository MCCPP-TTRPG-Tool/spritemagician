/**
 * Bundled, read-only resources (example style images, workflow templates).
 *
 * In a packaged Electron app these live under process.resourcesPath and the
 * shell passes SPRITEMAGICIAN_RESOURCES_DIR. From source they are in static/.
 */
import path from 'node:path';
import fs from 'node:fs';

export function getExampleImagesDir() {
	const fromEnv = process.env.SPRITEMAGICIAN_RESOURCES_DIR?.trim();
	if (fromEnv) {
		const packaged = path.join(fromEnv, 'example-images');
		if (fs.existsSync(packaged)) return packaged;
	}
	return path.resolve(process.cwd(), 'static', 'Example images');
}

export function getStaticDir() {
	const fromEnv = process.env.SPRITEMAGICIAN_RESOURCES_DIR?.trim();
	if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;
	return path.resolve(process.cwd(), 'static');
}
