<script>
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import { authStore } from '$lib/stores/auth.js';

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
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>
{@render children()}
