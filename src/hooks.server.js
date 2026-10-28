import { ensureDefaultFolders } from '$lib/server/library.js';

/**
 * Sprite Magician runs as a single-user local app. There is no login:
 * every request is the local user. Routes that used to check
 * `locals.user` keep working unchanged.
 */
export const LOCAL_USER = {
	uid: 'local',
	email: null,
	displayName: 'Local user',
	photoURL: null
};

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

function hostName(hostHeader) {
	const h = String(hostHeader || '').trim().toLowerCase();
	if (!h) return '';
	if (h.startsWith('[')) return h.slice(0, h.indexOf(']') + 1);
	return h.split(':')[0];
}

/**
 * Only the app's own window (same origin on a loopback host) may call the
 * API or read library files. This blocks other websites open in the user's
 * browser from talking to the local server, and DNS-rebinding tricks.
 */
function isTrustedRequest(event) {
	const host = hostName(event.request.headers.get('host'));
	if (!LOCAL_HOSTS.has(host)) return false;

	const origin = event.request.headers.get('origin');
	if (origin) {
		try {
			const o = new URL(origin);
			if (!LOCAL_HOSTS.has(o.hostname.toLowerCase()) && !LOCAL_HOSTS.has(`[${o.hostname.toLowerCase()}]`)) return false;
			const requestHost = String(event.request.headers.get('host') || '').toLowerCase();
			if (o.host.toLowerCase() !== requestHost) return false;
		} catch {
			return false;
		}
	}

	// Browsers send Sec-Fetch-Site on cross-site requests; reject those outright.
	const fetchSite = event.request.headers.get('sec-fetch-site');
	if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') return false;

	return true;
}

let bootstrapped = false;

export async function handle({ event, resolve }) {
	if (!bootstrapped) {
		bootstrapped = true;
		try {
			ensureDefaultFolders();
		} catch (err) {
			console.warn('[hooks.server] could not create default folders:', err?.message);
		}
	}

	const { pathname } = event.url;
	if ((pathname.startsWith('/api/') || pathname.startsWith('/local/')) && !isTrustedRequest(event)) {
		return new Response(JSON.stringify({ error: 'Forbidden: cross-origin request to local server' }), {
			status: 403,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	event.locals.user = LOCAL_USER;
	return resolve(event);
}
