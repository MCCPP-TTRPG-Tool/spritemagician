import { redirect } from '@sveltejs/kit';

/**
 * Layout server load — passes user session to all pages
 * Also handles auth guard redirect (server-side, before page renders)
 */
export async function load({ locals, url }) {
	const user = locals.user || null;
	const isLoginPage = url.pathname === '/login';

	// If not logged in and not on login page, redirect to login
	if (!user && !isLoginPage) {
		throw redirect(302, '/login');
	}

	// If logged in and on login page, redirect to app
	if (user && isLoginPage) {
		throw redirect(302, '/');
	}

	return {
		user
	};
}
