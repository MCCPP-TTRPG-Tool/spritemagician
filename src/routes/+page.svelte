<script>
	import GenerationPanel from '$lib/components/GenerationPanel.svelte';
	import SpriteGenerator from '$lib/components/SpriteGenerator.svelte';
	import CharacterWizard from '$lib/components/CharacterWizard.svelte';
	import PosePanel from '$lib/components/PosePanel.svelte';
	import EditPanel from '$lib/components/EditPanel.svelte';
	import CenterPanel from '$lib/components/CenterPanel.svelte';
	import AnimationPreview from '$lib/components/AnimationPreview.svelte';
	import ExportPanel from '$lib/components/ExportPanel.svelte';
	import { authStore } from '$lib/stores/auth.js';
	import { goto } from '$app/navigation';
	
	let activeTab = $state('create'); // 'create', 'wizard', 'pose', or 'animation'
	let showUserMenu = $state(false);

	async function logout() {
		try {
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
					class="flex-1 px-2 py-2 text-xs font-medium transition-colors {activeTab === 'create' ? 'bg-green-50 text-green-600 border-b-2 border-green-600' : 'text-gray-600 hover:bg-gray-50'}"
					onclick={() => activeTab = 'create'}
				>
					✨ Create
				</button>
				<button
					class="flex-1 px-2 py-2 text-xs font-medium transition-colors {activeTab === 'wizard' ? 'bg-amber-50 text-amber-600 border-b-2 border-amber-600' : 'text-gray-600 hover:bg-gray-50'}"
					onclick={() => activeTab = 'wizard'}
				>
					🧙 Wizard
				</button>
				<button
					class="flex-1 px-2 py-2 text-xs font-medium transition-colors {activeTab === 'pose' ? 'bg-purple-50 text-purple-600 border-b-2 border-purple-600' : 'text-gray-600 hover:bg-gray-50'}"
					onclick={() => activeTab = 'pose'}
				>
					🦴 Pose
				</button>
			<button
				class="flex-1 px-2 py-2 text-xs font-medium transition-colors {activeTab === 'edit' ? 'bg-teal-50 text-teal-600 border-b-2 border-teal-600' : 'text-gray-600 hover:bg-gray-50'}"
				onclick={() => activeTab = 'edit'}
			>
				✏️ Edit
			</button>
			<button
				class="flex-1 px-2 py-2 text-xs font-medium transition-colors {activeTab === 'animation' ? 'bg-blue-50 text-blue-600 border-b-2 border-blue-600' : 'text-gray-600 hover:bg-gray-50'}"
				onclick={() => activeTab = 'animation'}
			>
				🎬 Animate
			</button>
				</div>
				
				<div class="p-3 flex-1 overflow-y-auto">
			{#if activeTab === 'create'}
				<SpriteGenerator />
			{:else if activeTab === 'wizard'}
				<CharacterWizard />
			{:else if activeTab === 'pose'}
				<PosePanel />
			{:else if activeTab === 'edit'}
				<EditPanel />
			{:else}
				<GenerationPanel />
			{/if}
			</div>
		</div>

		<!-- Middle Column: Frames / Poses / Animations -->
		<div class="bg-white rounded shadow p-3 overflow-hidden">
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
