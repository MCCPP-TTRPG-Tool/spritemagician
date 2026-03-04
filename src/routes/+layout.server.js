import { redirect } from '@sveltejs/kit';

/**
 * Layout server load — passes user session to all pages
 * Keeps session info available app-wide without forcing login
 */
export async function load({ locals, url }) {
	try {
		const user = locals.user || null;
		const isLoginPage = url.pathname === '/login';

		// If logged in and on login page, redirect to app
		if (user && isLoginPage) {
			throw redirect(302, '/');
		}

		return {
			user
		};
	} catch (error) {
		// If it's a redirect, re-throw it
		if (error?.status === 302 || error?.status === 301) {
			throw error;
		}
		// Log other errors
		console.error('[+layout.server] Error in load function:', error);
		// Return empty user on error
		return {
			user: null
		};
	}
}
