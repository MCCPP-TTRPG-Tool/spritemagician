import { readable } from 'svelte/store';

/**
 * Sprite Magician is a local, single-user app: there is no sign-in.
 * This store is kept so existing components keep working; it always
 * reports a logged-in local user.
 */
export const LOCAL_USER = {
	uid: 'local',
	email: null,
	displayName: 'Local user',
	photoURL: null
};

export const authStore = readable({
	isLoggedIn: true,
	isLoading: false,
	user: LOCAL_USER
});
