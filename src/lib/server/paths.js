/**
 * Data directory resolution.
 *
 * Everything Sprite Magician persists (library files, index, jobs, settings)
 * lives under one folder on the user's disk:
 *
 *   SPRITEMAGICIAN_DATA_DIR  (env, set by the Electron shell or the user)
 *   ~/SpriteMagician         (default)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let cachedDataDir = null;

export function getDataDir() {
	if (cachedDataDir) return cachedDataDir;
	const fromEnv = process.env.SPRITEMAGICIAN_DATA_DIR?.trim();
	cachedDataDir = fromEnv ? path.resolve(fromEnv) : path.join(os.homedir(), 'SpriteMagician');
	fs.mkdirSync(cachedDataDir, { recursive: true });
	return cachedDataDir;
}

export function getSettingsPath() {
	return path.join(getDataDir(), 'settings.json');
}

export function getLibraryDir() {
	const dir = path.join(getDataDir(), 'library');
	fs.mkdirSync(dir, { recursive: true });
	return dir;
}

export function getDbDir() {
	const dir = path.join(getDataDir(), 'db');
	fs.mkdirSync(dir, { recursive: true });
	return dir;
}

export function getScratchDir() {
	const dir = path.join(getDataDir(), 'scratch');
	fs.mkdirSync(dir, { recursive: true });
	return dir;
}

/** Write JSON atomically (tmp file + rename). */
export function writeJsonAtomic(filePath, value) {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
	fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
	fs.renameSync(tmp, filePath);
}

export function readJson(filePath, fallback = null) {
	try {
		return JSON.parse(fs.readFileSync(filePath, 'utf8'));
	} catch {
		return fallback;
	}
}
