<script>
	import { browser } from '$app/environment';
	import { projectStore } from '$lib/stores/project.js';
	import { jobQueue } from '$lib/stores/jobQueue.js';
	import { completedJobs } from '$lib/stores/completedJobs.js';
	import { userFiles } from '$lib/stores/userFiles.js';
	import { createFile } from '$lib/firebase/firestore.js';
	import FolderPicker from './FolderPicker.svelte';
	import { activeAssetStore } from '$lib/stores/activeAsset.js';

	let {
		initialImage = null,
		sourceFileId = null,
		sourceClusterId = null,
		forceNewCluster = false,
		onChange = null
	} = $props();

	let mode = $state('edit'); // 'edit' or 'expand'
	let sourceImage = $state(null);
	let editPrompt = $state('');
	let expandDirection = $state('down');
	let expandAmount = $state(256);
	let generating = $state(false);
	let resultImage = $state(null);
	let error = $state(null);
	let isDragging = $state(false);
	let imgWidth = $state(0);
	let imgHeight = $state(0);
	let lightboxSrc = $state(null);
	let queueJobId = $state(null);
	let progressSimInterval = $state(null);
	let simulatedProgress = $state(10);
	let historyNodes = $state([]);
	let activeHistoryId = $state(null);
	let preferredChildByNode = $state({});
	let historyWindowSize = $state(7);
	let currentSourceFileId = $state(null);
	let currentClusterId = $state(null);
	let completedState = $state({ jobs: [], activeIndex: 0, loaded: false });
	const EDIT_HISTORY_BY_FILE_KEY = 'spritemagician.editHistory.byFile.v1';
	
	// Save to folder
	let showFolderPicker = $state(false);
	let saveFolderId = $state(null);
	let saveFolderPath = $state(null);
	const EDIT_STATE_KEY = 'spritemagician.edit.panel.v1';
	completedJobs.subscribe((value) => {
		completedState = value;
	});

	function makeHistoryId() {
		if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
			return crypto.randomUUID();
		}
		return `edit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
	}

	function makeClusterId() {
		if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
			return crypto.randomUUID();
		}
		return `cluster_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
	}

	function updateImageDimensions(imageData) {
		if (!imageData) {
			imgWidth = 0;
			imgHeight = 0;
			return;
		}
		const img = new Image();
		img.onload = () => {
			imgWidth = img.width;
			imgHeight = img.height;
		};
		img.src = imageData;
	}

	function getHistoryNode(id) {
		return historyNodes.find((node) => node.id === id) || null;
	}

	function setActiveHistoryNode(id) {
		const node = getHistoryNode(id);
		if (!node) return;
		activeHistoryId = node.id;
		sourceImage = node.image;
		resultImage = null;
		error = null;
		updateImageDimensions(node.image);
		onChange?.(node.image);
		persistEditHistoryForCurrentFile();
	}

	function resetHistoryWithRoot(imageData) {
		if (!imageData) {
			historyNodes = [];
			activeHistoryId = null;
			preferredChildByNode = {};
			return;
		}
		const id = makeHistoryId();
		historyNodes = [{ id, image: imageData, parentId: null, children: [] }];
		activeHistoryId = id;
		preferredChildByNode = {};
	}

	function getRootHistoryId(nodeId) {
		if (!nodeId) return null;
		let cursor = getHistoryNode(nodeId);
		while (cursor?.parentId) {
			cursor = getHistoryNode(cursor.parentId);
		}
		return cursor?.id || null;
	}

	function normalizeHistoryNodes(rawNodes) {
		if (!Array.isArray(rawNodes)) return [];
		return rawNodes
			.map((node) => ({
				id: typeof node?.id === 'string' ? node.id : makeHistoryId(),
				image: typeof node?.image === 'string' ? node.image : null,
				parentId: typeof node?.parentId === 'string' ? node.parentId : null,
				children: Array.isArray(node?.children) ? node.children.filter((c) => typeof c === 'string') : []
			}))
			.filter((node) => !!node.image);
	}

	function parseTime(value) {
		const ms = value ? new Date(value).getTime() : 0;
		return Number.isFinite(ms) ? ms : 0;
	}

	function getJobClusterId(job) {
		if (!job || job.type !== 'sprite') return null;
		return job.editClusterId || job.editRootHistoryId || null;
	}

	function buildHistoryNodesFromCluster(clusterId, fallbackImage = null) {
		if (!clusterId) return [];
		const clusterJobs = (completedState?.jobs || [])
			.filter((job) => getJobClusterId(job) === clusterId && typeof job?.image === 'string')
			.sort((a, b) => parseTime(a.createdAt) - parseTime(b.createdAt));
		if (!clusterJobs.length && !fallbackImage) return [];
		const nodes = [];
		let previousId = null;
		if (fallbackImage) {
			const alreadyPresent = clusterJobs.some((job) => job.image === fallbackImage);
			if (!alreadyPresent) {
				const rootId = makeHistoryId();
				nodes.push({ id: rootId, image: fallbackImage, parentId: null, children: [] });
				previousId = rootId;
			}
		}
		for (const job of clusterJobs) {
			const nodeId = job.editHistoryId || job.id || makeHistoryId();
			nodes.push({ id: nodeId, image: job.image, parentId: previousId, children: [] });
			previousId = nodeId;
		}
		for (let i = 0; i < nodes.length - 1; i += 1) {
			nodes[i].children = [nodes[i + 1].id];
		}
		return nodes;
	}

	function loadHistoryForCluster(clusterId, fallbackImage = null) {
		const nodes = buildHistoryNodesFromCluster(clusterId, fallbackImage);
		if (!nodes.length) return false;
		historyNodes = nodes;
		preferredChildByNode = {};
		for (let i = 0; i < nodes.length - 1; i += 1) {
			preferredChildByNode[nodes[i].id] = nodes[i + 1].id;
		}
		const matchingNode = fallbackImage ? nodes.find((node) => node.image === fallbackImage) : null;
		const resolvedNode = matchingNode || nodes[nodes.length - 1];
		activeHistoryId = resolvedNode.id;
		sourceImage = resolvedNode.image;
		resultImage = null;
		error = null;
		currentClusterId = clusterId;
		updateImageDimensions(resolvedNode.image);
		onChange?.(resolvedNode.image);
		return true;
	}

	function persistEditHistoryForCurrentFile() {
		if (!browser || !currentSourceFileId || !historyNodes.length) return;
		try {
			const raw = localStorage.getItem(EDIT_HISTORY_BY_FILE_KEY);
			const parsed = raw ? JSON.parse(raw) : {};
			parsed[currentSourceFileId] = {
				nodes: historyNodes,
				activeHistoryId,
				updatedAt: new Date().toISOString()
			};
			localStorage.setItem(EDIT_HISTORY_BY_FILE_KEY, JSON.stringify(parsed));
			if (typeof window !== 'undefined') {
				window.dispatchEvent(
					new CustomEvent('fileEditHistoryUpdated', {
						detail: {
							fileId: currentSourceFileId,
							count: historyNodes.length
						}
					})
				);
			}
		} catch {
			// ignore storage limits / parse errors
		}
	}

	function loadPersistedHistoryForFile(fileId, fallbackImage = null) {
		if (!browser || !fileId) return false;
		try {
			const raw = localStorage.getItem(EDIT_HISTORY_BY_FILE_KEY);
			if (!raw) return false;
			const parsed = JSON.parse(raw);
			const entry = parsed?.[fileId];
			if (!entry) return false;
			const normalizedNodes = normalizeHistoryNodes(entry.nodes);
			if (!normalizedNodes.length) return false;
			historyNodes = normalizedNodes;
			preferredChildByNode = {};
			const requestedId = typeof entry.activeHistoryId === 'string' ? entry.activeHistoryId : null;
			const requestedNode = normalizedNodes.find((node) => node.id === requestedId);
			const matchingImageNode = fallbackImage
				? normalizedNodes.find((node) => node.image === fallbackImage)
				: null;
			const resolvedNode = matchingImageNode || requestedNode || normalizedNodes[normalizedNodes.length - 1];
			activeHistoryId = resolvedNode.id;
			sourceImage = resolvedNode.image;
			resultImage = null;
			error = null;
			updateImageDimensions(resolvedNode.image);
			onChange?.(resolvedNode.image);
			return true;
		} catch {
			return false;
		}
	}

	function appendEditHistory(imageData) {
		if (!imageData) return;
		if (!activeHistoryId || historyNodes.length === 0) {
			resetHistoryWithRoot(imageData);
			return { historyId: activeHistoryId, parentHistoryId: null };
		}
		const parentId = activeHistoryId;
		const nextId = makeHistoryId();
		historyNodes = historyNodes.map((node) => {
			if (node.id !== parentId) return node;
			const nextChildren = node.children.includes(nextId) ? node.children : [...node.children, nextId];
			return { ...node, children: nextChildren };
		});
		historyNodes = [...historyNodes, { id: nextId, image: imageData, parentId, children: [] }];
		preferredChildByNode = { ...preferredChildByNode, [parentId]: nextId };
		activeHistoryId = nextId;
		persistEditHistoryForCurrentFile();
		return { historyId: nextId, parentHistoryId: parentId };
	}

	function getAncestorPathFromActive() {
		const path = [];
		let cursor = getHistoryNode(activeHistoryId);
		while (cursor) {
			path.unshift(cursor.id);
			cursor = cursor.parentId ? getHistoryNode(cursor.parentId) : null;
		}
		return path;
	}

	function getPreferredForwardPathFromActive() {
		const path = [];
		let cursor = activeHistoryId;
		while (cursor) {
			const preferred = preferredChildByNode[cursor];
			if (!preferred) break;
			path.push(preferred);
			cursor = preferred;
		}
		return path;
	}

	let currentBranchIds = $derived.by(() => {
		if (!activeHistoryId || historyNodes.length === 0) return [];
		return [...getAncestorPathFromActive(), ...getPreferredForwardPathFromActive()];
	});

	let activeBranchIndex = $derived.by(() => currentBranchIds.findIndex((id) => id === activeHistoryId));

	let visibleHistoryIds = $derived.by(() => {
		if (!currentBranchIds.length) return [];
		const windowSize = Math.max(5, Math.min(7, historyWindowSize));
		const activeIndex = Math.max(0, activeBranchIndex);
		let start = Math.max(0, activeIndex - Math.floor(windowSize / 2));
		let end = Math.min(currentBranchIds.length, start + windowSize);
		if (end - start < windowSize) {
			start = Math.max(0, end - windowSize);
		}
		return currentBranchIds.slice(start, end);
	});

	let carouselSlots = $derived.by(() => {
		const slotCount = Math.max(5, Math.min(7, historyWindowSize));
		if (!visibleHistoryIds.length) {
			return Array.from({ length: slotCount }, () => null);
		}
		const activeIndexInVisible = visibleHistoryIds.findIndex((id) => id === activeHistoryId);
		const desiredCenter = Math.floor(slotCount / 2);
		const leftPad = Math.max(0, desiredCenter - Math.max(0, activeIndexInVisible));
		const slots = [
			...Array.from({ length: leftPad }, () => null),
			...visibleHistoryIds
		];
		while (slots.length < slotCount) {
			slots.push(null);
		}
		return slots.slice(0, slotCount);
	});

	let activeHistoryNode = $derived.by(() => getHistoryNode(activeHistoryId));

	let canGoPrevHistory = $derived.by(() => activeBranchIndex > 0);
	let canGoNextHistory = $derived.by(() => activeBranchIndex >= 0 && activeBranchIndex < currentBranchIds.length - 1);

	function goToPrevHistory() {
		if (!canGoPrevHistory) return;
		const prevId = currentBranchIds[activeBranchIndex - 1];
		setActiveHistoryNode(prevId);
	}

	function goToNextHistory() {
		if (!canGoNextHistory) return;
		const nextId = currentBranchIds[activeBranchIndex + 1];
		setActiveHistoryNode(nextId);
	}

	$effect(() => {
		if (!$activeAssetStore?.folderId) return;
		saveFolderId = $activeAssetStore.folderId;
		saveFolderPath = $activeAssetStore.folderPath || $activeAssetStore.folderName;
	});

	if (browser) {
		try {
			const raw = localStorage.getItem(EDIT_STATE_KEY);
			if (raw) {
				const parsed = JSON.parse(raw);
				if (parsed?.mode === 'edit' || parsed?.mode === 'expand') mode = parsed.mode;
				if (typeof parsed?.sourceImage === 'string') sourceImage = parsed.sourceImage;
				if (typeof parsed?.editPrompt === 'string') editPrompt = parsed.editPrompt;
				if (typeof parsed?.expandDirection === 'string') expandDirection = parsed.expandDirection;
				if (Number.isFinite(parsed?.expandAmount)) expandAmount = parsed.expandAmount;
				if (typeof parsed?.resultImage === 'string') resultImage = parsed.resultImage;
				if (typeof parsed?.selectedPresetId === 'string') selectedPresetId = parsed.selectedPresetId;
				if (typeof parsed?.selectedContextId === 'string') selectedContextId = parsed.selectedContextId;
				if (typeof parsed?.selectedDirectionId === 'string') selectedDirectionId = parsed.selectedDirectionId;
				if (typeof parsed?.editStrategy === 'string') editStrategy = parsed.editStrategy;
				if (parsed?.editModel === 'nano_banana') editModel = parsed.editModel;
				if (typeof parsed?.enforceUncropped === 'boolean') enforceUncropped = parsed.enforceUncropped;
				if (typeof parsed?.enforceFlatBackground === 'boolean') enforceFlatBackground = parsed.enforceFlatBackground;
				if (typeof parsed?.removeBackgroundSetting === 'boolean') removeBackgroundSetting = parsed.removeBackgroundSetting;
				if (typeof parsed?.negativePrompt === 'string') negativePrompt = parsed.negativePrompt;
				if (Number.isFinite(parsed?.imgWidth)) imgWidth = parsed.imgWidth;
				if (Number.isFinite(parsed?.imgHeight)) imgHeight = parsed.imgHeight;
			}
		} catch {
			// ignore state parse errors
		}
	}


	const EDIT_CONTEXTS = [
		{ id: 'character', label: '\u{1F9D9} Character' },
		{ id: 'building', label: '\u{1F3F0} Building' },
		{ id: 'item', label: '\u{1F5E1}\uFE0F Item' },
		{ id: 'asset', label: '\u{1F9F1} Object' },
		{ id: 'scenery', label: '\u{1F332} Scenery' },
		{ id: 'effects', label: '\u2728 Special Effect' }
	];

	const DIRECTION_OPTIONS = [
		{
			id: 'front',
			label: 'Front',
			description:
				'Camera faces the subject head-on. Shoulders are parallel to the image plane, both sides read evenly, and facial/chest details stay fully visible.'
		},
		{
			id: 'back',
			label: 'Back',
			description:
				'Camera views the subject from behind. Show back silhouette, rear costume/armor structure, and rear limb placement while preserving scale and framing.'
		},
		{
			id: 'left_profile',
			label: 'Left Profile',
			description:
				'Strict left-side profile view. Subject is rotated 90 degrees left relative to camera; maintain clean side silhouette and profile anatomy readability.'
		},
		{
			id: 'right_profile',
			label: 'Right Profile',
			description:
				'Strict right-side profile view. Subject is rotated 90 degrees right relative to camera; maintain clean side silhouette and profile anatomy readability.'
		},
		{
			id: 'isometric',
			label: 'Isometric',
			description:
				'Isometric gameplay-friendly angle with no dramatic perspective distortion. Keep consistent game-asset readability, stable scale, and clear sprite silhouette.'
		},
		{
			id: 'three_quarter',
			label: '3/4 Angle',
			description:
				'Three-quarter camera angle with both front and side planes visible. Preserve depth cues while keeping proportions, identity, and style fully consistent.'
		}
	];

	const CONTEXT_PROMPT_COMMANDS = {
		character: {
			consistency: 'Preserve character identity and silhouette.',
			uncropped: 'Keep the full character visible in frame, including head, hands, and feet.',
			isolation: (chromaHex) => `Isolate the character and keep ${chromaHex} for background only.`
		},
		building: {
			consistency: 'Preserve building structure and silhouette.',
			uncropped: 'Keep all parts of the building visible within the image.',
			isolation: (chromaHex) => `Isolate the building and keep ${chromaHex} for background only.`
		},
		item: {
			consistency: 'Preserve item shape and key details.',
			uncropped: 'Keep the entire item fully visible in frame with no cut-off edges.',
			isolation: (chromaHex) => `Isolate the item and keep ${chromaHex} for background only.`
		},
		asset: {
			consistency: 'Preserve object form and silhouette.',
			uncropped: 'Keep the whole object fully visible in frame with no cropped parts.',
			isolation: (chromaHex) => `Isolate the object and keep ${chromaHex} for background only.`
		},
		scenery: {
			consistency: 'Preserve scene composition and major forms.',
			uncropped: 'Keep the full scene content visible in frame with no important elements cut off.',
			isolation: (chromaHex) => `Isolate the main scene subject and keep ${chromaHex} for background only.`
		},
		effects: {
			consistency: 'Preserve effect shape and motion language.',
			uncropped: 'Keep the entire effect visible in frame, including outer edges and glow/trails.',
			isolation: (chromaHex) => `Isolate the effect and keep ${chromaHex} for background only.`
		}
	};

	const CHARACTER_POSE_PRESETS = [
		{ id: 'reframe', label: '\u{1F4D0} Reframe Uncropped', prompt: 'Objective: Reframe to full-body uncropped composition with head-to-toe visibility and clear silhouette margin.' },
		{ id: 'tposefront', label: '\u{1F9CD} Front T-Pose', prompt: 'Objective: Convert to front-facing full-body T-pose with horizontal arms, neutral stance, and uncropped framing.' },
		{ id: 'idle', label: '\u{1F9CD} Idle', prompt: 'Objective: Convert to neutral idle stance with balanced posture and fully readable full-body silhouette.' },
		{ id: 'ready', label: '\u2694\uFE0F Ready Stance', prompt: 'Objective: Convert to combat-ready stance with centered weight and clear action-ready silhouette.' },
		{ id: 'walk', label: '\u{1F6B6} Walking', prompt: 'Objective: Convert to walking cycle key pose with one leg advancing and natural opposing arm swing.' },
		{ id: 'midstride', label: '\u{1F463} Mid Stride', prompt: 'Objective: Convert to mid-stride locomotion pose with strong leg separation and clear forward motion.' },
		{ id: 'run', label: '\u{1F3C3} Running', prompt: 'Objective: Convert to dynamic running pose with energetic arm-leg opposition and readable momentum.' },
		{ id: 'midsprint', label: '\u{1F4A8} Mid Sprint', prompt: 'Objective: Convert to mid-sprint pose with aggressive forward lean, explosive stride, and full-body visibility.' },
		{ id: 'jump', label: '\u{1F998} Jumping', prompt: 'Objective: Convert to airborne jumping pose with clear lift-off body language and uncropped limbs.' },
		{ id: 'land', label: '\u{1F6EC} Landing', prompt: 'Objective: Convert to landing impact pose with bent knees and grounded recovery posture.' },
		{ id: 'attack', label: '\u{1F5E1}\uFE0F Attack Windup', prompt: 'Objective: Convert to attack windup pose emphasizing anticipation and pre-strike tension.' },
		{ id: 'cast', label: '\u2728 Casting', prompt: 'Objective: Convert to spell-casting pose with intentional casting gesture and strong magical focus.' },
		{ id: 'damage', label: '\u{1F4A5} Taking Damage', prompt: 'Objective: Convert to hit-reaction pose with torso recoil and visible impact response.' },
		{ id: 'pain', label: '\u{1F616} In Pain', prompt: 'Objective: Convert to pain reaction pose with tense posture and distressed body language.' },
		{ id: 'stagger', label: '\u{1F300} Staggered', prompt: 'Objective: Convert to staggered off-balance pose showing disrupted footing after impact.' },
		{ id: 'knockdown', label: '\u{1FAA6} Knocked Down', prompt: 'Objective: Convert to knocked-down grounded pose while preserving full-body readability.' },
		{ id: 'dead', label: '\u2620\uFE0F Dead', prompt: 'Objective: Convert to defeated/dead final pose with complete body visible and uncropped.' }
	];

	const CONTEXT_PRESETS = {
		character: CHARACTER_POSE_PRESETS,
		building: [
			{ id: 'facade', label: '\u{1F3D7}\uFE0F Repair Facade', prompt: 'Objective: Repair facade damage and restore structural readability while preserving silhouette and style.' },
			{ id: 'ruin', label: '\u{1F9F1} Ruined Variant', prompt: 'Objective: Create a ruined-state variant with controlled breakage/debris while keeping base composition.' },
			{ id: 'lighting', label: '\u{1F56F}\uFE0F Lighting Pass', prompt: 'Objective: Improve architectural lighting readability and material separation without changing structure or scale.' }
		],
		item: [
			{ id: 'clean', label: '\u{1F9FC} Clean Readability', prompt: 'Objective: Improve shape readability and material clarity while preserving item identity and form.' },
			{ id: 'rare', label: '\u{1F48E} Rare Variant', prompt: 'Objective: Create rare-tier visual variant with richer accents and clearer focal highlights.' },
			{ id: 'battleworn', label: '\u{1F6E0}\uFE0F Battle Worn', prompt: 'Objective: Add battle-worn wear/scratches/grime while preserving original silhouette and recognizability.' }
		],
		asset: [
			{ id: 'modular', label: '\u{1F9E9} Modular Cleanup', prompt: 'Objective: Improve modular part readability and edge continuity while preserving asset geometry.' },
			{ id: 'material', label: '\u{1FAB5} Material Pass', prompt: 'Objective: Increase material definition and texture readability with proportions unchanged.' },
			{ id: 'variant', label: '\u{1F3A8} Color Variant', prompt: 'Objective: Generate a colorway variant while preserving form, details, and silhouette.' }
		],
		scenery: [
			{ id: 'depth', label: '\u{1F32B}\uFE0F Add Depth', prompt: 'Objective: Improve depth layering and atmospheric separation while preserving scene composition.' },
			{ id: 'clean', label: '\u{1F9F9} Cleanup', prompt: 'Objective: Remove distracting clutter and improve readability while keeping key forms intact.' },
			{ id: 'mood', label: '\u{1F319} Mood Pass', prompt: 'Objective: Adjust mood lighting and grade while preserving structural composition.' }
		],
		effects: [
			{ id: 'boost', label: '\u26A1 Boost Intensity', prompt: 'Objective: Increase effect intensity and contrast while preserving shape and motion language.' },
			{ id: 'clean', label: '\u{1F300} Clean Effect', prompt: 'Objective: Remove effect noise and improve edge readability without changing effect structure.' },
			{ id: 'variant', label: '\u{1F308} Color Shift', prompt: 'Objective: Produce color-shifted effect variant while preserving motion language and form.' }
		]
	};

	let selectedPresetId = $state(null);
	let selectedContextId = $state('character');
	let selectedDirectionId = $state('');
	let editStrategy = $state('fresh_transform');
