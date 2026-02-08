<script>
	import AssetWizard from '$lib/components/AssetWizard.svelte';
	import EditPanel from '$lib/components/EditPanel.svelte';
	import CharacterWizard from '$lib/components/CharacterWizard.svelte';
	import GenerationPanel from '$lib/components/GenerationPanel.svelte';
	import CenterPanel from '$lib/components/CenterPanel.svelte';
	import AnimationPreview from '$lib/components/AnimationPreview.svelte';
	import ExportPanel from '$lib/components/ExportPanel.svelte';
	import { authStore } from '$lib/stores/auth.js';
	import { auth } from '$lib/firebase/client.js';
	import { projectStore } from '$lib/stores/project.js';
	import { goto } from '$app/navigation';
	
	let activeTab = $state('wizard'); // 'wizard' | 'edit' | 'style' | 'animate'
	let showUserMenu = $state(false);

	// Images passed from FileTree → store → here → component props
	let editImage = $state(null);
	let styleImage = $state(null);

	// React to FileTree setting editImage in the store
	$effect(() => {
		const img = $projectStore.editImage;
		if (img) {
			editImage = img;
			activeTab = 'edit';
			// Clear the store value immediately to allow re-triggering with same image
			projectStore.update(s => ({ ...s, editImage: null }));
		}
	});

	// React to FileTree setting styleImage in the store
	$effect(() => {
		const img = $projectStore.styleImage;
		if (img) {
			styleImage = img;
			activeTab = 'style';
			// Clear the store value immediately to allow re-triggering with same image
			projectStore.update(s => ({ ...s, styleImage: null }));
		}
	});

	// Track previous frame values to detect when they're newly set (not just when they exist)
	let prevFirstFrame = $state(null);
	let prevLastFrame = $state(null);

	// React to FileTree setting firstFrame - switch to animate tab only when newly set from file tree
	// This prevents switching when frames already exist or when set internally by components
	$effect(() => {
		const frame = $projectStore.firstFrame;
		// Only switch if frame changed from null/undefined to a value AND we're not on edit/style tabs
		if (frame && !prevFirstFrame && activeTab !== 'style' && activeTab !== 'edit') {
			activeTab = 'animate';
		}
		prevFirstFrame = frame;
	});

	// React to FileTree setting lastFrame - switch to animate tab only when newly set from file tree
	$effect(() => {
		const frame = $projectStore.lastFrame;
		// Only switch if frame changed from null/undefined to a value AND we're not on edit/style tabs
		if (frame && !prevLastFrame && activeTab !== 'style' && activeTab !== 'edit') {
			activeTab = 'animate';
		}
		prevLastFrame = frame;
	});

	async function logout() {
		try {
			// Sign out client-side Firebase (clears onAuthStateChanged → userFiles store)
			await auth.signOut();
			// Clear server-side session cookie
			await fetch('/api/session', { method: 'DELETE' });
			goto('/login', { replaceState: true, invalidateAll: true });
		} catch (err) {
			console.error('Logout error:', err);
		}
	}
</script>

<div class="h-screen bg-gray-50 overflow-hidden flex flex-col">
	<header class="px-4 py-2 border-b bg-white flex items-center justify-between">
		<h1 class="text-xl font-bold text-gray-900">Sprite Magician</h1>
		<div class="flex items-center gap-3">
			<!-- User Menu -->
			{#if $authStore.isLoggedIn && $authStore.user}
				<div class="relative">
					<button
						class="flex items-center gap-2 text-sm text-gray-700 hover:text-gray-900"
						onclick={() => showUserMenu = !showUserMenu}
					>
						{#if $authStore.user.photoURL}
							<img
								src={$authStore.user.photoURL}
								alt="Avatar"
								class="w-7 h-7 rounded-full"
								referrerpolicy="no-referrer"
							/>
						{:else}
							<div class="w-7 h-7 rounded-full bg-gray-300 flex items-center justify-center text-xs font-medium">
								{($authStore.user.displayName || $authStore.user.email || '?')[0].toUpperCase()}
							</div>
						{/if}
					</button>

					{#if showUserMenu}
						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<div
							class="absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-lg border py-1 z-50"
							onmouseleave={() => showUserMenu = false}
						>
							<div class="px-3 py-2 border-b">
								<p class="text-sm font-medium text-gray-900 truncate">{$authStore.user.displayName || 'User'}</p>
								<p class="text-xs text-gray-500 truncate">{$authStore.user.email}</p>
							</div>
							<button
								class="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-red-50"
								onclick={logout}
							>
								Sign out
							</button>
						</div>
					{/if}
				</div>
			{/if}
		</div>
	</header>

	<div class="flex-1 grid grid-cols-3 gap-2 p-2 overflow-hidden">
		<!-- Left Column: Create / Animate -->
		<div class="bg-white rounded shadow overflow-hidden flex flex-col min-h-0">
			<div class="flex border-b">
			<button
				class="flex-1 px-2 py-2 text-xs font-medium transition-colors {activeTab === 'wizard' ? 'bg-amber-50 text-amber-600 border-b-2 border-amber-600' : 'text-gray-600 hover:bg-gray-50'}"
				onclick={() => activeTab = 'wizard'}
			>
				🪄 Wizard
			</button>
			<button
				class="flex-1 px-2 py-2 text-xs font-medium transition-colors {activeTab === 'edit' ? 'bg-teal-50 text-teal-600 border-b-2 border-teal-600' : 'text-gray-600 hover:bg-gray-50'}"
				onclick={() => activeTab = 'edit'}
			>
				✏️ Edit
			</button>
			<button
				class="flex-1 px-2 py-2 text-xs font-medium transition-colors {activeTab === 'style' ? 'bg-purple-50 text-purple-600 border-b-2 border-purple-600' : 'text-gray-600 hover:bg-gray-50'}"
				onclick={() => activeTab = 'style'}
			>
				✨ Style
			</button>
			<button
				class="flex-1 px-2 py-2 text-xs font-medium transition-colors {activeTab === 'animate' ? 'bg-blue-50 text-blue-600 border-b-2 border-blue-600' : 'text-gray-600 hover:bg-gray-50'}"
				onclick={() => activeTab = 'animate'}
			>
				🎬 Animate
			</button>
			</div>
			
			<div class="p-3 flex-1 overflow-y-auto">
		{#if activeTab === 'wizard'}
			<AssetWizard />
		{:else if activeTab === 'edit'}
			<EditPanel initialImage={editImage} />
		{:else if activeTab === 'style'}
			<CharacterWizard initialReferenceImage={styleImage} />
		{:else if activeTab === 'animate'}
			<GenerationPanel />
		{/if}
		</div>
		</div>

		<!-- Middle Column: File Tree / Jobs / Frames -->
		<div class="bg-white rounded shadow overflow-hidden flex flex-col min-h-0">
			<CenterPanel />
		</div>

		<!-- Right Column: Preview & Export -->
		<div class="flex flex-col gap-2 overflow-hidden">
			<div class="bg-white rounded shadow p-3 flex-1 overflow-y-auto">
				<AnimationPreview />
			</div>
			<div class="bg-white rounded shadow p-3 flex-shrink-0">
				<ExportPanel />
			</div>
		</div>

	</div>
</div>
