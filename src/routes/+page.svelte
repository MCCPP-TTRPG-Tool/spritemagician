<script>
	import DesignPanel from '$lib/components/DesignPanel.svelte';
	import EditPanel from '$lib/components/EditPanel.svelte';
	import GenerationPanel from '$lib/components/GenerationPanel.svelte';
	import AutoFitPanel from '$lib/components/AutoFitPanel.svelte';
	import CenterPanel from '$lib/components/CenterPanel.svelte';
	import DesignConversationsPanel from '$lib/components/DesignConversationsPanel.svelte';
	import AnimationPreview from '$lib/components/AnimationPreview.svelte';
	import ExportPanel from '$lib/components/ExportPanel.svelte';
	import PreviewContextHeader from '$lib/components/PreviewContextHeader.svelte';
	import UnifiedSaveDialog from '$lib/components/UnifiedSaveDialog.svelte';
	import ModelGeneration3DPanel from '$lib/components/ModelGeneration3DPanel.svelte';
	import RigAnimation3DPanel from '$lib/components/RigAnimation3DPanel.svelte';
	import { designStore } from '$lib/stores/design.js';
	import { authStore } from '$lib/stores/auth.js';
	import { auth } from '$lib/firebase/client.js';
	import { projectStore } from '$lib/stores/project.js';
	import { userFiles } from '$lib/stores/userFiles.js';
	import { createFile } from '$lib/firebase/firestore.js';
	import { goto } from '$app/navigation';
	import { onMount, tick } from 'svelte';
	
	let activeTab = $state('design'); // 'design' | 'edit' | 'animate'
	let rightTab = $state('preview'); // 'preview' | 'export'
	let appMode = $state('home'); // 'home' | '2d' | '3d'
	let homeLeftTab = $state('docs'); // 'docs' | 'tutorials'
	let homeCenterTab = $state('home'); // 'home' | 'settings'
	let showUserMenu = $state(false);
	let showBillingModal = $state(false);
	let showNewProjectModal = $state(false);
	let showDesignConversationsInCenter = $state(false);
	let isSavingStill = $state(false);
	let rightPanelNote = $state('');
	let showUnifiedSaveDialog = $state(false);
	let unifiedSaveFileName = $state('');
	let unifiedSaveFolderId = $state(null);
	let unifiedSaveFolderPath = $state('');
	let unifiedSaveError = $state('');
	let jobsPreviewImage = $state(null);
	let jobsPreviewLabel = $state('');
	let jobsPreviewJobId = $state(null);
	let previewContextUpdatedAt = $state(new Date().toISOString());
	let previousPreviewContextSignature = $state('');
	let featureP1PreviewContextHeader = $state(true);
	let mobilePanelsEl;
	let homeCenterPanelEl;
	const PANEL_STATE_KEY = 'spritemagician.page.panel.v1';
	const FEATURE_P1_PREVIEW_CONTEXT_HEADER_KEY = 'sm.ff.p1_preview_context_header';

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
			const rawFeatureFlag = localStorage.getItem(FEATURE_P1_PREVIEW_CONTEXT_HEADER_KEY);
			if (rawFeatureFlag === '0') {
				featureP1PreviewContextHeader = false;
			}
		} catch {
			// ignore storage parse errors
		}
	}

	// Images passed from FileTree -> store -> here -> component props
	let editImage = $state(null);
	let editSourceFileId = $state(null);
	let editSourceClusterId = $state(null);
	let editForceNewCluster = $state(false);
	let editOutputImage = $state(null);

	// React to FileTree setting editImage in the store
	$effect(() => {
		const img = $projectStore.editImage;
		if (img) {
			editImage = img;
			editSourceFileId = $projectStore.editFileId || null;
			editSourceClusterId = $projectStore.editClusterId || null;
			editForceNewCluster = !!$projectStore.editForceNewCluster;
			activeTab = 'edit';
			// Clear the store value immediately to allow re-triggering with same image
			projectStore.update((s) => ({
				...s,
				editImage: null,
				editFileId: null,
				editClusterId: null,
				editForceNewCluster: false
			}));
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

	$effect(() => {
		if (typeof window === 'undefined') return;

		const onJobsPreviewSelected = (event) => {
			const image = event?.detail?.image || null;
			const label = event?.detail?.label || 'Job Preview';
			const jobId = event?.detail?.jobId || null;
			if (!image) return;
			jobsPreviewImage = image;
			jobsPreviewLabel = label;
			jobsPreviewJobId = jobId;
			rightTab = 'preview';
		};

		window.addEventListener('jobsPreviewSelected', onJobsPreviewSelected);
		return () => window.removeEventListener('jobsPreviewSelected', onJobsPreviewSelected);
	});

	$effect(() => {
		if (typeof window === 'undefined') return;

		const onJobsPreviewCleared = () => {
			jobsPreviewImage = null;
			jobsPreviewLabel = '';
			jobsPreviewJobId = null;
			rightTab = 'preview';
			activeTab = 'animate';
		};

		window.addEventListener('jobsPreviewCleared', onJobsPreviewCleared);
		return () => window.removeEventListener('jobsPreviewCleared', onJobsPreviewCleared);
	});

	$effect(() => {
		if (typeof window === 'undefined') return;

		const onJobsAnimationSelected = () => {
			jobsPreviewImage = null;
			jobsPreviewLabel = '';
			jobsPreviewJobId = null;
			activeTab = 'animate';
			rightTab = 'export';
		};

		window.addEventListener('jobsAnimationSelected', onJobsAnimationSelected);
		return () => window.removeEventListener('jobsAnimationSelected', onJobsAnimationSelected);
	});

	$effect(() => {
		if (typeof window === 'undefined') return;

		const onOpen3DMode = () => {
			appMode = '3d';
		};

		window.addEventListener('open3DMode', onOpen3DMode);
		return () => window.removeEventListener('open3DMode', onOpen3DMode);
	});

	$effect(() => {
		if (typeof window === 'undefined') return;

		const onOpenDesignConversationsCenter = () => {
			showDesignConversationsInCenter = true;
		};
		const onCloseDesignConversationsCenter = () => {
			showDesignConversationsInCenter = false;
		};

		window.addEventListener('openDesignConversationsCenter', onOpenDesignConversationsCenter);
		window.addEventListener('closeDesignConversationsCenter', onCloseDesignConversationsCenter);
		return () => {
			window.removeEventListener('openDesignConversationsCenter', onOpenDesignConversationsCenter);
			window.removeEventListener('closeDesignConversationsCenter', onCloseDesignConversationsCenter);
		};
	});

	$effect(() => {
		if (appMode !== '2d' || activeTab !== 'design') {
			showDesignConversationsInCenter = false;
		}
	});

	let rightPreviewImage = $derived.by(() => {
		if (jobsPreviewImage) return jobsPreviewImage;
		if (activeTab === 'design') return $designStore.generatedImage || null;
		if (activeTab === 'edit') return editOutputImage || editImage || null;
		return null;
	});

	let rightPreviewLabel = $derived.by(() => {
		if (jobsPreviewImage) return jobsPreviewLabel || 'Job Preview';
		if (activeTab === 'design') return 'Design Result';
		if (activeTab === 'edit') return 'Edit Result';
		return 'Animation Preview';
	});

	let useJobsPreviewOverride = $derived(!!jobsPreviewImage);

	const DESIGN_MODEL_LABELS = {
		nano_banana: 'Nano Banana (Gemini)',
		gpt4: 'GPT-4 Image (OpenAI)',
		dalle: 'DALL-E (OpenAI)'
	};

	function emitPreviewUiEvent(name, payload) {
		if (typeof window === 'undefined') return;
		window.dispatchEvent(new CustomEvent(name, { detail: payload }));
	}

	function emitPreviewTelemetry(eventName, payload) {
		if (typeof window === 'undefined') return;
		window.dispatchEvent(
			new CustomEvent('smTelemetryEvent', {
				detail: {
					eventName,
					payload,
					ts: new Date().toISOString()
				}
			})
		);
	}

	function mapPreviewChipLabel(type) {
		if (type === 'design_result') return 'Design Result';
		if (type === 'edit_result') return 'Edit Result';
		if (type === 'jobs_preview') return 'Jobs Preview';
		if (type === 'animation_playback') return 'Animation Playback';
		if (type === 'export_mode') return 'Export Mode';
		return 'Preview';
	}

	function formatPreviewTimestamp(iso) {
		if (!iso) return '';
		try {
			const d = new Date(iso);
			return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
		} catch {
			return '';
		}
	}

	let previewContext = $derived.by(() => {
		const isExportMode = rightTab === 'export';
		const type = isExportMode
			? 'export_mode'
			: jobsPreviewImage
				? 'jobs_preview'
				: activeTab === 'design'
					? 'design_result'
					: activeTab === 'edit'
						? 'edit_result'
						: 'animation_playback';

		const sourceTab = isExportMode ? 'export' : jobsPreviewImage ? 'jobs' : activeTab;
		const sourceJobId = jobsPreviewImage ? jobsPreviewJobId : null;
		const sourceLabel = isExportMode
			? activeTab === 'animate'
				? 'Export > Animation'
				: `Export > ${activeTab === 'design' ? 'Design' : 'Edit'}`
			: jobsPreviewImage
				? `Jobs > ${jobsPreviewLabel || 'Job Preview'}`
				: activeTab === 'design'
					? 'Design > Genesis'
					: activeTab === 'edit'
						? 'Edit > Result'
						: 'Animate > Playback';
		const modelLabel = activeTab === 'design'
			? DESIGN_MODEL_LABELS[$designStore.genesisModel] || null
			: null;
		const signature = `${type}|${sourceTab}|${sourceJobId || ''}|${sourceLabel}|${rightTab}|${activeTab}`;

		return {
			type,
			sourceTab,
			sourceJobId,
			sourceLabel,
			modelLabel,
			isOverride: !!jobsPreviewImage,
			signature
		};
	});

	let previewActionSafetyLine = $derived.by(() => {
		if (rightTab === 'export') {
			return `Export actions target: ${previewContext.sourceLabel}`;
		}
		if (activeTab === 'animate' && !useJobsPreviewOverride) {
			return 'Animation actions target: current animation playback frames.';
		}
		return `Right-panel actions target: ${previewContext.sourceLabel}`;
	});

	$effect(() => {
		if (!featureP1PreviewContextHeader) return;
		const signature = previewContext.signature;
		if (!signature || signature === previousPreviewContextSignature) return;
		previousPreviewContextSignature = signature;
		previewContextUpdatedAt = new Date().toISOString();

		const payload = {
			contextType: previewContext.type,
			sourceTab: previewContext.sourceTab,
			sourceJobId: previewContext.sourceJobId,
			isOverride: previewContext.isOverride,
			sourceLabel: previewContext.sourceLabel
		};
		emitPreviewUiEvent('preview.context.changed', payload);
		emitPreviewTelemetry('sm.p1.preview_context_changed', payload);
	});

	function trackPreviewAction(actionName) {
		if (!featureP1PreviewContextHeader) return;
		const payload = {
			actionName,
			contextType: previewContext.type,
			sourceJobId: previewContext.sourceJobId
		};
		emitPreviewUiEvent('preview.action.invoked', payload);
		emitPreviewTelemetry('sm.p1.preview_action_invoked', payload);
	}

	function resetPreviewContext() {
		const previousSourceJobId = previewContext.sourceJobId;
		const previousContextType = previewContext.type;
		const hadOverride = !!jobsPreviewImage;
		jobsPreviewImage = null;
		jobsPreviewLabel = '';
		jobsPreviewJobId = null;
		rightPanelNote = hadOverride ? 'Preview context reset to active tab source.' : 'No temporary override to reset.';

		if (!featureP1PreviewContextHeader) return;
		const payload = {
			previousContextType: hadOverride ? 'jobs_preview' : previousContextType,
			previousSourceJobId: hadOverride ? previousSourceJobId : null,
			resetReason: 'user_click'
		};
		emitPreviewUiEvent('preview.context.reset', payload);
		emitPreviewTelemetry('sm.p1.preview_context_reset', payload);
	}

	function handleEditOutput(image) {
		editOutputImage = image;
		jobsPreviewImage = null;
		jobsPreviewLabel = '';
		jobsPreviewJobId = null;
	}

	function loadStillIntoEdit() {
		if (!rightPreviewImage) return;
		trackPreviewAction('load_edit');
		editImage = rightPreviewImage;
		editOutputImage = rightPreviewImage;
		activeTab = 'edit';
		jobsPreviewImage = null;
		jobsPreviewLabel = '';
		jobsPreviewJobId = null;
		rightPanelNote = 'Loaded into Edit.';
	}

	function setStillAsStartFrame() {
		if (!rightPreviewImage) return;
		trackPreviewAction('set_start');
		projectStore.update((p) => ({ ...p, firstFrame: rightPreviewImage }));
		rightPanelNote = 'Set as animation start frame.';
	}

	function setStillAsEndFrame() {
		if (!rightPreviewImage) return;
		trackPreviewAction('set_end');
		projectStore.update((p) => ({ ...p, lastFrame: rightPreviewImage }));
		rightPanelNote = 'Set as animation end frame.';
	}

	function sendStillToGptContext() {
		if (!rightPreviewImage) return;
		trackPreviewAction('send_gpt_context');
		designStore.update((state) => ({
			...state,
			mode: 'chat',
			chatReferenceImage: rightPreviewImage
		}));
		activeTab = 'design';
		rightTab = 'preview';
		jobsPreviewImage = null;
		jobsPreviewLabel = '';
		jobsPreviewJobId = null;
		rightPanelNote = 'Sent image to GPT chat context.';
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
		jobsPreviewImage = null;
		jobsPreviewLabel = '';
		jobsPreviewJobId = null;
	}

	$effect(() => {
		if (typeof window === 'undefined') return;
		try {
			localStorage.setItem(PANEL_STATE_KEY, JSON.stringify({ activeTab, rightTab }));
		} catch {
			// ignore storage issues
		}
	});

	const homeProjectThumbnails = [
		{ id: 'new-project', name: 'Create New Project', isCreateNew: true },
		{ id: 'proj-1', name: 'Hero Sprite Pack', emoji: '🧙' },
		{ id: 'proj-2', name: 'Boss Enemy Set', emoji: '🐉' },
		{ id: 'proj-3', name: 'Town NPC Batch', emoji: '🧑' },
		{ id: 'proj-4', name: 'Sci-Fi Props', emoji: '🚀' },
		{ id: 'proj-5', name: 'Forest Creatures', emoji: '🌲' }
	];

	const homeProjectList = [
		{ id: 'list-1', name: 'Hero Sprite Pack', emoji: '🧙' },
		{ id: 'list-2', name: 'Boss Enemy Set', emoji: '🐉' },
		{ id: 'list-3', name: 'Town NPC Batch', emoji: '🧑' },
		{ id: 'list-4', name: 'Sci-Fi Props', emoji: '🚀' },
		{ id: 'list-5', name: 'Forest Creatures', emoji: '🌲' },
		{ id: 'list-6', name: 'Retro UI Kit', emoji: '🎮' }
	];

	let quickSaveFolderId = $derived.by(() => $userFiles?.currentFolderId || null);
	let quickSaveFolderPath = $derived.by(() => {
		const crumbs = Array.isArray($userFiles?.breadcrumbs) ? $userFiles.breadcrumbs : [];
		if (!crumbs.length) return '';
		return crumbs.map((c) => c.name).join(' / ');
	});

	async function focusCenterPanelOnMobile() {
		if (typeof window === 'undefined') return;
		if (window.innerWidth >= 768) return;
		if (!mobilePanelsEl || !homeCenterPanelEl) return;
		await tick();
		mobilePanelsEl.scrollTo({
			left: homeCenterPanelEl.offsetLeft,
			behavior: 'auto'
		});
	}

	onMount(() => {
		if (appMode === 'home') {
			focusCenterPanelOnMobile();
		}
	});

	$effect(() => {
		if (appMode === 'home') {
			focusCenterPanelOnMobile();
		}
	});

	function openStillSavePicker() {
		if (!rightPreviewImage || isSavingStill) return;
		trackPreviewAction('save');
		unifiedSaveError = '';
		unifiedSaveFileName = `${activeTab}_result_${Date.now()}.png`;
		unifiedSaveFolderId = null;
		unifiedSaveFolderPath = '';
		showUnifiedSaveDialog = true;

		const openedPayload = {
			sourceType: 'image',
			sourceRef: previewContext.sourceJobId || previewContext.sourceLabel,
			defaultFolderPath: unifiedSaveFolderPath || null
		};
		emitPreviewUiEvent('save.dialog.opened', openedPayload);
		emitPreviewTelemetry('sm.p1.save_opened', openedPayload);
	}

	async function quickSaveStillToCurrentFolder() {
		if (!rightPreviewImage || isSavingStill) return;
		if (!quickSaveFolderId) {
			rightPanelNote = 'Open a destination folder in File Tree first.';
			return;
		}
		const filename = `${activeTab}_result_${Date.now()}.png`;
		await saveStillToFolder(quickSaveFolderId, quickSaveFolderPath, filename);
	}

	function closeUnifiedSaveDialog() {
		if (isSavingStill) return;
		showUnifiedSaveDialog = false;
		unifiedSaveError = '';
	}

	async function onUnifiedSaveSubmit(payload) {
		const fileName = payload?.fileName?.trim() || '';
		const folderId = payload?.folderId || null;
		const folderPath = payload?.folderPath || '';

		if (!fileName || !folderId) {
			const validationPayload = {
				sourceType: 'image',
				errorFields: [
					...(!fileName ? ['fileName'] : []),
					...(!folderId ? ['folderPath'] : [])
				],
				errorCodes: [
					...(!fileName ? ['missing_filename'] : []),
					...(!folderId ? ['missing_destination'] : [])
				]
			};
			unifiedSaveError = !fileName
				? 'Filename is required.'
				: 'Destination folder is required.';
			emitPreviewUiEvent('save.dialog.validation_failed', validationPayload);
			emitPreviewTelemetry('sm.p1.save_validation_failed', validationPayload);
			return;
		}

		unifiedSaveError = '';
		await saveStillToFolder(folderId, folderPath, fileName);
	}

	async function saveStillToFolder(targetFolderId, targetFolderPath, explicitFilename = '') {
		if (!rightPreviewImage || isSavingStill) return;
		if (!targetFolderId) {
			rightPanelNote = 'Select a destination folder first.';
			return;
		}
		const uid = userFiles.getUid();
		if (!uid) {
			rightPanelNote = 'You must be logged in to save files.';
			return;
		}

		isSavingStill = true;
		rightPanelNote = '';
		const saveStartedAt = Date.now();
		try {
			const submittedPayload = {
				sourceType: 'image',
				sourceRef: previewContext.sourceJobId || previewContext.sourceLabel,
				fileName: explicitFilename || `${activeTab}_result_${Date.now()}.png`,
				folderPath: targetFolderPath || null
			};
			emitPreviewUiEvent('save.dialog.submitted', submittedPayload);

			const filename = explicitFilename || `${activeTab}_result_${Date.now()}.png`;
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
			showUnifiedSaveDialog = false;

			const successPayload = {
				sourceType: 'image',
				destinationPath: targetFolderPath || '',
				durationMs: Date.now() - saveStartedAt,
				overwrite: false
			};
			emitPreviewUiEvent('save.dialog.succeeded', successPayload);
			emitPreviewTelemetry('sm.p1.save_succeeded', successPayload);
		} catch (err) {
			rightPanelNote = err.message || 'Save failed.';
			unifiedSaveError = err.message || 'Save failed.';

			const failedPayload = {
				sourceType: 'image',
				errorCode: 'save_failed',
				retryable: true,
				durationMs: Date.now() - saveStartedAt
			};
			emitPreviewUiEvent('save.dialog.failed', failedPayload);
			emitPreviewTelemetry('sm.p1.save_failed', failedPayload);
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

	function openBillingModal() {
		showBillingModal = true;
		showUserMenu = false;
	}
</script>

<div class="h-screen bg-gray-50 overflow-hidden flex flex-col">
	<header class="px-4 py-2 border-b bg-white flex items-center gap-3">
		<div class="flex-1">
			<h1 class="text-xl font-bold text-gray-900">Sprite Magician</h1>
		</div>
		<div class="flex items-center border rounded overflow-hidden">
			<button
				class="px-4 py-1.5 text-sm font-medium transition-colors {appMode === 'home' ? 'bg-blue-50 text-blue-700' : 'bg-white text-gray-600 hover:bg-gray-50'}"
				onclick={() => appMode = 'home'}
			>
				Home
			</button>
			<button
				class="px-4 py-1.5 text-sm font-medium transition-colors {appMode === '2d' ? 'bg-blue-50 text-blue-700' : 'bg-white text-gray-600 hover:bg-gray-50'}"
				onclick={() => appMode = '2d'}
			>
				2D
			</button>
			<button
				class="px-4 py-1.5 text-sm font-medium transition-colors {appMode === '3d' ? 'bg-blue-50 text-blue-700' : 'bg-white text-gray-600 hover:bg-gray-50'}"
				onclick={() => appMode = '3d'}
			>
				3D
			</button>
		</div>
		<div class="flex-1 flex items-center justify-end gap-3">
			<button
				class="px-2 py-1.5 text-xs rounded border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100"
				onclick={openBillingModal}
			>
				💳 Billing
			</button>
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
			{:else}
				<button
					class="px-2 py-1.5 text-xs rounded border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
					onclick={() => goto('/login')}
				>
					Sign In
				</button>
			{/if}
		</div>
	</header>

	<div bind:this={mobilePanelsEl} class="mobile-panels flex-1 flex md:grid md:grid-cols-3 gap-2 p-2 overflow-x-auto overflow-y-hidden md:overflow-hidden snap-x snap-mandatory md:snap-none">
		<!-- Left Column: Create / Animate -->
		<div class="bg-white rounded shadow overflow-hidden flex flex-col min-h-0 w-full shrink-0 snap-start md:w-auto md:shrink {appMode === 'home' ? 'order-2 md:order-none' : ''}">
			{#if appMode === 'home'}
				<div class="flex border-b">
					<button
						class="flex-1 px-2 py-2 text-xs font-medium transition-colors {homeLeftTab === 'docs' ? 'bg-amber-50 text-amber-600 border-b-2 border-amber-600' : 'text-gray-600 hover:bg-gray-50'}"
						onclick={() => homeLeftTab = 'docs'}
					>
						📚 Docs
					</button>
					<button
						class="flex-1 px-2 py-2 text-xs font-medium transition-colors {homeLeftTab === 'tutorials' ? 'bg-blue-50 text-blue-600 border-b-2 border-blue-600' : 'text-gray-600 hover:bg-gray-50'}"
						onclick={() => homeLeftTab = 'tutorials'}
					>
						🎓 Tutorials
					</button>
				</div>
				<div class="p-3 flex-1 min-h-0 overflow-y-auto">
					{#if homeLeftTab === 'docs'}
						<div class="rounded border border-gray-200 bg-gray-50 p-3">
							<p class="text-xs font-medium text-gray-700">Docs Placeholder</p>
							<p class="text-xs text-gray-500 mt-1">Documentation links will be added in a later phase.</p>
						</div>
					{:else}
						<div class="rounded border border-gray-200 bg-gray-50 p-3">
							<p class="text-xs font-medium text-gray-700">Tutorials Placeholder</p>
							<p class="text-xs text-gray-500 mt-1">Tutorial links and onboarding flows will be added in a later phase.</p>
						</div>
					{/if}
				</div>
			{:else if appMode === '2d'}
				<div class="flex border-b">
				<button
					class="flex-1 px-2 py-2 text-xs font-medium transition-colors {activeTab === 'design' ? 'bg-amber-50 text-amber-600 border-b-2 border-amber-600' : 'text-gray-600 hover:bg-gray-50'}"
					onclick={() => activeTab = 'design'}
				>
					🎨 Design
				</button>
				<button
					class="flex-1 px-2 py-2 text-xs font-medium transition-colors {activeTab === 'edit' ? 'bg-teal-50 text-teal-600 border-b-2 border-teal-600' : 'text-gray-600 hover:bg-gray-50'}"
					onclick={() => activeTab = 'edit'}
				>
					✏️ Edit
				</button>
				<button
					class="flex-1 px-2 py-2 text-xs font-medium transition-colors {activeTab === 'animate' ? 'bg-blue-50 text-blue-600 border-b-2 border-blue-600' : 'text-gray-600 hover:bg-gray-50'}"
					onclick={() => activeTab = 'animate'}
				>
					🎬 Animate
				</button>
				</div>

				<div class="p-2 flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
					{#if activeTab === 'design'}
						<DesignPanel />
					{:else if activeTab === 'edit'}
						<EditPanel
							initialImage={editImage}
							sourceFileId={editSourceFileId}
							sourceClusterId={editSourceClusterId}
							forceNewCluster={editForceNewCluster}
							onChange={handleEditOutput}
						/>
					{:else if activeTab === 'animate'}
						<AutoFitPanel minScale={0.9}>
							<GenerationPanel />
						</AutoFitPanel>
					{/if}
				</div>
			{:else}
				<div class="px-3 py-2 border-b bg-blue-50 text-blue-700 text-xs font-medium">
					3D Workflow
				</div>
				<div class="p-3 flex-1 overflow-y-auto">
					<ModelGeneration3DPanel />
				</div>
			{/if}
		</div>

		<!-- Middle Column: Preview / Export (tabbed) -->
		<div bind:this={homeCenterPanelEl} class="bg-white rounded shadow overflow-hidden flex flex-col min-h-0 w-full shrink-0 snap-start md:w-auto md:shrink {appMode === 'home' ? 'order-1 md:order-none' : ''}">
			{#if appMode === 'home'}
				<div class="flex border-b">
					<button
						class="flex-1 px-2 py-2 text-xs font-medium transition-colors {homeCenterTab === 'home' ? 'bg-blue-50 text-blue-600 border-b-2 border-blue-600' : 'text-gray-600 hover:bg-gray-50'}"
						onclick={() => homeCenterTab = 'home'}
					>
						🏠 Home
					</button>
					<button
						class="flex-1 px-2 py-2 text-xs font-medium transition-colors {homeCenterTab === 'settings' ? 'bg-indigo-50 text-indigo-600 border-b-2 border-indigo-600' : 'text-gray-600 hover:bg-gray-50'}"
						onclick={() => homeCenterTab = 'settings'}
					>
						⚙️ Settings
					</button>
				</div>
				<div class="p-3 flex-1 min-h-0 overflow-y-auto">
					{#if homeCenterTab === 'home'}
						{#if !$authStore.isLoggedIn}
							<div class="rounded-lg border border-gray-200 bg-gray-50 p-3">
								<p class="text-sm font-semibold text-gray-900">Welcome to Sprite Magician</p>
								<p class="text-xs text-gray-600 mt-1">
									Sign in to access your projects, saved outputs, and workspace progress.
								</p>
								<div class="mt-3 rounded border border-blue-200 bg-blue-50 px-3 py-2">
									<p class="text-xs text-blue-700">Login information</p>
									<p class="text-xs text-blue-600 mt-1">Use your existing Firebase account to continue.</p>
									<button
										class="mt-2 px-2 py-1 text-xs rounded bg-blue-600 text-white hover:bg-blue-700"
										onclick={() => goto('/login')}
									>
										Sign In / Create Account
									</button>
								</div>
								<p class="text-xs text-gray-500 mt-3">
									Sprite Magician is a unified 2D/3D creative workspace for generation, editing, and animation workflows.
								</p>
							</div>
						{:else}
							<div class="space-y-3">
								<div class="rounded-lg border border-gray-200 p-3">
									<p class="text-sm font-semibold text-gray-900">Your Current Projects</p>
									<div class="mt-3 grid grid-cols-2 md:grid-cols-3 gap-2">
										{#each homeProjectThumbnails as project}
											{#if project.isCreateNew}
												<button
													class="rounded border-2 border-dashed border-blue-300 bg-blue-50 p-2 text-left hover:bg-blue-100 transition-colors"
													onclick={() => showNewProjectModal = true}
												>
													<div class="h-16 rounded bg-white/70 flex items-center justify-center text-xl">➕</div>
													<p class="text-[11px] text-blue-700 mt-2 font-medium">{project.name}</p>
												</button>
											{:else}
												<div class="rounded border border-gray-200 bg-gray-50 p-2">
													<div class="h-16 rounded bg-white flex items-center justify-center text-xl">{project.emoji}</div>
													<p class="text-[11px] text-gray-700 mt-2 font-medium truncate">{project.name}</p>
												</div>
											{/if}
										{/each}
									</div>
								</div>
								<div class="rounded-lg border border-gray-200 p-3">
									<p class="text-xs font-semibold text-gray-800">Project List</p>
									<div class="mt-2 grid grid-cols-2 md:grid-cols-3 gap-2">
										{#each homeProjectList as project}
											<div class="rounded border border-gray-200 bg-gray-50 p-2 text-center">
												<div class="text-lg">{project.emoji}</div>
												<p class="text-[11px] text-gray-700 mt-1 truncate">{project.name}</p>
											</div>
										{/each}
									</div>
									<p class="text-[10px] text-gray-500 mt-2">Asset/file-system integration placeholder for later refactor.</p>
								</div>
							</div>
						{/if}
					{:else}
						<div class="rounded border border-gray-200 bg-gray-50 p-3">
							<p class="text-xs font-medium text-gray-700">Settings Placeholder</p>
							<p class="text-xs text-gray-500 mt-1">Under construction.</p>
						</div>
					{/if}
				</div>
			{:else if appMode === '2d'}
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
				<div class="flex-1 min-h-0 overflow-hidden flex flex-col">
					<div class="flex-1 min-h-0 overflow-hidden">
						{#if rightTab === 'preview'}
							{#if activeTab === 'animate' && !useJobsPreviewOverride}
								<AnimationPreview />
							{:else}
								<div class="h-full p-2 flex flex-col gap-1.5">
								<div class="flex-1 border rounded bg-gray-100 flex items-center justify-center overflow-hidden">
									{#if rightPreviewImage}
										<img src={rightPreviewImage} alt={rightPreviewLabel} class="max-w-full max-h-full object-contain" />
									{:else}
										<p class="text-xs text-gray-400">No result yet</p>
									{/if}
								</div>
								<div class="grid grid-cols-3 gap-1.5">
									<button class="px-1.5 py-0.5 text-[10px] rounded bg-indigo-500 text-white disabled:bg-gray-400" onclick={setStillAsStartFrame} disabled={!rightPreviewImage}>
										▶ Set Start
									</button>
									<button class="px-1.5 py-0.5 text-[10px] rounded bg-indigo-500 text-white disabled:bg-gray-400" onclick={setStillAsEndFrame} disabled={!rightPreviewImage}>
										⏹ Set End
									</button>
									<button class="px-1.5 py-0.5 text-[10px] rounded bg-teal-500 text-white disabled:bg-gray-400" onclick={loadStillIntoEdit} disabled={!rightPreviewImage}>
										✏️ Load in Edit
									</button>
									<button class="px-1.5 py-0.5 text-[10px] rounded bg-sky-500 text-white disabled:bg-gray-400" onclick={sendStillToGptContext} disabled={!rightPreviewImage}>
										💬 Use in GPT Chat
									</button>
									<button
										class="px-1.5 py-0.5 text-[10px] rounded bg-emerald-500 text-white disabled:bg-gray-400"
										onclick={openStillSavePicker}
										disabled={!rightPreviewImage || isSavingStill}
									>
										{isSavingStill ? '⏳ Saving...' : '💾 Save To...'}
									</button>
									<button
										class="px-1.5 py-0.5 text-[10px] rounded bg-emerald-700 text-white disabled:bg-gray-400"
										onclick={quickSaveStillToCurrentFolder}
										disabled={!rightPreviewImage || isSavingStill || !quickSaveFolderId}
									>
										{isSavingStill ? '⏳ Saving...' : '⚡ Quick Save (Current Folder)'}
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
			{:else}
				<div class="px-3 py-2 border-b bg-blue-50 text-blue-700 text-xs font-medium">
					3D Preview
				</div>
				<div class="flex-1 min-h-0 overflow-y-auto">
					<RigAnimation3DPanel />
				</div>
			{/if}
		</div>

		<!-- Right Column: File Tree / Jobs / Frames -->
		<div class="bg-white rounded shadow overflow-hidden flex flex-col min-h-0 w-full shrink-0 snap-start md:w-auto md:shrink {appMode === 'home' ? 'order-3 md:order-none' : ''}">
			{#if appMode === 'home'}
				<div class="p-3 flex-1 min-h-0 overflow-y-auto space-y-3">
					<div class="rounded-lg border border-gray-200 p-3">
						<p class="text-xs font-semibold text-gray-800">Subscription Plans</p>
						<div class="mt-2 space-y-2">
							<div class="rounded border border-gray-200 bg-gray-50 p-2">
								<p class="text-xs font-medium text-gray-700">Starter</p>
								<p class="text-[11px] text-gray-500">Placeholder plan details</p>
							</div>
							<div class="rounded border border-gray-200 bg-gray-50 p-2">
								<p class="text-xs font-medium text-gray-700">Pro</p>
								<p class="text-[11px] text-gray-500">Placeholder plan details</p>
							</div>
							<div class="rounded border border-gray-200 bg-gray-50 p-2">
								<p class="text-xs font-medium text-gray-700">Studio</p>
								<p class="text-[11px] text-gray-500">Placeholder plan details</p>
							</div>
						</div>
					</div>
					<div class="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
						<p class="text-xs font-semibold text-emerald-800">Wallet</p>
						<p class="text-sm font-bold text-emerald-900 mt-1">Balance: $0.00</p>
						<p class="text-[11px] text-emerald-700 mt-1">Subscription status placeholder.</p>
					</div>
				</div>
			{:else if showDesignConversationsInCenter}
				<DesignConversationsPanel />
			{:else}
				<CenterPanel />
			{/if}
		</div>

	</div>
</div>

<UnifiedSaveDialog
	isOpen={showUnifiedSaveDialog}
	title="Save Image"
	initialFileName={unifiedSaveFileName}
	initialFolderId={unifiedSaveFolderId}
	initialFolderPath={unifiedSaveFolderPath}
	startFolderId={null}
	startFolderName={'Root'}
	forceFolderPick={true}
	autoSubmitOnFolderSelect={true}
	isSaving={isSavingStill}
	errorMessage={unifiedSaveError}
	onClose={closeUnifiedSaveDialog}
	onSubmit={onUnifiedSaveSubmit}
/>

{#if showBillingModal}
	<div
		class="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
		onclick={() => showBillingModal = false}
		onkeydown={(e) => { if (e.key === 'Escape') showBillingModal = false; }}
		role="dialog"
		aria-modal="true"
		tabindex="0"
	>
		<div class="w-full max-w-2xl bg-white rounded-xl shadow-xl border p-4 md:p-5" onclick={(e) => e.stopPropagation()}>
			<div class="flex items-start justify-between gap-3">
				<div>
					<h2 class="text-base md:text-lg font-semibold text-gray-900">Billing & Usage</h2>
					<p class="text-xs text-gray-500 mt-1">Recommended setup for generation-heavy workloads.</p>
				</div>
				<button
					class="text-gray-500 hover:text-gray-800 text-xl leading-none"
					onclick={() => showBillingModal = false}
					aria-label="Close billing modal"
				>
					×
				</button>
			</div>

			<div class="mt-4 space-y-3 text-sm text-gray-700">
				<div class="rounded-lg border border-blue-100 bg-blue-50 p-3">
					<p class="font-medium text-blue-900">Hybrid model (safest)</p>
					<p class="text-xs text-blue-800 mt-1">
						Monthly plans include a fixed credit bundle. Extra usage is prepaid via top-ups.
						This avoids runaway costs if a user hammers generations.
					</p>
				</div>

				<div class="grid md:grid-cols-3 gap-2">
					<div class="rounded-lg border p-3">
						<p class="text-xs font-semibold text-gray-800">Starter</p>
						<p class="text-[11px] text-gray-500 mt-1">Free trial credits only</p>
					</div>
					<div class="rounded-lg border p-3">
						<p class="text-xs font-semibold text-gray-800">Pro Monthly</p>
						<p class="text-[11px] text-gray-500 mt-1">Bundled credits + lower top-up rate</p>
					</div>
					<div class="rounded-lg border p-3">
						<p class="text-xs font-semibold text-gray-800">Studio</p>
						<p class="text-[11px] text-gray-500 mt-1">Shared pool + higher limits</p>
					</div>
				</div>

				<div class="rounded-lg border p-3">
					<p class="font-medium text-gray-900 text-xs">Guardrails to prevent abuse</p>
					<ul class="mt-2 text-xs text-gray-600 list-disc pl-4 space-y-1">
						<li>Hard monthly credit cap by plan.</li>
						<li>Per-user rate limits and queue concurrency limits.</li>
						<li>No auto-overages unless explicitly enabled.</li>
						<li>Require top-up before more generations when credits hit zero.</li>
					</ul>
				</div>

				<div class="rounded-lg border border-amber-200 bg-amber-50 p-3">
					<p class="text-xs text-amber-900">
						Implementation flow: Stripe subscription for monthly bundles, Stripe checkout for one-time credit packs,
						then server-side credit checks before each generation endpoint.
					</p>
				</div>
			</div>

			<div class="mt-4 flex justify-end">
				<button
					class="px-3 py-1.5 text-xs rounded bg-gray-900 text-white hover:bg-black"
					onclick={() => showBillingModal = false}
				>
					Close
				</button>
			</div>
		</div>
	</div>
{/if}

{#if showNewProjectModal}
	<div
		class="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
		onclick={() => showNewProjectModal = false}
		onkeydown={(e) => { if (e.key === 'Escape') showNewProjectModal = false; }}
		role="dialog"
		aria-modal="true"
		tabindex="0"
	>
		<div class="w-full max-w-md bg-white rounded-xl shadow-xl border p-4" onclick={(e) => e.stopPropagation()}>
			<div class="flex items-start justify-between gap-3">
				<div>
					<h2 class="text-base font-semibold text-gray-900">Create New Project</h2>
					<p class="text-xs text-gray-500 mt-1">Project creation flow placeholder.</p>
				</div>
				<button
					class="text-gray-500 hover:text-gray-800 text-xl leading-none"
					onclick={() => showNewProjectModal = false}
					aria-label="Close new project modal"
				>
					×
				</button>
			</div>
			<div class="mt-4 rounded border border-gray-200 bg-gray-50 p-3">
				<p class="text-xs text-gray-600">
					This modal will be connected to the project creation workflow in a later phase.
				</p>
			</div>
			<div class="mt-4 flex justify-end">
				<button
					class="px-3 py-1.5 text-xs rounded bg-gray-900 text-white hover:bg-black"
					onclick={() => showNewProjectModal = false}
				>
					Close
				</button>
			</div>
		</div>
	</div>
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

