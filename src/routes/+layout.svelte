<script>
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import { authStore } from '$lib/stores/auth.js';
	import { auth } from '$lib/firebase/client.js';
	import { signInWithCustomToken } from 'firebase/auth';
	import { browser } from '$app/environment';

	let { children, data } = $props();

	// Sync server session data into auth store
	$effect(() => {
		if (data.user) {
			authStore.set({
				isLoggedIn: true,
				isLoading: false,
				user: data.user
			});
		} else {
			authStore.set({
				isLoggedIn: false,
				isLoading: false,
				user: null
			});
		}
	});

	// Auto-sign-in client-side Firebase auth if we have a session but client auth is null
	// This is needed for Firestore security rules to work
	if (browser && data.user) {
		// Check current auth state immediately
		if (!auth.currentUser) {
			// Sign in with custom token
			(async () => {
				try {
					const res = await fetch('/api/get-client-token');
					if (res.ok) {
						const { token } = await res.json();
						await signInWithCustomToken(auth, token);
						console.log('[Layout] Auto-signed in client-side Firebase auth');
					}
				} catch (err) {
					console.warn('[Layout] Failed to auto-sign-in client auth:', err);
				}
			})();
		}

		// Also listen for auth state changes (in case user signs out)
		auth.onAuthStateChanged(async (user) => {
			if (!user && data.user) {
				// We have a server session but no client-side auth - sign in with custom token
				try {
					const res = await fetch('/api/get-client-token');
					if (res.ok) {
						const { token } = await res.json();
						await signInWithCustomToken(auth, token);
						console.log('[Layout] Re-signed in client-side Firebase auth');
					}
				} catch (err) {
					console.warn('[Layout] Failed to re-sign-in client auth:', err);
				}
			}
		});
	}
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>
{@render children()}