let editModel = $state('nano_banana'); // 'nano_banana'
	let enforceUncropped = $state(true);
	let enforceFlatBackground = $state(false);
	let removeBackgroundSetting = $state(true);
	let negativePrompt = $state('');
	let showCompiledPrompt = $state(false);

	let quickDirectionOptions = $derived.by(() => {
		const selectedContext = EDIT_CONTEXTS.find((ctx) => ctx.id === selectedContextId);
		const contextLabel = selectedContext?.label || 'Character';
		return (CONTEXT_PRESETS[selectedContextId] || []).map((preset) => ({
			id: `${selectedContextId}::${preset.id}`,
			label: `${contextLabel} - ${preset.label}`,
			prompt: preset.prompt
		}));
	});

	$effect(() => {
		if (!EDIT_CONTEXTS.some((ctx) => ctx.id === selectedContextId)) {
			selectedContextId = 'character';
		}
	});

	$effect(() => {
		if (!browser) return;
		const applyWindow = () => {
			historyWindowSize = window.innerWidth < 900 ? 5 : 7;
		};
		applyWindow();
		window.addEventListener('resize', applyWindow);
		return () => window.removeEventListener('resize', applyWindow);
	});

	$effect(() => {
		currentSourceFileId = sourceFileId || null;
	});

	$effect(() => {
		if (!sourceImage || activeHistoryId || historyNodes.length > 0) return;
		if (!currentClusterId) currentClusterId = makeClusterId();
		resetHistoryWithRoot(sourceImage);
		persistEditHistoryForCurrentFile();
	});

	function handleFileChange(e) {
		const file = e.target.files?.[0];
		if (!file) return;
		loadImageFile(file);
	}

	function handleDrop(e) {
		e.preventDefault();
		isDragging = false;
		const file = e.dataTransfer?.files?.[0];
		if (!file?.type.startsWith('image/')) return;
		loadImageFile(file);
	}

	function loadImageFile(file) {
		const reader = new FileReader();
		reader.onload = (ev) => {
			const nextImage = ev.target.result;
			currentSourceFileId = null;
			currentClusterId = makeClusterId();
			sourceImage = nextImage;
			resultImage = null;
			error = null;
			onChange?.(nextImage);
			updateImageDimensions(nextImage);
			resetHistoryWithRoot(nextImage);
		};
		reader.readAsDataURL(file);
	}

	// Load image from parent handoff/store whenever the prop changes
	let _lastLoadedImage = null;
	let _lastLoadedFileId = null;
	let _lastLoadedClusterId = null;
	$effect(() => {
		if (
			initialImage &&
			(initialImage !== _lastLoadedImage ||
				sourceFileId !== _lastLoadedFileId ||
				sourceClusterId !== _lastLoadedClusterId)
		) {
			_lastLoadedImage = initialImage;
			_lastLoadedFileId = sourceFileId || null;
			_lastLoadedClusterId = sourceClusterId || null;
			currentSourceFileId = sourceFileId || null;
			if (forceNewCluster) {
				currentClusterId = makeClusterId();
				sourceImage = initialImage;
				resultImage = null;
				error = null;
				updateImageDimensions(initialImage);
				resetHistoryWithRoot(initialImage);
				return;
			}
			if (sourceClusterId && loadHistoryForCluster(sourceClusterId, initialImage)) {
				currentClusterId = sourceClusterId;
				return;
			}
			const existingNode = historyNodes.find((node) => node.image === initialImage);
			if (existingNode) {
				setActiveHistoryNode(existingNode.id);
				return;
			}
			const matchingJob = (completedState?.jobs || []).find((job) => job?.type === 'sprite' && job?.image === initialImage);
			const inferredClusterId = getJobClusterId(matchingJob);
			if (inferredClusterId && loadHistoryForCluster(inferredClusterId, initialImage)) {
				currentClusterId = inferredClusterId;
				return;
			}
			currentClusterId = makeClusterId();
			sourceImage = initialImage;
			resultImage = null;
			error = null;
			updateImageDimensions(initialImage);
			resetHistoryWithRoot(initialImage);
			persistEditHistoryForCurrentFile();
		}
	});

	function clearImage() {
		sourceImage = null;
		resultImage = null;
		error = null;
		imgWidth = 0;
		imgHeight = 0;
		historyNodes = [];
		activeHistoryId = null;
		preferredChildByNode = {};
		currentSourceFileId = null;
		currentClusterId = null;
		onChange?.(null);
	}

	function onQuickDirectionChange(nextId) {
		selectedPresetId = nextId;
	}

	$effect(() => {
		if (!browser) return;
		try {
			localStorage.setItem(
				EDIT_STATE_KEY,
				JSON.stringify({
					mode,
					sourceImage,
					editPrompt,
					expandDirection,
					expandAmount,
					resultImage,
					selectedPresetId,
					selectedContextId,
					selectedDirectionId,
					editStrategy,
					editModel,
					enforceUncropped,
					enforceFlatBackground,
					removeBackgroundSetting,
					negativePrompt,
					imgWidth,
					imgHeight
				})
			);
		} catch {
			// ignore storage quota/private mode errors
		}
	});

	function getActiveChromaKeyHex() {
		return $activeAssetStore?.chromaKeyHex || '#00FF00';
	}

	async function downscaleDataUrl(dataUrl, maxEdge = 640) {
		if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) return dataUrl;
		return await new Promise((resolve) => {
			const img = new Image();
			img.onload = () => {
				try {
					const srcW = img.naturalWidth || img.width;
					const srcH = img.naturalHeight || img.height;
					if (!srcW || !srcH) return resolve(dataUrl);
					const scale = Math.min(1, maxEdge / Math.max(srcW, srcH));
					const width = Math.max(1, Math.round(srcW * scale));
					const height = Math.max(1, Math.round(srcH * scale));
					const canvas = document.createElement('canvas');
					canvas.width = width;
					canvas.height = height;
					const ctx = canvas.getContext('2d');
					if (!ctx) return resolve(dataUrl);
					ctx.imageSmoothingEnabled = true;
					ctx.imageSmoothingQuality = 'high';
					ctx.drawImage(img, 0, 0, width, height);
					resolve(canvas.toDataURL('image/png'));
				} catch {
					resolve(dataUrl);
				}
			};
			img.onerror = () => resolve(dataUrl);
			img.src = dataUrl;
		});
	}

	function buildAutoEditInstruction() {
		return 'isolate the primary subject and keep output readable.';
	}

	function getQuickDirectionLabel() {
		return quickDirectionOptions.find((preset) => preset.id === selectedPresetId)?.label || '';
	}

	function getQuickDirectionPrompt() {
		return quickDirectionOptions.find((preset) => preset.id === selectedPresetId)?.prompt || '';
	}

	function getContextPromptConfig() {
		return CONTEXT_PROMPT_COMMANDS[selectedContextId] || CONTEXT_PROMPT_COMMANDS.character;
	}

	function getDirectionOption() {
		return DIRECTION_OPTIONS.find((option) => option.id === selectedDirectionId) || null;
	}

	function getDirectionLabel() {
		return getDirectionOption()?.label || '';
	}

	function getDirectionDescription() {
		return getDirectionOption()?.description || '';
	}

	function getEditStrategyCommand() {
		if (editStrategy === 'surgical_edit') return 'Change only the requested target.';
		if (editStrategy === 'consistency') return getContextPromptConfig().consistency;
		return 'Treat this as a fresh transform.';
	}

	function buildCompiledEditPrompt() {
		const chromaHex = getActiveChromaKeyHex();
		const quickDirectionLabel = getQuickDirectionLabel().trim();
		const quickDirectionPrompt = getQuickDirectionPrompt().trim();
		const taskInstruction = (editPrompt || '').trim();
		const lines = [];

		lines.push(getEditStrategyCommand());
		if (quickDirectionPrompt) {
			lines.push(`Quick direction objective: ${quickDirectionPrompt}`);
			lines.push(`Quick direction preset: ${quickDirectionLabel || selectedPresetId}`);
			lines.push(
				'Mandatory transform: change the subject body pose/action to the quick direction target clearly and visibly (not a subtle tweak).'
			);
			lines.push(
				'Preserve identity, camera angle, framing, style, and scale while performing that pose/action change.'
			);
		}
		const directionLabel = getDirectionLabel().trim();
		const directionDescription = getDirectionDescription().trim();
		if (directionDescription) {
			lines.push(`Direction target: ${directionLabel || selectedDirectionId}`);
			lines.push(`Direction rule: ${directionDescription}`);
		}
		if (selectedContextId === 'character') {
			lines.push('Character proportion guardrails (always enforce):');
			lines.push('- Keep normal humanoid proportions (about 7 to 8 heads tall).');
			lines.push('- Keep head size natural relative to torso and shoulders (no oversized head).');
			lines.push('- Keep arms and legs full-length with normal joint placement.');
			lines.push('- Keep hands and feet anatomically proportional (not tiny or oversized).');
			lines.push('- Do not output chibi, bobblehead, or stylized short-limb proportions.');
		}
		if (enforceUncropped) lines.push(getContextPromptConfig().uncropped);
		if (enforceFlatBackground) lines.push(`Use a flat solid ${chromaHex} background.`);
		if (removeBackgroundSetting) {
			lines.push(getContextPromptConfig().isolation(chromaHex));
			lines.push('Detail lock (strict): keep the subject identity, materials, micro-texture, and silhouette unchanged.');
			lines.push('Do not repaint, simplify, smooth, blur, or restylize the subject.');
			lines.push('Only modify background separation; preserve all foreground detail at full fidelity.');
		}
		if (taskInstruction) lines.push(taskInstruction);
		if (!lines.length) lines.push(buildAutoEditInstruction());

		return lines.join('\n');
	}

	let compiledEditPrompt = $derived.by(() => {
		if (mode !== 'edit') return '';
		return buildCompiledEditPrompt();
	});

	$effect(() => {
		if (!selectedPresetId) return;
		const isValidForContext = quickDirectionOptions.some((preset) => preset.id === selectedPresetId);
		if (!isValidForContext) {
			selectedPresetId = '';
		}
	});

	async function buildExpandedImage() {
		// If source image is a URL (not data URL), proxy it through our API to avoid CORS
		let imageToUse = sourceImage;
		if (!sourceImage.startsWith('data:')) {
			try {
				const res = await fetch('/api/proxy-image', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ url: sourceImage })
				});
				if (!res.ok) {
					const data = await res.json();
					throw new Error(data.error || 'Failed to proxy image');
				}
				const { dataUrl } = await res.json();
				imageToUse = dataUrl;
			} catch (e) {
				throw new Error(`Failed to load source image: ${e.message}`);
			}
		}

		return new Promise((resolve, reject) => {
			const img = new Image();
			
			img.onload = () => {
				try {
					let newWidth = img.width;
					let newHeight = img.height;
					let offsetX = 0;
					let offsetY = 0;

					switch (expandDirection) {
						case 'down':
							newHeight += expandAmount;
							break;
						case 'up':
							newHeight += expandAmount;
							offsetY = expandAmount;
							break;
						case 'left':
							newWidth += expandAmount;
							offsetX = expandAmount;
							break;
						case 'right':
							newWidth += expandAmount;
							break;
						case 'all':
							newWidth += expandAmount * 2;
							newHeight += expandAmount * 2;
							offsetX = expandAmount;
							offsetY = expandAmount;
							break;
					}

					const canvas = document.createElement('canvas');
					canvas.width = newWidth;
					canvas.height = newHeight;
					const ctx = canvas.getContext('2d');

					// Fill expansion area with solid gray
					ctx.fillStyle = '#C0C0C0';
					ctx.fillRect(0, 0, newWidth, newHeight);

					// Draw original image in position
					ctx.drawImage(img, offsetX, offsetY);

					resolve(canvas.toDataURL('image/png'));
				} catch (e) {
					reject(new Error('Failed to build expanded image: ' + e.message));
				}
			};
			
			img.onerror = () => {
				reject(new Error('Failed to load source image for expansion'));
			};
			
			img.src = imageToUse;
		});
	}

	let expandedWidth = $derived.by(() => {
		if (!imgWidth) return 0;
		if (expandDirection === 'left' || expandDirection === 'right') return imgWidth + expandAmount;
		if (expandDirection === 'all') return imgWidth + expandAmount * 2;
		return imgWidth;
	});

	let expandedHeight = $derived.by(() => {
		if (!imgHeight) return 0;
		if (expandDirection === 'up' || expandDirection === 'down') return imgHeight + expandAmount;
		if (expandDirection === 'all') return imgHeight + expandAmount * 2;
		return imgHeight;
	});

