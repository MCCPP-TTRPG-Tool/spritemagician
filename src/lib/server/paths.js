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

/**
 * Write JSON atomically (tmp file + rename). On Windows the rename can fail
 * transiently while an antivirus or Explorer preview holds the file, so retry.
 */
export function writeJsonAtomic(filePath, value) {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
	fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
	let lastErr;
	for (let attempt = 0; attempt < 5; attempt += 1) {
		try {
			fs.renameSync(tmp, filePath);
			return;
		} catch (err) {
			lastErr = err;
			if (!['EPERM', 'EBUSY', 'EACCES'].includes(err.code)) break;
			const until = Date.now() + 50 * (attempt + 1);
			while (Date.now() < until) { /* short blocking backoff */ }
		}
	}
	try { fs.unlinkSync(tmp); } catch { /* ignore */ }
	throw lastErr;
}

/**
 * Read JSON. A corrupt file is moved aside as *.corrupt-<time> instead of
 * being silently treated as empty, so an index is never wiped by accident.
 */
export function readJson(filePath, fallback = null) {
	if (!fs.existsSync(filePath)) return fallback;
	try {
		return JSON.parse(fs.readFileSync(filePath, 'utf8'));
	} catch (err) {
		const backup = `${filePath}.corrupt-${Date.now()}`;
		console.error(`[paths] ${filePath} is not valid JSON (${err.message}); moved to ${backup}`);
		try { fs.renameSync(filePath, backup); } catch { /* ignore */ }
		return fallback;
	}
}
