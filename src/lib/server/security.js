const rateWindows = new Map();

function nowMs() {
	return Date.now();
}

export function enforceRateLimit({ uid, routeKey, maxRequests, windowMs }) {
	const safeUid = String(uid || 'anonymous');
	const safeRoute = String(routeKey || 'unknown');
	const limit = Math.max(1, Number(maxRequests) || 1);
	const window = Math.max(1000, Number(windowMs) || 60000);
	const key = `${safeUid}:${safeRoute}`;
	const now = nowMs();

	const current = rateWindows.get(key);
	if (!current || now - current.windowStart >= window) {
		rateWindows.set(key, { count: 1, windowStart: now });
		return { allowed: true, remaining: limit - 1, retryAfterSec: 0 };
	}

	if (current.count >= limit) {
		const retryAfterSec = Math.max(1, Math.ceil((window - (now - current.windowStart)) / 1000));
		return { allowed: false, remaining: 0, retryAfterSec };
	}

	current.count += 1;
	return { allowed: true, remaining: limit - current.count, retryAfterSec: 0 };
}

export function approxJsonBytes(value) {
	try {
		return Buffer.byteLength(JSON.stringify(value), 'utf8');
	} catch {
		return Number.MAX_SAFE_INTEGER;
	}
}

export function isAllowedUpstreamUrl(urlStr, allowedDomains) {
	try {
		const parsed = new URL(urlStr);
		return allowedDomains.some((d) => parsed.hostname === d || parsed.hostname.endsWith(`.${d}`));
	} catch {
		return false;
	}
}

