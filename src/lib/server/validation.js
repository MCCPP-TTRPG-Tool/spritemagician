export function isHttpUrl(value) {
	if (typeof value !== 'string' || !value.trim()) return false;
	try {
		const parsed = new URL(value);
		return parsed.protocol === 'http:' || parsed.protocol === 'https:';
	} catch {
		return false;
	}
}

export function isDataUrl(value) {
	return typeof value === 'string' && value.startsWith('data:');
}

export function isLocalUrl(value) {
	return typeof value === 'string' && value.startsWith('/local/');
}

export function isImageInput(value) {
	return isDataUrl(value) || isHttpUrl(value) || isLocalUrl(value);
}

export function normalizeBoundedInt(value, fallback, min, max) {
	const n = Number(value);
	if (!Number.isFinite(n)) return fallback;
	const i = Math.floor(n);
	return Math.max(min, Math.min(max, i));
}

export function validateImageArray(images, { minItems = 1, maxItems = 32, maxItemChars = 2_000_000 } = {}) {
	if (!Array.isArray(images)) return { ok: false, error: 'images must be an array' };
	if (images.length < minItems) return { ok: false, error: `images must contain at least ${minItems} item(s)` };
	if (images.length > maxItems) return { ok: false, error: `images can contain at most ${maxItems} item(s)` };
	for (let i = 0; i < images.length; i += 1) {
		const image = images[i];
		if (typeof image !== 'string') {
			return { ok: false, error: `images[${i}] must be a string` };
		}
		if (!isImageInput(image)) {
			return { ok: false, error: `images[${i}] must be a data URL, http(s) URL or local library URL` };
		}
		if (image.length > maxItemChars) {
			return { ok: false, error: `images[${i}] is too large` };
		}
	}
	return { ok: true };
}

