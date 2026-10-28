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
	event.locals.user = LOCAL_USER;
	return resolve(event);
}
