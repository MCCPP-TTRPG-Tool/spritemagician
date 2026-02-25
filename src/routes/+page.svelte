<script>
	import DesignPanel from '$lib/components/DesignPanel.svelte';
	import EditPanel from '$lib/components/EditPanel.svelte';
	import GenerationPanel from '$lib/components/GenerationPanel.svelte';
	import AutoFitPanel from '$lib/components/AutoFitPanel.svelte';
	import CenterPanel from '$lib/components/CenterPanel.svelte';
	import AnimationPreview from '$lib/components/AnimationPreview.svelte';
	import ExportPanel from '$lib/components/ExportPanel.svelte';
	import FolderPicker from '$lib/components/FolderPicker.svelte';
	import { designStore } from '$lib/stores/design.js';
	import { activeAssetStore } from '$lib/stores/activeAsset.js';
	import { authStore } from '$lib/stores/auth.js';
	import { auth } from '$lib/firebase/client.js';
	import { projectStore } from '$lib/stores/project.js';
	import { userFiles } from '$lib/stores/userFiles.js';
	import { createFile } from '$lib/firebase/firestore.js';
	import { goto } from '$app/navigation';
	
	let activeTab = $state('design'); // 'design' | 'edit' | 'animate'
	let rightTab = $state('preview'); // 'preview' | 'export'
	let showUserMenu = $state(false);
	let isSavingStill = $state(false);
	let rightPanelNote = $state('');
	let showStillFolderPicker = $state(false);
	const PANEL_STATE_KEY = 'spritemagician.page.panel.v1';

	if (typeof window !== 'undefined') {
		try {
			const raw = localStorage.getItem(PANEL_STATE_KEY);
			if (raw) {
				const parsed = JSON.parse(raw);
				if (parsed?.activeTab === 'design' || parsed?.activeTab === 'edit' || parsed?.activeTab === 'animate') {
					activeTab = parsed.activeTab;
				}
				if (parsed?.rightTab === 'preview' || parsed?.rightTab === 'export') {
					rightTab = parsed.rightTab;
				}
			}
		} catch {
			// ignore storage parse errors
		}
	}

	// Images passed from FileTree -> store -> here -> component props
	let editImage = $state(null);
	let editOutputImage = $state(null);

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
			// Style tab is merged into Edit flow.
			editImage = img;
			editOutputImage = img;
			activeTab = 'edit';
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
		// Only switch if frame changed from null/undefined to a value AND we're not on edit tab
		if (frame && !prevFirstFrame && activeTab !== 'edit') {
			activeTab = 'animate';
		}
		prevFirstFrame = frame;
	});

	// React to FileTree setting lastFrame - switch to animate tab only when newly set from file tree
	$effect(() => {
		const frame = $projectStore.lastFrame;
		// Only switch if frame changed from null/undefined to a value AND we're not on edit tab
		if (frame && !prevLastFrame && activeTab !== 'edit') {
			activeTab = 'animate';
		}
		prevLastFrame = frame;
	});

	// React to animation being loaded from FileTree -> auto-switch to Preview tab
	$effect(() => {
		if ($projectStore._animationLoaded) {
			rightTab = 'preview';
			projectStore.update(s => ({ ...s, _animationLoaded: false }));
		}
	});

	// React to Design panel handoff buttons (Use in Edit/Style/Animate)
	$effect(() => {
		if (typeof window === 'undefined') return;

		const onDesignNavigate = (event) => {
			const tab = event?.detail?.tab;
			if (tab === 'edit' || tab === 'animate') {
				activeTab = tab;
			}
			if (tab === 'style') {
				activeTab = 'edit';
			}
		};

		window.addEventListener('designNavigate', onDesignNavigate);
		return () => window.removeEventListener('designNavigate', onDesignNavigate);
	});

	let rightPreviewImage = $derived.by(() => {
		if (activeTab === 'design') return $designStore.generatedImage || null;
		if (activeTab === 'edit') return editOutputImage || editImage || null;
		return null;
	});

	let rightPreviewLabel = $derived.by(() => {
		if (activeTab === 'design') return 'Design Result';
		if (activeTab === 'edit') return 'Edit Result';
		return 'Animation Preview';
	});

	function handleEditOutput(image) {
		editOutputImage = image;
	}

	function loadStillIntoEdit() {
		if (!rightPreviewImage) return;
		editImage = rightPreviewImage;
		editOutputImage = rightPreviewImage;
		activeTab = 'edit';
		rightPanelNote = 'Loaded into Edit.';
	}

	function setStillAsStartFrame() {
		if (!rightPreviewImage) return;
		projectStore.update((p) => ({ ...p, firstFrame: rightPreviewImage }));
		rightPanelNote = 'Set as animation start frame.';
	}

	function setStillAsEndFrame() {
		if (!rightPreviewImage) return;
		projectStore.update((p) => ({ ...p, lastFrame: rightPreviewImage }));
		rightPanelNote = 'Set as animation end frame.';
	}

	function downloadCurrentStill() {
		if (!rightPreviewImage) return;
		const a = document.createElement('a');
		a.href = rightPreviewImage;
		a.download = `${activeTab}_result_${Date.now()}.png`;
		a.click();
	}

	function sendStillToAnimate() {
		if (!rightPreviewImage) return;
		projectStore.update((p) => ({ ...p, firstFrame: rightPreviewImage }));
		activeTab = 'animate';
		rightTab = 'preview';
	}

	$effect(() => {
		if (typeof window === 'undefined') return;
		try {
			localStorage.setItem(PANEL_STATE_KEY, JSON.stringify({ activeTab, rightTab }));
		} catch {
			// ignore storage issues
		}
	});

	function openStillSavePicker() {
		if (!rightPreviewImage || isSavingStill) return;
		if (!$activeAssetStore?.folderId) {
			rightPanelNote = 'Select an active asset folder first.';
			return;
		}
		showStillFolderPicker = true;
	}

	async function onStillFolderSelect(folderId, folderPath) {
		showStillFolderPicker = false;
		await saveStillToFolder(folderId, folderPath);
	}

	async function saveStillToFolder(targetFolderId, targetFolderPath) {
		if (!rightPreviewImage || isSavingStill) return;
		if (!targetFolderId) {
			rightPanelNote = 'Select an active asset folder first.';
			return;
		}
		const uid = userFiles.getUid();
		if (!uid) {
			rightPanelNote = 'You must be logged in to save files.';
			return;
		}

		isSavingStill = true;
		rightPanelNote = '';
		try {
			const filename = `${activeTab}_result_${Date.now()}.png`;
			const response = await fetch('/api/upload-file', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					imageData: rightPreviewImage,
					filename,
					folder: targetFolderId
				})
			});
			const data = await response.json();
			if (!response.ok) throw new Error(data.error || 'Upload failed');

			await createFile(uid, targetFolderId, filename, data.url, 'image', {
				sourceType: 'right-preview',
				fromTab: activeTab
			});
			rightPanelNote = `Saved to ${targetFolderPath || 'selected folder'}.`;
		} catch (err) {
			rightPanelNote = err.message || 'Save failed.';
		} finally {
			isSavingStill = false;
		}
	}


	async function logout() {
		try {
			// Sign out client-side Firebase (clears onAuthStateChanged -> userFiles store)
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

	<div class="mobile-panels flex-1 flex md:grid md:grid-cols-3 gap-2 p-2 overflow-x-auto overflow-y-hidden md:overflow-hidden snap-x snap-mandatory md:snap-none">
		<!-- Left Column: Create / Animate -->
		<div class="bg-white rounded shadow overflow-hidden flex flex-col min-h-0 w-full shrink-0 snap-start md:w-auto md:shrink">
			<div class="flex border-b">
			<button
				class="flex-1 px-2 py-2 text-xs font-medium transition-colors {activeTab === 'design' ? 'bg-amber-50 text-amber-600 border-b-2 border-amber-600' : 'text-gray-600 hover:bg-gray-50'}"
				onclick={() => activeTab = 'design'}
			>
				Design
			</button>
			<button
				class="flex-1 px-2 py-2 text-xs font-medium transition-colors {activeTab === 'edit' ? 'bg-teal-50 text-teal-600 border-b-2 border-teal-600' : 'text-gray-600 hover:bg-gray-50'}"
				onclick={() => activeTab = 'edit'}
			>
				Edit
			</button>
			<button
				class="flex-1 px-2 py-2 text-xs font-medium transition-colors {activeTab === 'animate' ? 'bg-blue-50 text-blue-600 border-b-2 border-blue-600' : 'text-gray-600 hover:bg-gray-50'}"
				onclick={() => activeTab = 'animate'}
			>
				Animate
			</button>
			</div>
			
			<div class="p-2 flex-1 overflow-hidden">
				{#if activeTab === 'design'}
					<DesignPanel />
				{:else if activeTab === 'edit'}
					<EditPanel initialImage={editImage} onChange={handleEditOutput} />
				{:else if activeTab === 'animate'}
					<AutoFitPanel minScale={0.9}>
						<GenerationPanel />
					</AutoFitPanel>
				{/if}
			</div>
		</div>

		<!-- Middle Column: File Tree / Jobs / Frames -->
		<div class="bg-white rounded shadow overflow-hidden flex flex-col min-h-0 w-full shrink-0 snap-start md:w-auto md:shrink">
			<CenterPanel />
		</div>

		<!-- Right Column: Preview / Export (tabbed) -->
		<div class="bg-white rounded shadow overflow-hidden flex flex-col min-h-0 w-full shrink-0 snap-start md:w-auto md:shrink">
			<div class="flex border-b flex-shrink-0">
				<button
					class="flex-1 px-2 py-2 text-xs font-medium transition-colors {rightTab === 'preview' ? 'bg-blue-50 text-blue-600 border-b-2 border-blue-600' : 'text-gray-600 hover:bg-gray-50'}"
					onclick={() => rightTab = 'preview'}
				>&#x1F3AC; Preview</button>
				<button
					class="flex-1 px-2 py-2 text-xs font-medium transition-colors {rightTab === 'export' ? 'bg-green-50 text-green-600 border-b-2 border-green-600' : 'text-gray-600 hover:bg-gray-50'}"
					onclick={() => rightTab = 'export'}
				>&#x1F4E6; Export</button>
			</div>
			<div class="flex-1 min-h-0 overflow-hidden">
				{#if rightTab === 'preview'}
					{#if activeTab === 'animate'}
						<AnimationPreview />
					{:else}
						<div class="h-full p-3 flex flex-col gap-2">
							<p class="text-xs text-gray-500">{rightPreviewLabel}</p>
							<div class="flex-1 border rounded bg-gray-100 flex items-center justify-center overflow-hidden">
								{#if rightPreviewImage}
									<img src={rightPreviewImage} alt={rightPreviewLabel} class="max-w-full max-h-full object-contain" />
								{:else}
									<p class="text-xs text-gray-400">No result yet</p>
								{/if}
							</div>
							<div class="grid grid-cols-2 gap-2">
								<button class="px-2 py-1.5 text-xs rounded bg-teal-500 text-white disabled:bg-gray-400" onclick={loadStillIntoEdit} disabled={!rightPreviewImage}>
									✏️ Load in Edit
								</button>
								<button class="px-2 py-1.5 text-xs rounded bg-indigo-500 text-white disabled:bg-gray-400" onclick={setStillAsStartFrame} disabled={!rightPreviewImage}>
									▶ Set Start
								</button>
								<button class="px-2 py-1.5 text-xs rounded bg-indigo-500 text-white disabled:bg-gray-400" onclick={setStillAsEndFrame} disabled={!rightPreviewImage}>
									⏹ Set End
								</button>
								<button
									class="px-2 py-1.5 text-xs rounded bg-emerald-500 text-white disabled:bg-gray-400"
									onclick={openStillSavePicker}
									disabled={!rightPreviewImage || isSavingStill}
								>
									{isSavingStill ? '⏳ Saving...' : '💾 Save To...'}
								</button>
							</div>
							{#if rightPanelNote}
								<p class="text-[10px] text-gray-500">{rightPanelNote}</p>
							{/if}
						</div>
					{/if}
				{:else}
					{#if activeTab === 'animate'}
						<div class="p-3 overflow-y-auto h-full">
							<ExportPanel />
						</div>
					{:else}
						<div class="h-full p-3 space-y-2">
							<p class="text-xs text-gray-500">Still Image Export</p>
							<div class="grid grid-cols-2 gap-2">
								<button
									class="px-2 py-2 text-xs rounded bg-green-500 text-white disabled:bg-gray-400"
									onclick={downloadCurrentStill}
									disabled={!rightPreviewImage}
								>
									⬇️ Download
								</button>
								<button
									class="px-2 py-2 text-xs rounded bg-blue-500 text-white disabled:bg-gray-400"
									onclick={sendStillToAnimate}
									disabled={!rightPreviewImage}
								>
									🎬 Send to Animate
								</button>
							</div>
							<p class="text-[10px] text-gray-400">
								Export actions for sprite sheets/video are available in Animate mode.
							</p>
						</div>
					{/if}
				{/if}
			</div>
		</div>

	</div>
</div>

{#if showStillFolderPicker}
	<FolderPicker
		onSelect={onStillFolderSelect}
		onClose={() => showStillFolderPicker = false}
		startFolderId={$activeAssetStore.folderId}
		startFolderName={$activeAssetStore.folderName || 'Asset'}
	/>
{/if}

<style>
	.mobile-panels {
		-webkit-overflow-scrolling: touch;
	}

	@media (max-width: 767px) {
		.mobile-panels {
			scrollbar-width: none;
		}

		.mobile-panels::-webkit-scrollbar {
			display: none;
		}
	}
</style>

