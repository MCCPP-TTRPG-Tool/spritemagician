import { verifySessionCookie } from '$lib/firebase/admin.js';

/**
 * Server hook — runs on every request
 * Verifies session cookie and attaches user to event.locals
 */
export async function handle({ event, resolve }) {
	const sessionCookie = event.cookies.get('__session');

	if (sessionCookie) {
		const decodedClaims = await verifySessionCookie(sessionCookie);

		if (decodedClaims) {
			event.locals.user = {
				uid: decodedClaims.uid,
				email: decodedClaims.email || null,
				displayName: decodedClaims.name || null,
				photoURL: decodedClaims.picture || null
			};
		} else {
			// Invalid/expired cookie — clear it
			event.cookies.delete('__session', { path: '/' });
			event.locals.user = null;
		}
	} else {
		event.locals.user = null;
	}

	return resolve(event);
}
