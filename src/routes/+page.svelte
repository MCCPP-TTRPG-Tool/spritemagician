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
	import SettingsPanel from '$lib/components/SettingsPanel.svelte';
	import { projectStore } from '$lib/stores/project.js';
	import { userFiles } from '$lib/stores/userFiles.js';
	import { createFile, getAllItems } from '$lib/library/client.js';
	import { goto } from '$app/navigation';
	import { onMount, tick } from 'svelte';
	
	let activeTab = $state('design'); // 'design' | 'edit' | 'animate'
	let rightTab = $state('preview'); // 'preview' | 'export'
	let appMode = $state('home'); // 'home' | '2d' | '3d'
	let homeLeftTab = $state('docs'); // 'docs' | 'tutorials'
	let homeCenterTab = $state('home'); // 'home' | 'settings'
	let threeDLeftTab = $state('generate'); // 'generate' | 'rigging' | 'animation'
	let threeDMiddleTab = $state('viewport'); // viewport-only for now
	let showSettingsModal = $state(false);
	let recentFiles = $state([]);
	let replicateConfigured = $state(true);
	let prefs = $state({});
	let spentUsd = $state(0);
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
		const onOpen3DLeftTab = (event) => {
			const tab = event?.detail?.tab;
			if (tab === 'generate' || tab === 'rigging' || tab === 'animation') {
				threeDLeftTab = tab;
			}
		};
		window.addEventListener('open3DLeftTab', onOpen3DLeftTab);
		return () => window.removeEventListener('open3DLeftTab', onOpen3DLeftTab);
	});

	function setThreeDLeftTab(tab) {
		if (tab !== 'generate' && tab !== 'rigging' && tab !== 'animation') return;
		threeDLeftTab = tab;
		if (typeof window !== 'undefined') {
			window.dispatchEvent(new CustomEvent('open3DLeftTab', { detail: { tab } }));
		}
	}

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

	async function loadHome() {
		try {
			const items = await getAllItems();
			recentFiles = items
				.filter((i) => !i.isFolder && i.fileType !== 'file')
				.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
				.slice(0, 12);
		} catch { /* library not ready */ }
		try {
			const res = await fetch('/api/settings');
			const data = await res.json();
			const rep = data.keys?.find((k) => k.name === 'REPLICATE_API_TOKEN');
			replicateConfigured = !!rep?.configured;
			prefs = data.preferences || {};
			if (appMode === '3d' && !prefs.show3D) appMode = 'home';
			try {
				const u = await (await fetch('/api/usage')).json();
				spentUsd = Number(u.spentUsd) || 0;
			} catch { /* ignore */ }
			if (!replicateConfigured && !localStorage.getItem('spritemagician_settings_prompted')) {
				localStorage.setItem('spritemagician_settings_prompted', '1');
				showSettingsModal = true;
			}
		} catch { /* ignore */ }
	}
	onMount(() => {
		loadHome();
		window.addEventListener('smPreferencesChanged', (e) => { prefs = e.detail || {}; });
		window.addEventListener('animationCompleted', loadHome);
	});
	$effect(() => {
		if (!showSettingsModal) loadHome();
	});

	function openRecentFile(item) {
		appMode = '2d';
		if (item.fileType === 'image') {
			jobsPreviewImage = item.url;
			jobsPreviewLabel = item.name;
		}
	}

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
			rightPanelNote = 'Library is not ready yet.';
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


	function openSettingsModal() {
		showSettingsModal = true;
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
				class="px-4 py-1.5 text-sm font-medium transition-colors {appMode === '3d' ? 'bg-blue-50 text-blue-700' : 'bg-white text-gray-600 hover:bg-gray-50'} {prefs.show3D ? '' : 'hidden'}"
				onclick={() => appMode = '3d'}
			>
				3D
			</button>
			<button
				class="px-4 py-1.5 text-sm font-medium bg-white text-violet-700 hover:bg-violet-50"
				onclick={() => goto('/portrait-motion')}
			>
				Portrait Motion
			</button>
		</div>
		<div class="flex-1 flex items-center justify-end gap-3">
			<button
				class="px-2 py-1.5 text-xs rounded border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
				onclick={openSettingsModal}
				title="API keys and storage location"
			>
				⚙️ Settings{#if spentUsd > 0}<span class="ml-1 text-[10px] text-gray-500" title="Estimated spend this period">≈${spentUsd.toFixed(2)}</span>{/if}{#if !replicateConfigured}<span class="ml-1 inline-block w-2 h-2 rounded-full bg-amber-500 align-middle" title="No Replicate token yet"></span>{/if}
			</button>
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
						<div class="space-y-2 text-xs text-gray-700">
							<a class="block rounded border border-gray-200 bg-gray-50 p-3 hover:bg-gray-100" href="https://github.com/rustfan1987/spritemagician#readme" target="_blank" rel="noreferrer">
								<p class="font-medium">README &amp; setup</p>
								<p class="text-[11px] text-gray-500 mt-1">Installing, API keys, where files are stored.</p>
							</a>
							<a class="block rounded border border-gray-200 bg-gray-50 p-3 hover:bg-gray-100" href="https://github.com/rustfan1987/spritemagician/issues" target="_blank" rel="noreferrer">
								<p class="font-medium">Report a bug / request a feature</p>
								<p class="text-[11px] text-gray-500 mt-1">GitHub issues for this project.</p>
							</a>
							<a class="block rounded border border-gray-200 bg-gray-50 p-3 hover:bg-gray-100" href="https://replicate.com/account/api-tokens" target="_blank" rel="noreferrer">
								<p class="font-medium">Get a Replicate token</p>
								<p class="text-[11px] text-gray-500 mt-1">Required for generation. Billed per run by Replicate.</p>
							</a>
						</div>
					{:else}
						<div class="space-y-2 text-xs text-gray-700">
							<div class="rounded border border-gray-200 bg-gray-50 p-3">
								<p class="font-medium">1. Make a character</p>
								<p class="text-[11px] text-gray-500 mt-1">2D → Design: describe the character or drop a reference image, then save it into a folder.</p>
							</div>
							<div class="rounded border border-gray-200 bg-gray-50 p-3">
								<p class="font-medium">2. Clean it up</p>
								<p class="text-[11px] text-gray-500 mt-1">Right-click the file → Remove Background, or open Edit for upscaling and pixelation.</p>
							</div>
							<div class="rounded border border-gray-200 bg-gray-50 p-3">
								<p class="font-medium">3. Animate and export</p>
								<p class="text-[11px] text-gray-500 mt-1">Animate turns a still into a loop; Export writes a sprite sheet, GIF or MP4 into your library folder.</p>
							</div>
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
				<div class="flex border-b">
					<button
						class="flex-1 px-2 py-2 text-xs font-medium transition-colors {threeDLeftTab === 'generate' ? 'bg-amber-50 text-amber-600 border-b-2 border-amber-600' : 'text-gray-600 hover:bg-gray-50'}"
						onclick={() => setThreeDLeftTab('generate')}
					>
						⚙️ Generate
					</button>
					<button
						class="flex-1 px-2 py-2 text-xs font-medium transition-colors {threeDLeftTab === 'rigging' ? 'bg-teal-50 text-teal-600 border-b-2 border-teal-600' : 'text-gray-600 hover:bg-gray-50'}"
						onclick={() => setThreeDLeftTab('rigging')}
					>
						🦴 Rigging
					</button>
					<button
						class="flex-1 px-2 py-2 text-xs font-medium transition-colors {threeDLeftTab === 'animation' ? 'bg-emerald-50 text-emerald-600 border-b-2 border-emerald-600' : 'text-gray-600 hover:bg-gray-50'}"
						onclick={() => setThreeDLeftTab('animation')}
					>
						🎬 Animate
					</button>
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
						<div class="space-y-3">
							{#if !replicateConfigured}
								<div class="rounded-lg border border-amber-300 bg-amber-50 p-3 flex items-center justify-between gap-3">
									<div>
										<p class="text-sm font-semibold text-amber-900">Add your Replicate API token to start generating</p>
										<p class="text-[11px] text-amber-800 mt-1">Everything else works without it, but generation, upscaling and background removal need Replicate.</p>
									</div>
									<button class="px-3 py-1.5 text-xs rounded bg-amber-600 text-white hover:bg-amber-700 whitespace-nowrap" onclick={openSettingsModal}>Open Settings</button>
								</div>
							{/if}
							<div class="rounded-lg border border-gray-200 p-3">
								<div class="flex items-center justify-between">
									<p class="text-sm font-semibold text-gray-900">Recent files</p>
									<button class="text-[11px] text-blue-600 hover:underline" onclick={() => appMode = '2d'}>Open library →</button>
								</div>
								{#if recentFiles.length === 0}
									<p class="text-xs text-gray-500 mt-2">Nothing yet. Generate a sprite in 2D mode or drop images into your library folder.</p>
								{:else}
									<div class="mt-3 grid grid-cols-3 md:grid-cols-4 gap-2">
										{#each recentFiles as item (item.id)}
											<button class="rounded border border-gray-200 bg-gray-50 p-1.5 text-left hover:bg-gray-100" onclick={() => openRecentFile(item)} title={item.name}>
												<div class="h-16 rounded bg-white flex items-center justify-center overflow-hidden">
													{#if item.thumbnailUrl || item.fileType === 'image'}
														<img src={item.thumbnailUrl || item.url} alt={item.name} class="max-h-full max-w-full object-contain" loading="lazy" />
													{:else}
														<span class="text-xl">{item.fileType === 'animation' ? '🎬' : item.fileType === 'video' ? '🎥' : '📄'}</span>
													{/if}
												</div>
												<p class="text-[10px] text-gray-700 mt-1 truncate">{item.name}</p>
											</button>
										{/each}
									</div>
								{/if}
							</div>
						</div>
					{:else}
						<SettingsPanel />
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
				<div class="flex border-b flex-shrink-0">
					<button
						class="flex-1 px-2 py-2 text-xs font-medium transition-colors {threeDMiddleTab === 'viewport' ? 'bg-blue-50 text-blue-600 border-b-2 border-blue-600' : 'text-gray-600 hover:bg-gray-50'}"
						onclick={() => threeDMiddleTab = 'viewport'}
					>
						🧊 Viewport
					</button>
				</div>
				{#if threeDMiddleTab === 'viewport'}
					<div class="flex-1 min-h-0 overflow-y-auto">
						<RigAnimation3DPanel />
					</div>
				{/if}
			{/if}
		</div>

		<!-- Right Column: File Tree / Jobs / Frames -->
		<div class="bg-white rounded shadow overflow-hidden flex flex-col min-h-0 w-full shrink-0 snap-start md:w-auto md:shrink {appMode === 'home' ? 'order-3 md:order-none' : ''}">
			{#if appMode === 'home'}
				<div class="p-3 flex-1 min-h-0 overflow-y-auto space-y-3">
					<div class="rounded-lg border border-gray-200 p-3">
						<p class="text-xs font-semibold text-gray-800">Getting started</p>
						<ol class="mt-2 space-y-2 text-[11px] text-gray-600 list-decimal pl-4">
							<li>Open <button class="text-blue-600 underline" onclick={openSettingsModal}>Settings</button> and paste your Replicate API token. Gemini and OpenAI keys are optional.</li>
							<li>Switch to <button class="text-blue-600 underline" onclick={() => appMode = '2d'}>2D</button> to generate, edit and animate sprites.</li>
							<li>Everything you save lands in your library folder on this computer. Open it from the Settings screen.</li>
						</ol>
					</div>
					<div class="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
						<p class="text-xs font-semibold text-emerald-800">Local &amp; open source</p>
						<p class="text-[11px] text-emerald-700 mt-1">
							No account, no cloud storage. You pay the AI providers directly with your own keys.
						</p>
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

{#if showSettingsModal}
	<div
		class="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
		onclick={() => showSettingsModal = false}
		onkeydown={(e) => { if (e.key === 'Escape') showSettingsModal = false; }}
		role="dialog"
		aria-modal="true"
		tabindex="0"
	>
		<div class="w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-white rounded-xl shadow-xl border p-4 md:p-5" onclick={(e) => e.stopPropagation()}>
			<div class="flex items-start justify-between gap-3">
				<div>
					<h2 class="text-base md:text-lg font-semibold text-gray-900">Settings</h2>
					<p class="text-xs text-gray-500 mt-1">API keys and where your files are stored.</p>
				</div>
				<button
					class="text-gray-500 hover:text-gray-800 text-xl leading-none"
					onclick={() => showSettingsModal = false}
					aria-label="Close settings"
				>
					×
				</button>
			</div>
			<div class="mt-4">
				<SettingsPanel />
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

