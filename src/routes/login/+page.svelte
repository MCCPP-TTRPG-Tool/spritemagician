<script>
	import { auth, googleProvider } from '$lib/firebase/client.js';
	import { signInWithPopup } from 'firebase/auth';
	import { goto } from '$app/navigation';

	let isLoading = $state(false);
	let error = $state('');

	async function signInWithGoogle() {
		isLoading = true;
		error = '';

		try {
			// 1. Google sign-in popup
			const result = await signInWithPopup(auth, googleProvider);
			const idToken = await result.user.getIdToken();

			// 2. Exchange ID token for session cookie via our API
			const response = await fetch('/api/session', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ idToken })
			});

			if (!response.ok) {
				const data = await response.json();
				throw new Error(data.error || 'Failed to create session');
			}

			// 3. Sign out of client-side Firebase (session cookie handles auth now)
			await auth.signOut();

			// 4. Redirect to app
			goto('/', { replaceState: true, invalidateAll: true });
		} catch (err) {
			console.error('Sign-in error:', err);

			if (err.code === 'auth/popup-closed-by-user') {
				error = '';
			} else if (err.code === 'auth/cancelled-popup-request') {
				error = '';
			} else {
				error = err.message || 'Sign-in failed. Please try again.';
			}
		} finally {
			isLoading = false;
		}
	}
</script>

<svelte:head>
	<title>Sign In — Sprite Magician</title>
</svelte:head>

<div class="min-h-screen bg-gray-50 flex items-center justify-center p-4">
	<div class="w-full max-w-sm">
		<div class="bg-white rounded-lg shadow-lg p-8 text-center">
			<!-- Logo / Title -->
			<div class="mb-6">
				<h1 class="text-2xl font-bold text-gray-900 mb-1">Sprite Magician</h1>
				<p class="text-sm text-gray-500">AI-powered sprite animation tool</p>
			</div>

			<!-- Error -->
			{#if error}
				<div class="mb-4 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
					{error}
				</div>
			{/if}

			<!-- Google Sign In -->
			<button
				onclick={signInWithGoogle}
				disabled={isLoading}
				class="w-full flex items-center justify-center gap-3 px-4 py-3 border border-gray-300 rounded-lg bg-white hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
			>
				{#if isLoading}
					<svg class="animate-spin h-5 w-5 text-gray-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
						<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
						<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
					</svg>
					<span class="text-sm font-medium text-gray-500">Signing in...</span>
				{:else}
					<!-- Google "G" icon -->
					<svg class="h-5 w-5" viewBox="0 0 24 24">
						<path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
						<path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
						<path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
						<path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
					</svg>
					<span class="text-sm font-medium text-gray-700">Continue with Google</span>
				{/if}
			</button>

			<p class="mt-6 text-xs text-gray-400">
				By signing in you agree to our terms of use.
			</p>
		</div>
	</div>
</div>