let generateDisabledReason = $derived.by(() => {
	if (!sourceImage) return 'Add a source image to begin.';
	if (generating) return mode === 'edit' ? 'Applying edit...' : 'Expanding image...';
	if (mode === 'expand' && !editPrompt.trim()) return 'Describe what to generate in the expanded area.';
	return '';
});

let sourceMetaText = $derived.by(() => {
	if (imgWidth && imgHeight) return `${imgWidth}×${imgHeight}px`;
	return sourceImage ? 'Source ready' : '';
});

	function stopProgressSimulation() {
		if (progressSimInterval) {
			clearInterval(progressSimInterval);
			progressSimInterval = null;
		}
	}

	function updateQueuedProgress(progress, message = '') {
		if (!queueJobId) return;
		simulatedProgress = Math.max(simulatedProgress, Math.min(88, Math.round(progress)));
		const payload = { progress: simulatedProgress };
		if (message) payload.message = message;
		jobQueue.updateJob(queueJobId, payload);
	}

	function startProgressSimulation() {
		stopProgressSimulation();
		progressSimInterval = setInterval(() => {
			if (!queueJobId) return;
			if (simulatedProgress >= 88) return;
			const remaining = 88 - simulatedProgress;
			const step = remaining > 24 ? 2 : 1;
			simulatedProgress = Math.min(88, simulatedProgress + step);
			jobQueue.updateJob(queueJobId, { progress: simulatedProgress });
		}, 1200);
	}

	async function generate() {
		if (!sourceImage) {
			error = 'Upload an image first';
			return;
		}
		if (mode === 'expand' && !editPrompt.trim()) {
			error = 'Describe what you want';
			return;
		}

		generating = true;
		error = null;
		resultImage = null;
		queueJobId = jobQueue.addJob({
			type: mode === 'edit' ? 'Edit' : 'Expand',
			kind: 'image',
			origin: 'edit',
			name: 'image',
			status: 'processing',
			progress: 10,
			message: mode === 'edit' ? 'Applying edit...' : 'Preparing expansion...'
		});
		simulatedProgress = 10;
		startProgressSimulation();

		try {
			let imageToSend = sourceImage;
			let promptToSend = editPrompt;

			if (mode === 'expand') {
				try {
					imageToSend = await buildExpandedImage();
					if (queueJobId) {
						updateQueuedProgress(35, 'Expanded canvas prepared...');
					}
				} catch (expandError) {
					error = `Failed to build expanded image: ${expandError.message}. Make sure the image is from the same origin or has CORS enabled.`;
					if (queueJobId) {
						jobQueue.failJob(queueJobId, error);
					}
					stopProgressSimulation();
					generating = false;
					queueJobId = null;
					return;
				}
				promptToSend = `OUTPAINTING: The provided image has gray (#C0C0C0) border areas where the canvas was expanded. The original artwork is intact in its position. Generate new content ONLY in the gray areas to seamlessly extend the scene. Keep the original pixels untouched. Expansion direction: ${expandDirection}. What to generate in the new space: ${editPrompt}`;
			} else {
				promptToSend = compiledEditPrompt;
			}

			const activeIsLatest =
				!!activeHistoryId &&
				historyNodes.length > 0 &&
				historyNodes[historyNodes.length - 1]?.id === activeHistoryId;
			const shouldStartNewClusterForBranch = mode === 'edit' && !!activeHistoryId && !activeIsLatest;
			if (!currentClusterId || shouldStartNewClusterForBranch) {
				currentClusterId = makeClusterId();
			}
			if (shouldStartNewClusterForBranch) {
				// Branching from an earlier step creates a fresh cluster lineage.
				resetHistoryWithRoot(sourceImage);
			}

			const promptSpec = mode === 'edit'
				? {
					mode,
					contextId: selectedContextId,
					editStrategy,
					quickDirectionLabel: getQuickDirectionLabel(),
					quickDirectionPrompt: getQuickDirectionPrompt(),
					directionId: selectedDirectionId || null,
					directionLabel: getDirectionLabel() || null,
					directionDescription: getDirectionDescription() || null,
					userPrompt: (editPrompt || '').trim(),
					compiledPrompt: compiledEditPrompt,
					enforceUncropped,
					enforceFlatBackground,
					removeBackground: removeBackgroundSetting,
					chromaHex: getActiveChromaKeyHex(),
					negativePrompt: (negativePrompt || '').trim()
				}
				: null;

			const lowCostInputImage = editModel === 'nano_banana'
				? await downscaleDataUrl(imageToSend, 640)
				: imageToSend;
			const res = await fetch('/api/edit-image', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					image: lowCostInputImage,
					prompt: promptToSend,
					mode,
					editModel,
					promptSpec,
					preferDetailFidelity: mode === 'edit' && removeBackgroundSetting,
					imgWidth,
					imgHeight
				})
			});

			const data = await res.json();
			if (!res.ok) throw new Error(data.error || 'Edit failed');

			if (queueJobId) {
				updateQueuedProgress(88, 'Finalizing image...');
			}
			const finalImage = editModel === 'nano_banana'
				? await downscaleDataUrl(data.image, 640)
				: data.image;
			resultImage = finalImage;
			const editHistoryMeta = appendEditHistory(finalImage) || {};
			sourceImage = finalImage;
			updateImageDimensions(finalImage);
			await completedJobs.addSprite({
				name: mode === 'edit' ? 'Edit Result' : 'Expand Result',
				image: finalImage,
				description: (editPrompt || '').slice(0, 240),
				promptJson: data.promptJson || null,
				editClusterId: currentClusterId || null,
				editHistoryId: editHistoryMeta.historyId || null,
				editParentHistoryId: editHistoryMeta.parentHistoryId || null,
				editRootHistoryId: getRootHistoryId(editHistoryMeta.historyId) || null,
				sourceFileId: currentSourceFileId || null,
				uid: userFiles.getUid() || null
			});
			onChange?.(finalImage);
			if ($activeAssetStore?.autoSave && $activeAssetStore?.folderId) {
				try {
					await performSave(true);
				} catch (saveErr) {
					console.warn('[EditPanel] Auto-save failed:', saveErr);
				}
			}
			if (typeof window !== 'undefined') {
				window.dispatchEvent(new CustomEvent('openCenterResultModal', {
					detail: {
						image: data.image,
						label: mode === 'edit' ? 'Edited Result' : 'Expanded Result',
						source: mode === 'edit' ? 'edit' : 'expand',
						suggestedActions: ['loadStyle']
					}
				}));
			}
			if (queueJobId) {
				stopProgressSimulation();
				jobQueue.completeJob(queueJobId, { image: data.image });
			}
		} catch (e) {
			error = e.message;
			if (queueJobId) {
				stopProgressSimulation();
				jobQueue.failJob(queueJobId, e.message || 'Edit failed');
			}
		} finally {
			stopProgressSimulation();
			generating = false;
			queueJobId = null;
		}
	}

	function downloadResult() {
		if (!resultImage) return;
		const a = document.createElement('a');
		a.href = resultImage;
		a.download = `edited_${Date.now()}.png`;
		a.click();
	}

	function useResultAsSource() {
		if (!resultImage) return;
		sourceImage = resultImage;
		resultImage = null;
		updateImageDimensions(sourceImage);
		appendEditHistory(sourceImage);
		onChange?.(sourceImage);
	}

	function moveToStyle() {
		if (!resultImage) return;
		projectStore.update(p => ({ ...p, styleImage: resultImage }));
	}

	async function onFolderSelect(folderId, folderPath) {
		saveFolderId = folderId;
		saveFolderPath = folderPath;
		showFolderPicker = false;
		// Auto-save after selecting folder
		if (resultImage) {
			await performSave();
		}
	}

	async function performSave(silent = false) {
		if (!resultImage || !saveFolderId) return;

		try {
			const uid = userFiles.getUid();
			if (!uid) {
				alert('You must be logged in to save files');
				return;
			}

			const filename = `edited_${Date.now()}.png`;
			const res = await fetch('/api/upload-file', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					imageData: resultImage,
					filename,
					folder: saveFolderId
				})
			});

			if (!res.ok) {
				const data = await res.json();
				throw new Error(data.error || 'Upload failed');
			}

			const { url } = await res.json();
			await createFile(uid, saveFolderId, filename, url, 'image', {
				sourceType: 'edit',
				prompt: editPrompt,
				mode
			});

			if (!silent) {
				alert('Image saved successfully!');
			}
		} catch (err) {
			console.error('Save error:', err);
			if (!silent) {
				alert('Failed to save image: ' + err.message);
			}
			throw err;
		}
	}

	async function saveToFiles() {
		if (!resultImage) return;
		
		if (!saveFolderId) {
			showFolderPicker = true;
			return;
		}

		await performSave();
	}
