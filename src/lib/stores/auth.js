import { writable } from 'svelte/store';

/**
 * Auth store — holds the current user session info
 * Populated from server-side layout load (session cookie verification)
 * Updated client-side after login/logout
 */
export const authStore = writable({
	/** @type {boolean} */
	isLoggedIn: false,
	/** @type {boolean} */
	isLoading: true,
	/** @type {{ uid: string, email: string, displayName: string, photoURL: string } | null} */
	user: null
});