</script>

<div class="space-y-1">
	<div class="rounded-lg border border-gray-200 bg-gray-50 p-0.5">
		<div class="grid grid-cols-2 gap-1">
			<button
				class="px-2 py-1.5 text-xs font-medium rounded-md transition-colors {mode === 'edit' ? 'bg-white text-blue-600 shadow-sm border border-blue-100' : 'text-gray-600 hover:text-gray-800'}"
				onclick={() => mode = 'edit'}
			>
				&#x270F;&#xFE0F; Edit
			</button>
			<button
				class="px-2 py-1.5 text-xs font-medium rounded-md transition-colors {mode === 'expand' ? 'bg-white text-orange-600 shadow-sm border border-orange-100' : 'text-gray-600 hover:text-gray-800'}"
				onclick={() => mode = 'expand'}
			>
				&#x1F532; Expand
			</button>
		</div>
	</div>

	<div class="rounded-lg border border-gray-200 bg-white p-2">
		<div class="flex items-center gap-2">
			<button
				class="w-8 h-8 rounded-md border border-gray-200 bg-gray-50 text-xs hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
				onclick={goToPrevHistory}
				disabled={!canGoPrevHistory}
				title="Previous edit"
			>◀</button>
			<div class="flex-1 grid grid-cols-5 lg:grid-cols-7 gap-1.5">
				{#each carouselSlots as slotId}
					{@const node = slotId ? getHistoryNode(slotId) : null}
					{@const isActive = slotId && slotId === activeHistoryId}
					<div class="relative rounded-md border overflow-hidden aspect-square bg-gray-50 {isActive ? 'border-blue-500 ring-2 ring-blue-200' : 'border-gray-200'}">
						{#if node?.image}
							<button
								class="w-full h-full"
								onclick={() => setActiveHistoryNode(node.id)}
								title={isActive ? 'Current edit' : 'Open this edit'}
							>
								<img src={node.image} alt="Edit history thumbnail" class="w-full h-full object-cover" />
							</button>
						{:else}
							<div class="w-full h-full bg-gray-50"></div>
						{/if}
						{#if node?.children?.length > 1}
							<span class="absolute right-0.5 top-0.5 text-[9px] px-1 rounded bg-black/60 text-white">Fork</span>
						{/if}
					</div>
				{/each}
			</div>
			<button
				class="w-8 h-8 rounded-md border border-gray-200 bg-gray-50 text-xs hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
				onclick={goToNextHistory}
				disabled={!canGoNextHistory}
				title="Next edit"
			>▶</button>
		</div>
		<div class="mt-1.5 text-[11px] text-gray-500">
			{#if activeHistoryNode}
				Current step: {activeBranchIndex + 1}/{currentBranchIds.length}
				{#if activeHistoryNode.children?.length > 1}
					<span class="ml-1 text-orange-600 font-medium">(fork point)</span>
				{/if}
			{:else}
				Upload an image to start an edit sequence.
			{/if}
		</div>
	</div>

	<div class="space-y-2.5">
		<div class="grid grid-cols-1 md:grid-cols-2 gap-2.5">
			<div class="rounded-lg border border-gray-200 bg-white p-2 space-y-1.5">
				<div class="flex items-center justify-between">
					<p class="text-sm font-semibold text-gray-800">&#x1F5BC;&#xFE0F; Source Image</p>
					<div class="flex items-center gap-2">
						{#if sourceMetaText}
							<p class="text-xs text-gray-500">{sourceMetaText}</p>
						{/if}
					</div>
				</div>

				<label
					class="block border-2 border-dashed rounded-lg p-2.5 text-center cursor-pointer transition-colors {isDragging ? 'border-blue-400 bg-blue-50' : 'border-gray-300 hover:border-gray-400'}"
					ondragover={(e) => { e.preventDefault(); isDragging = true; }}
					ondragleave={() => isDragging = false}
					ondrop={handleDrop}
				>
					<input type="file" accept="image/*" class="hidden" onchange={handleFileChange} />
					<p class="text-xs text-gray-700 font-semibold">{sourceImage ? 'Replace image' : 'Upload source image'}</p>
					<p class="text-[10px] text-gray-400">Drop or click</p>
				</label>

				{#if sourceImage}
					<div class="relative rounded-md border border-gray-200 bg-gray-200 p-1">
						<button class="w-full cursor-zoom-in" onclick={() => lightboxSrc = sourceImage}>
							<div class="w-full rounded flex items-center justify-center">
								<img
									src={sourceImage}
									alt="Current source"
									class="w-full max-h-44 object-contain rounded"
									style="image-rendering: pixelated; background-color: #808080;"
								/>
							</div>
						</button>
						<button
							onclick={clearImage}
							class="absolute top-1.5 right-1.5 w-6 h-6 bg-red-500 text-white rounded-full text-xs flex items-center justify-center hover:bg-red-600"
							title="Remove image"
						>✕</button>
					</div>
				{/if}
			</div>

			<div class="rounded-lg border border-gray-200 bg-white p-2 space-y-2">
				{#if sourceImage && mode === 'edit'}
					<div>
						<label for="edit-strategy" class="block text-[11px] font-medium text-gray-700 mb-0.5">Edit Mode</label>
						<select
							id="edit-strategy"
							bind:value={editStrategy}
							class="w-full px-2.5 py-2 text-xs border rounded-md bg-white"
						>
							<option value="fresh_transform">Fresh Transform</option>
							<option value="surgical_edit">Surgical Edit (change only target)</option>
							<option value="consistency">Consistency (preserve identity)</option>
						</select>
					</div>
					<div>
						<label for="edit-context" class="block text-[11px] font-medium text-gray-700 mb-0.5">Context</label>
						<select
							id="edit-context"
							bind:value={selectedContextId}
							class="w-full px-2.5 py-2 text-xs border rounded-md bg-white"
						>
							{#each EDIT_CONTEXTS as context}
								<option value={context.id}>{context.label}</option>
							{/each}
						</select>
					</div>
					<div>
						<label for="edit-preset" class="block text-[11px] font-medium text-gray-700 mb-0.5">Quick Direction</label>
						<select
							id="edit-preset"
							bind:value={selectedPresetId}
							class="w-full px-2.5 py-2 text-xs border rounded-md bg-white"
							onchange={(e) => onQuickDirectionChange(e.target.value)}
						>
							<option value="">Choose preset...</option>
							{#each quickDirectionOptions as preset}
								<option value={preset.id}>{preset.label}</option>
							{/each}
						</select>
					</div>
					<div>
						<label for="edit-direction" class="block text-[11px] font-medium text-gray-700 mb-0.5">Direction</label>
						<select
							id="edit-direction"
							bind:value={selectedDirectionId}
							class="w-full px-2.5 py-2 text-xs border rounded-md bg-white"
						>
							<option value="">Keep current camera direction</option>
							{#each DIRECTION_OPTIONS as option}
								<option value={option.id}>{option.label}</option>
							{/each}
						</select>
					</div>
				{:else if mode === 'expand' && sourceImage}
					<p class="text-sm font-semibold text-orange-800">&#x1F532; Expand Setup</p>
					<div>
						<label for="expand-dir" class="block text-xs font-medium text-gray-700 mb-1">Direction</label>
						<select
							id="expand-dir"
							bind:value={expandDirection}
							class="w-full px-2 py-1.5 text-xs border rounded bg-white"
						>
							<option value="down">⬇️ Down</option>
							<option value="up">⬆️ Up</option>
							<option value="left">⬅️ Left</option>
							<option value="right">➡️ Right</option>
							<option value="all">↔️ All sides</option>
						</select>
					</div>
					<div>
						<label for="expand-amount" class="block text-xs font-medium text-gray-700 mb-1">
							Amount: {expandAmount}px
						</label>
						<input
							id="expand-amount"
							type="range"
							min="64"
							max="512"
							step="64"
							bind:value={expandAmount}
							class="w-full"
						/>
					</div>
					{#if imgWidth && imgHeight}
						<p class="text-xs text-orange-700 bg-orange-100 border border-orange-200 rounded px-2 py-1">
							New canvas: {imgWidth}×{imgHeight} -> {expandedWidth}×{expandedHeight}px
						</p>
					{/if}
				{:else}
					<div class="h-full min-h-24 flex items-center justify-center rounded border border-gray-200 bg-gray-50 text-xs text-gray-500 text-center px-2">
						Upload a source image to unlock edit controls.
					</div>
				{/if}
			</div>
		</div>

		{#if sourceImage && mode === 'edit'}
			<div class="rounded-lg border border-gray-200 bg-white p-2">
				<div class="mb-2">
					<label for="edit-model" class="block text-[11px] font-medium text-gray-700 mb-0.5">Edit Model</label>
					<select
						id="edit-model"
						bind:value={editModel}
						class="w-full px-2.5 py-2 text-xs border rounded-md bg-white"
					>
						<option value="nano_banana">Nano Banana (Low Cost)</option>
					</select>
				</div>
				<div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
					<label class="flex items-start gap-2 text-xs border rounded-md px-2.5 py-2 bg-white leading-tight">
						<input type="checkbox" bind:checked={enforceUncropped} class="w-3.5 h-3.5" />
						<span>&#x1F9CD; Keep Uncropped</span>
					</label>
					<label class="flex items-start gap-2 text-xs border rounded-md px-2.5 py-2 bg-white leading-tight">
						<input type="checkbox" bind:checked={enforceFlatBackground} class="w-3.5 h-3.5" />
						<span>&#x1F7E9; Flat BG ({getActiveChromaKeyHex()})</span>
					</label>
					<label class="flex items-start gap-2 text-xs border rounded-md px-2.5 py-2 bg-white leading-tight sm:col-span-2">
						<input type="checkbox" bind:checked={removeBackgroundSetting} class="w-3.5 h-3.5" />
						<span>&#x1F5D1;&#xFE0F; Remove Background</span>
					</label>
				</div>
			</div>
		{/if}
	</div>

	{#if sourceImage}
		<div class="space-y-1">
			<div class="rounded-lg border border-gray-200 bg-white p-1.5 space-y-1">
				<textarea
					id="edit-prompt"
					bind:value={editPrompt}
					placeholder={mode === 'edit'
						? 'Describe target result. Controls above stay authoritative.'
						: 'e.g. "Show the full body with legs and feet on a stone floor"'}
					class="w-full px-2 py-1.5 text-xs border rounded resize-none"
					rows="3"
				></textarea>
				{#if mode === 'edit'}
					<details class="rounded border border-gray-200 bg-gray-50 p-1">
						<summary class="cursor-pointer text-[11px] text-gray-700 select-none">
							Advanced (negative prompt + compiled prompt)
						</summary>
						<div class="mt-1 space-y-1">
							<textarea
								id="edit-negative-prompt"
								bind:value={negativePrompt}
								placeholder="Avoid (optional): e.g. blurry, extra limbs, watermark text, noisy background"
								class="w-full px-2 py-1 text-xs border rounded resize-none"
								rows="2"
							></textarea>
							<button
								class="w-full px-2 py-1 text-xs border rounded bg-white hover:bg-gray-100 text-gray-700"
								onclick={() => showCompiledPrompt = !showCompiledPrompt}
							>
								{showCompiledPrompt ? 'Hide' : 'Show'} Compiled Prompt
							</button>
							{#if showCompiledPrompt}
								<pre class="max-h-32 overflow-y-auto whitespace-pre-wrap break-words rounded border border-gray-200 bg-white p-2 text-[11px] text-gray-700">{compiledEditPrompt}</pre>
							{/if}
						</div>
					</details>
				{/if}
			</div>

			<div class="space-y-2">
				<button
					onclick={generate}
					disabled={!!generateDisabledReason}
					class="w-full px-3 py-1.5 text-sm font-semibold text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed {mode === 'edit' ? 'bg-blue-500 hover:bg-blue-600' : 'bg-orange-500 hover:bg-orange-600'}"
				>
					{#if generating}
						<span class="inline-flex items-center gap-1.5">
							<span class="animate-spin">&#x23F3;</span> {mode === 'edit' ? 'Applying edit...' : 'Expanding image...'}
						</span>
					{:else}
						{mode === 'edit' ? '\u270F\uFE0F Apply Edit' : '\u{1F532} Expand Image'}
					{/if}
				</button>
				{#if generateDisabledReason && !error}
					<p class="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded px-2 py-1.5">
						{generateDisabledReason}
					</p>
				{/if}
			</div>
		</div>
	{/if}

	<!-- Error -->
	{#if error}
		<p class="text-xs text-red-600 bg-red-50 rounded p-2">{error}</p>
	{/if}

</div>

<!-- Lightbox -->
{#if lightboxSrc}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="fixed inset-0 z-[999] bg-black/80 flex items-center justify-center cursor-zoom-out"
		onclick={() => lightboxSrc = null}
		onkeydown={(e) => { if (e.key === 'Escape') lightboxSrc = null; }}
	>
		<div class="bg-gray-500 rounded p-2">
			<img
				src={lightboxSrc}
				alt="Full size preview"
				class="max-w-[90vw] max-h-[90vh] object-contain rounded shadow-2xl"
				style="image-rendering: pixelated; background-color: #808080;"
			/>
		</div>
		<button
			class="absolute top-4 right-4 w-10 h-10 bg-white/20 hover:bg-white/40 text-white rounded-full text-xl flex items-center justify-center transition-colors"
			onclick={() => lightboxSrc = null}
		>✕</button>
	</div>
{/if}

<!-- Folder Picker Modal -->
{#if showFolderPicker}
	<FolderPicker
		onSelect={onFolderSelect}
		onClose={() => showFolderPicker = false}
	/>
{/if}
