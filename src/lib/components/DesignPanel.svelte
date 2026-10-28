<script>
	import { tick } from 'svelte';
	import { get } from 'svelte/store';
	import { projectStore } from '$lib/stores/project.js';
	import { jobQueue } from '$lib/stores/jobQueue.js';
	import { completedJobs } from '$lib/stores/completedJobs.js';
	import { setActiveAssetContext } from '$lib/stores/activeAsset.js';
	import { activeAssetStore } from '$lib/stores/activeAsset.js';
	import { userFiles } from '$lib/stores/userFiles.js';
	import { createFile } from '$lib/library/client.js';
	import {
		appendDesignMessage,
		designStore,
		resetCurrentConversation,
		updateDesignState
	} from '$lib/stores/design.js';

	const OIL_PAINTING_FANTASY_PRESET =
		'Whimsical, surreal, vibrant, spec art 1980s fantasy oil painting, unified shadow masses, midtone-dominant value structure, soft form transitions, restrained highlights, matte surface rendering, simplified detail grouping, painterly background mass, selective high-chroma accents only on magical elements';

	const CONTENT_PRESETS = {
		character: 'Create a game-ready chest-up character bust, centered and isolated, with the top of the head and shoulders fully visible. Use a calm closed-mouth expression, a simple readable silhouette, and enough clean background around the bust for stable animation. Do not make a full-body character or an action pose.',
		building: 'Create a game-ready building design with readable structure and architectural detail.',
		item: 'Create a game-ready item design with clear shape language and material readability.',
		asset: 'Create a reusable game asset concept with practical visual clarity and modularity.',
		scenery: 'Create a game-ready scenery concept with composition depth and environmental storytelling.',
		effects: 'Create a game-ready special effects concept emphasizing motion, glow, and layered energy.'
	};

	const STYLE_PRESETS = {
		default: '',
		diablo2: 'Theme add-on: dark gothic fantasy in the spirit of Diablo II, moody lighting, gritty textures, dramatic contrast, somber medieval atmosphere.',
		oil_painting_fantasy: OIL_PAINTING_FANTASY_PRESET,
		pixel_anchor: 'Theme add-on: crisp 2D pixel-art game rendering with readable silhouette, controlled palette, and sprite-ready detail.'
	};
	const GENESIS_MODEL_OPTIONS = [
		{ id: 'nano_banana', label: '🍌 Nano Banana (Gemini)' },
		{ id: 'gpt4', label: '🧠 GPT-4 Image (OpenAI)' },
		{ id: 'dalle', label: '🎨 DALL·E (OpenAI)' }
	];
	const MAX_PROMPT_HISTORY = 30;

	let isChatting = $state(false);
	let isGenerating = $state(false);
	let isWritingPrompt = $state(false);
	let isSavingToAsset = $state(false);
	let chatError = $state(null);
	let generationError = $state(null);
	let uiNote = $state(null);
	let userInput = $state('');
	let chatMessagesEl;
	let referenceInputEl;
	let genesisReferenceInputEl;
	let showPreview = $state(false);
	let showNewAssetModal = $state(false);
	let newAssetName = $state('');
	let newAssetType = $state('character');
	let newAssetNotes = $state('');
	let newAssetTags = $state('');
	let isCreatingAsset = $state(false);
	let queueJobId = $state(null);

	function clearTransientMessages() {
		chatError = null;
		generationError = null;
		uiNote = null;
	}

	async function fetchWithTimeout(url, options, timeoutMs = 120000) {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), timeoutMs);
		try {
			return await fetch(url, { ...options, signal: controller.signal });
		} finally {
			clearTimeout(timeout);
		}
	}

	function fileToDataUrl(file) {
		return new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => resolve(reader.result);
			reader.onerror = () => reject(new Error('Failed to read image file.'));
			reader.readAsDataURL(file);
		});
	}

	function loadImageElement(dataUrl) {
		return new Promise((resolve, reject) => {
			const img = new Image();
			img.onload = () => resolve(img);
			img.onerror = () => reject(new Error('Invalid image.'));
			img.src = dataUrl;
		});
	}

	function estimateDataUrlBytes(dataUrl) {
		if (typeof dataUrl !== 'string') return 0;
		const comma = dataUrl.indexOf(',');
		if (comma === -1) return 0;
		const base64 = dataUrl.slice(comma + 1);
		return Math.floor((base64.length * 3) / 4);
	}

	async function optimizeReferenceImage(dataUrl, options = {}) {
		const {
			maxEdges = [1024, 896, 768, 640, 512],
			qualities = [0.86, 0.78, 0.7, 0.62, 0.55],
			targetBytes = 850 * 1024
		} = options;
		if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) return dataUrl;
		const img = await loadImageElement(dataUrl);
		const sourceWidth = img.naturalWidth || img.width;
		const sourceHeight = img.naturalHeight || img.height;
		if (!sourceWidth || !sourceHeight) return dataUrl;

		let bestCandidate = dataUrl;
		let bestBytes = estimateDataUrlBytes(dataUrl);

		for (const edge of maxEdges) {
			const scale = Math.min(1, edge / Math.max(sourceWidth, sourceHeight));
			const width = Math.max(1, Math.round(sourceWidth * scale));
			const height = Math.max(1, Math.round(sourceHeight * scale));
			const canvas = document.createElement('canvas');
			canvas.width = width;
			canvas.height = height;
			const ctx = canvas.getContext('2d');
			if (!ctx) continue;
			ctx.drawImage(img, 0, 0, width, height);

			for (const quality of qualities) {
				const candidate = canvas.toDataURL('image/jpeg', quality);
				const bytes = estimateDataUrlBytes(candidate);
				if (bytes < bestBytes) {
					bestCandidate = candidate;
					bestBytes = bytes;
				}
				if (bytes <= targetBytes) {
					return candidate;
				}
			}
		}

		return bestCandidate;
	}

	async function handleChatReferenceUpload(event) {
		const file = event?.target?.files?.[0];
		if (!file) return;
		clearTransientMessages();
		try {
			if (!file.type.startsWith('image/')) {
				throw new Error('Please select an image file.');
			}
			const dataUrl = await fileToDataUrl(file);
			const optimized = await optimizeReferenceImage(dataUrl);
			updateDesignState({ chatReferenceImage: optimized });
			uiNote = '\u{1F5BC}\uFE0F GPT reference image attached.';
		} catch (err) {
			uiNote = `\u26A0\uFE0F ${err.message || 'Failed to load reference image.'}`;
		} finally {
			if (referenceInputEl) referenceInputEl.value = '';
		}
	}

	function clearChatReferenceImage() {
		updateDesignState({ chatReferenceImage: null });
		uiNote = '\u{1F9F9} GPT reference image removed.';
	}

	async function handleGenesisReferenceUpload(event) {
		const file = event?.target?.files?.[0];
		if (!file) return;
		clearTransientMessages();
		try {
			if (!file.type.startsWith('image/')) {
				throw new Error('Please select an image file.');
			}
			const dataUrl = await fileToDataUrl(file);
			const optimized = await optimizeReferenceImage(dataUrl);
			updateDesignState({ chatReferenceImage: optimized });
			uiNote = '\u{1F5BC}\uFE0F Genesis reference image attached.';
		} catch (err) {
			uiNote = `\u26A0\uFE0F ${err.message || 'Failed to load reference image.'}`;
		} finally {
			if (genesisReferenceInputEl) genesisReferenceInputEl.value = '';
		}
	}

	function clearGenesisReferenceImage() {
		updateDesignState({ chatReferenceImage: null });
		uiNote = '\u{1F9F9} Genesis reference image removed.';
	}

	$effect(() => {
		if ($designStore.mode !== 'chat') return;
		$designStore.messages.length;
		tick().then(() => {
			if (!chatMessagesEl) return;
			chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
		});
	});

	function setMode(mode) {
		updateDesignState({ mode });
	}

	function openPreview() {
		if (!$designStore.generatedImage) return;
		showPreview = true;
	}

	function closePreview() {
		showPreview = false;
	}

	function openNewAssetModal() {
		clearTransientMessages();
		newAssetName = '';
		newAssetType = $designStore.contentPreset || 'character';
		newAssetNotes = '';
		newAssetTags = '';
		showNewAssetModal = true;
	}

	function closeNewAssetModal() {
		showNewAssetModal = false;
	}

	function openConversationModal() {
		if (typeof window === 'undefined') return;
		window.dispatchEvent(new CustomEvent('openDesignConversationsCenter'));
	}

	async function createAssetFromDesign() {
		const name = newAssetName.trim();
		if (!name || isCreatingAsset) return;

		clearTransientMessages();
		isCreatingAsset = true;
		try {
			const tags = newAssetTags
				.split(',')
				.map((t) => t.trim())
				.filter(Boolean)
				.slice(0, 10);

			const response = await fetchWithTimeout(
				'/api/create-folder',
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						name,
						parentId: null,
						metadata: {
							assetType: newAssetType,
							notes: newAssetNotes.trim(),
							tags,
							source: 'design_panel',
							chromaKeyHex: $activeAssetStore?.chromaKeyHex || '#00FF00'
						}
					})
				},
				30000
			);
			const data = await response.json();
			if (!response.ok) throw new Error(data.error || 'Failed to create asset folder');

			setActiveAssetContext({
				folderId: data.id,
				folderName: data.name,
				folderPath: data.name,
				chromaKeyHex: data?.metadata?.chromaKeyHex
			});
			showNewAssetModal = false;
			uiNote = '\u{1F4C1} New asset workspace created and set active.';
		} catch (err) {
			uiNote = `\u26A0\uFE0F ${err.message || 'Failed to create asset workspace.'}`;
		} finally {
			isCreatingAsset = false;
		}
	}

	function applyGenesisPreset() {
		clearTransientMessages();
		updateDesignState({
			draftPrompt: OIL_PAINTING_FANTASY_PRESET,
			stylePreset: 'oil_painting_fantasy'
		});
		uiNote = '\u2728 Applied Oil Painting Fantasy preset.';
	}

	function applyPresetAddons() {
		clearTransientMessages();
		const state = get(designStore);
		const contentAddon = CONTENT_PRESETS[state.contentPreset] || '';
		const styleAddon = STYLE_PRESETS[state.stylePreset] || '';
		const current = state.draftPrompt?.trim() || '';
		const merged = [current, contentAddon, styleAddon].filter(Boolean).join('\n\n');
		updateDesignState({ draftPrompt: merged });
		uiNote = '\u{1F9E9} Added selected type/theme add-ons to the prompt.';
	}

	function usePromptInGenesis() {
		updateDesignState({ mode: 'genesis' });
	}

	function buildPreflightInstructions(preflight, chromaKeyHex) {
		const rules = [];
		if (preflight?.fullBodyInFrame) {
			rules.push('Full body must be visible in frame from head to toe with safe margin, no crop.');
		}
		if (preflight?.flatBg) {
			rules.push(`Background must be a perfectly flat solid ${chromaKeyHex} with no gradients or texture.`);
		}
		if (preflight?.transparentReady) {
			rules.push('Subject edges must be clean and fully separated from background for easy transparency cutout.');
		}
		if (preflight?.spriteSafeSilhouette) {
			rules.push('Use a clear, readable sprite-safe silhouette with strong shape separation and no ambiguous overlaps.');
		}
		if (!rules.length) return '';
		return `PREFLIGHT REQUIREMENTS (MANDATORY):\n- ${rules.join('\n- ')}`;
	}

	function updatePreflightToggle(key, enabled) {
		const currentControls = $designStore.genesisControls || {};
		const currentPreflight = currentControls.preflight || {};
		updateDesignState({
			genesisControls: {
				...currentControls,
				preflight: {
					...currentPreflight,
					[key]: !!enabled
				}
			}
		});
	}

	function updateNegativePrompt(value) {
		const currentControls = $designStore.genesisControls || {};
		updateDesignState({
			genesisControls: {
				...currentControls,
				negativePrompt: String(value || '')
			}
		});
	}

	function sanitizeSeedValue(value) {
		return String(value || '')
			.replace(/[^a-zA-Z0-9_-]/g, '')
			.slice(0, 64);
	}

	function makeSeed() {
		return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
	}

	function updateSeedValue(value) {
		const currentControls = $designStore.genesisControls || {};
		updateDesignState({
			genesisControls: {
				...currentControls,
				seed: sanitizeSeedValue(value)
			}
		});
	}

	function updateLockSeed(enabled) {
		const currentControls = $designStore.genesisControls || {};
		updateDesignState({
			genesisControls: {
				...currentControls,
				lockSeed: !!enabled
			}
		});
	}

	function addPromptToHistory(promptText) {
		const trimmed = String(promptText || '').trim();
		if (!trimmed) return;
		const currentControls = $designStore.genesisControls || {};
		const currentHistory = Array.isArray(currentControls.promptHistory) ? currentControls.promptHistory : [];
		const withoutDuplicate = currentHistory.filter((item) => item?.prompt !== trimmed);
		const nextHistory = [
			{
				id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
				prompt: trimmed,
				createdAt: new Date().toISOString(),
				starred: false
			},
			...withoutDuplicate
		].slice(0, MAX_PROMPT_HISTORY);
		updateDesignState({
			genesisControls: {
				...currentControls,
				promptHistory: nextHistory
			}
		});
	}

	function togglePromptHistoryStar(itemId) {
		const currentControls = $designStore.genesisControls || {};
		const currentHistory = Array.isArray(currentControls.promptHistory) ? currentControls.promptHistory : [];
		updateDesignState({
			genesisControls: {
				...currentControls,
				promptHistory: currentHistory.map((item) =>
					item.id === itemId ? { ...item, starred: !item.starred } : item
				)
			}
		});
	}

	function reusePromptHistoryItem(promptText) {
		updateDesignState({ draftPrompt: String(promptText || '') });
		uiNote = '📋 Prompt restored from history.';
	}

	async function copyPromptHistoryItem(promptText) {
		try {
			await navigator.clipboard.writeText(String(promptText || ''));
			uiNote = '📋 History prompt copied.';
		} catch {
			uiNote = '⚠️ Clipboard copy failed.';
		}
	}

	function deletePromptHistoryItem(itemId) {
		const currentControls = $designStore.genesisControls || {};
		const currentHistory = Array.isArray(currentControls.promptHistory) ? currentControls.promptHistory : [];
		updateDesignState({
			genesisControls: {
				...currentControls,
				promptHistory: currentHistory.filter((item) => item.id !== itemId)
			}
		});
	}

	function saveCurrentPromptToHistory() {
		const promptText = String($designStore.draftPrompt || '').trim();
		if (!promptText) {
			uiNote = '⚠️ No prompt to save yet.';
			return;
		}
		addPromptToHistory(promptText);
		uiNote = '💾 Prompt saved to history.';
	}

	function buildGenesisPrompt(basePrompt, contentPreset, stylePreset, preflightInstructions = '') {
		const contentAddon = CONTENT_PRESETS[contentPreset] || '';
		const styleAddon = STYLE_PRESETS[stylePreset] || '';
		return [basePrompt?.trim(), contentAddon, styleAddon, preflightInstructions].filter(Boolean).join('\n\n');
	}

	async function copyPrompt() {
		clearTransientMessages();
		const text = ($designStore.draftPrompt || '').trim();
		if (!text) {
			uiNote = '\u26A0\uFE0F No prompt to copy yet.';
			return;
		}
		try {
			await navigator.clipboard.writeText(text);
			uiNote = '\u{1F4CB} Prompt copied.';
		} catch {
			uiNote = '\u26A0\uFE0F Clipboard copy failed.';
		}
	}

	function clearPrompt() {
		updateDesignState({ draftPrompt: '' });
		uiNote = '\u{1F9F9} Prompt cleared.';
	}

	async function sendChat() {
		const typedText = userInput.trim();
		let referenceImage = $designStore.chatReferenceImage;
		if ((!typedText && !referenceImage) || isChatting || isWritingPrompt) return;
		const text = typedText || 'Use this attached reference image for the direction we want to achieve.';

		clearTransientMessages();
		isChatting = true;
		userInput = '';
		if (referenceImage) {
			try {
				const optimizedReference = await optimizeReferenceImage(referenceImage);
				referenceImage = optimizedReference;
				updateDesignState({ chatReferenceImage: optimizedReference });
			} catch {
				// keep original if optimization fails
			}
		}

		const before = get(designStore);
		appendDesignMessage({ role: 'user', content: text, image: referenceImage || null });

		try {
			const response = await fetchWithTimeout(
				'/api/design-chat',
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						mode: 'chat',
						messages: before.messages,
						userMessage: text,
						referenceImage: referenceImage,
						finalPrompt: before.draftPrompt,
						contentPreset: before.contentPreset,
						stylePreset: before.stylePreset
					})
				},
				120000
			);

			const data = await response.json();
			if (!response.ok) throw new Error(data.error || 'Design chat failed');

			appendDesignMessage({ role: 'assistant', content: data.assistantMessage || '\u2705 Idea refined.' });
		} catch (err) {
			chatError = err.name === 'AbortError' ? 'Chat request timed out. Please retry.' : err.message;
			appendDesignMessage({ role: 'assistant', content: '\u26A0\uFE0F Chat failed. Try again.' });
		}

		isChatting = false;
	}

	async function writePromptFromChat() {
		const state = get(designStore);
		if (isChatting || isWritingPrompt || state.messages.length < 2) return;

		clearTransientMessages();
		isWritingPrompt = true;
		let referenceImage = state.chatReferenceImage;
		if (referenceImage) {
			try {
				const optimizedReference = await optimizeReferenceImage(referenceImage);
				referenceImage = optimizedReference;
				updateDesignState({ chatReferenceImage: optimizedReference });
			} catch {
				// keep original if optimization fails
			}
		}

		try {
			const response = await fetchWithTimeout(
				'/api/design-chat',
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						mode: 'draft_prompt',
						messages: state.messages,
						userMessage: '',
						referenceImage,
						finalPrompt: state.draftPrompt,
						contentPreset: state.contentPreset,
						stylePreset: state.stylePreset
					})
				},
				120000
			);

			const data = await response.json();
			if (!response.ok) throw new Error(data.error || 'Prompt drafting failed');

			if (data.finalPrompt?.trim()) {
				updateDesignState({ draftPrompt: data.finalPrompt.trim() });
				uiNote = '\u270D\uFE0F Prompt draft written from conversation.';
			}
			if (data.assistantMessage) {
				appendDesignMessage({ role: 'assistant', content: data.assistantMessage });
			}
		} catch (err) {
			chatError = err.name === 'AbortError' ? 'Prompt writing timed out. Please retry.' : err.message;
			appendDesignMessage({ role: 'assistant', content: '\u26A0\uFE0F Prompt writing failed. Try again.' });
		} finally {
			isWritingPrompt = false;
		}
	}

	async function generateGenesis() {
		const state = get(designStore);
		if (!state.draftPrompt.trim() || isGenerating) return;

		clearTransientMessages();
		isGenerating = true;
		updateDesignState({ generatedImage: null });
		queueJobId = jobQueue.addJob({
			type: 'Genesis',
			kind: 'image',
			origin: 'design',
			name: state.contentPreset || 'Design',
			status: 'processing',
			progress: 10,
			message: 'Starting genesis generation...'
		});

		try {
			const referenceImage = state.chatReferenceImage || null;
			const activeChromaHex = $activeAssetStore?.chromaKeyHex || '#00FF00';
			const preflightInstructions = buildPreflightInstructions(
				state.genesisControls?.preflight || {},
				activeChromaHex
			);
			const prompt = buildGenesisPrompt(
				state.draftPrompt,
				state.contentPreset,
				state.stylePreset,
				preflightInstructions
			);
			const negativePromptText = (state.genesisControls?.negativePrompt || '').trim();
			const promptWithNegative = negativePromptText
				? `${prompt}\n\nAVOID (NEGATIVE PROMPT): ${negativePromptText}`
				: prompt;
			addPromptToHistory(state.draftPrompt);
			const groundedPrompt = referenceImage
				? `${promptWithNegative}\n\nREFERENCE LOCK (MANDATORY): Match the attached reference image's composition, silhouette, material rendering, and brush texture. Keep the same painting language and avoid generic AI-looking output.`
				: promptWithNegative;
			const useMasterStyleAnchor = state.stylePreset === 'pixel_anchor';
			const controls = state.genesisControls || {};
			const lockedSeed = sanitizeSeedValue(controls.seed || '');
			const shouldLockSeed = !!controls.lockSeed;
			const generationSeed = shouldLockSeed ? (lockedSeed || makeSeed()) : makeSeed();
			const generationNonce = generationSeed;
			updateDesignState({
				genesisControls: {
					...controls,
					seed: shouldLockSeed ? generationSeed : controls.seed || '',
					lastUsedSeed: generationSeed
				}
			});
			const response = await fetchWithTimeout(
				`/api/generate-sprite?ts=${Date.now()}`,
				{
					method: 'POST',
					cache: 'no-store',
					headers: {
						'Content-Type': 'application/json',
						'Cache-Control': 'no-cache, no-store, must-revalidate',
						Pragma: 'no-cache',
						Expires: '0'
					},
					body: JSON.stringify({
						prompt: groundedPrompt,
						referenceImage,
						useMasterStyleAnchor,
						generationNonce,
						generationModel: state.genesisModel || 'nano_banana'
					})
				},
				180000
			);
			const data = await response.json();
			if (!response.ok) throw new Error(data.error || 'Genesis generation failed');
			updateDesignState({ generatedImage: data.image });
			await completedJobs.addSprite({
				name: `Genesis ${state.contentPreset || 'Image'}`,
				image: data.image,
				description: (state.draftPrompt || '').slice(0, 240)
			});
			uiNote = '\u{1F389} Genesis image generated.';
			if (queueJobId) {
				jobQueue.updateJob(queueJobId, {
					progress: 95,
					message: 'Finalizing generated image...'
				});
				jobQueue.completeJob(queueJobId, { image: data.image });
			}
		} catch (err) {
			generationError = err.name === 'AbortError' ? 'Generation timed out. Try again.' : err.message;
			if (queueJobId) {
				jobQueue.failJob(queueJobId, generationError || 'Genesis generation failed');
			}
		} finally {
			queueJobId = null;
		}

		isGenerating = false;
	}

	function startNewChat() {
		clearTransientMessages();
		resetCurrentConversation();
		updateDesignState({ chatReferenceImage: null });
		uiNote = '\u{1F195} Started a new chat.';
	}

	function useIn(targetTab) {
		const state = get(designStore);
		if (!state.generatedImage) return;

		if (targetTab === 'edit') {
			projectStore.update((p) => ({ ...p, editImage: state.generatedImage }));
		} else if (targetTab === 'animate') {
			projectStore.update((p) => ({ ...p, firstFrame: state.generatedImage }));
		}

		if (typeof window !== 'undefined') {
			window.dispatchEvent(new CustomEvent('designNavigate', { detail: { tab: targetTab } }));
		}
	}

	async function saveGeneratedToAsset() {
		const state = get(designStore);
		if (!state.generatedImage || isSavingToAsset) return;
		if (!$activeAssetStore?.folderId) {
			uiNote = '\u26A0\uFE0F Select an active asset folder first.';
			return;
		}

		const uid = userFiles.getUid();
		if (!uid) {
			uiNote = '\u26A0\uFE0F Library is not ready yet.';
			return;
		}

		clearTransientMessages();
		isSavingToAsset = true;
		try {
			const filename = `design_${Date.now()}.png`;
			const response = await fetchWithTimeout(
				'/api/upload-file',
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						imageData: state.generatedImage,
						filename,
						folder: $activeAssetStore.folderId
					})
				},
				120000
			);
			const data = await response.json();
			if (!response.ok) throw new Error(data.error || 'Upload failed');

			await createFile(uid, $activeAssetStore.folderId, filename, data.url, 'image', {
				sourceType: 'design',
				prompt: state.draftPrompt || '',
				contentPreset: state.contentPreset,
				stylePreset: state.stylePreset,
				savedFrom: 'design_panel'
			});

			uiNote = '\u{1F4BE} Saved to active asset folder.';
		} catch (err) {
			uiNote = `\u26A0\uFE0F ${err.message || 'Failed to save image.'}`;
		} finally {
			isSavingToAsset = false;
		}
	}

	async function sendGeneratedToChat() {
		const state = get(designStore);
		if (!state.generatedImage || isChatting || isWritingPrompt) return;
		let referenceImage = state.generatedImage;
		try {
			const optimizedReference = await optimizeReferenceImage(state.generatedImage);
			const beforeBytes = estimateDataUrlBytes(state.generatedImage);
			const afterBytes = estimateDataUrlBytes(optimizedReference);
			referenceImage = optimizedReference;
			if (afterBytes < beforeBytes) {
				uiNote = `🗜️ Optimized reference image for chat (${Math.round(afterBytes / 1024)} KB).`;
			}
		} catch {
			// fall back to original generated image if optimization fails
		}

		const text = state.draftPrompt?.trim()
			? `Help me refine this prompt based on the latest generated image:\n\n${state.draftPrompt}\n\nAsk targeted questions and propose stronger revised prompt options.`
			: 'Help me refine the prompt for the latest generated image. Ask targeted questions and propose stronger revised prompt options.';

		updateDesignState({ mode: 'chat', chatReferenceImage: referenceImage });
		clearTransientMessages();
		isChatting = true;
		const before = get(designStore);
		appendDesignMessage({ role: 'user', content: text, image: referenceImage });

		try {
			const response = await fetchWithTimeout(
				'/api/design-chat',
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						mode: 'chat',
						messages: before.messages,
						userMessage: text,
						referenceImage,
						finalPrompt: before.draftPrompt,
						contentPreset: before.contentPreset,
						stylePreset: before.stylePreset
					})
				},
				120000
			);
			const data = await response.json();
			if (!response.ok) throw new Error(data.error || 'Design chat failed');
			appendDesignMessage({ role: 'assistant', content: data.assistantMessage || '\u2705 Idea refined.' });
			uiNote = '\u{1F4AC} Sent to GPT chat for prompt iteration.';
		} catch (err) {
			chatError = err.name === 'AbortError' ? 'Chat request timed out. Please retry.' : err.message;
			appendDesignMessage({ role: 'assistant', content: '\u26A0\uFE0F Chat failed. Try again.' });
		} finally {
			isChatting = false;
		}
	}
</script>

<div class="h-full flex flex-col gap-1.5 text-sm">
	<div class="flex gap-1 rounded-lg border p-1 bg-gray-50">
		<button
			class="flex-1 rounded px-2 py-1 text-xs font-medium {$designStore.mode === 'chat' ? 'bg-white text-blue-600 shadow' : 'text-gray-600'}"
			onclick={() => setMode('chat')}
		>
			&#x1F4AC; GPT Chat
		</button>
		<button
			class="flex-1 rounded px-2 py-1 text-xs font-medium {$designStore.mode === 'genesis' ? 'bg-white text-blue-600 shadow' : 'text-gray-600'}"
			onclick={() => setMode('genesis')}
		>
			&#x26A1; Genesis
		</button>
		<button
			class="flex-1 rounded px-2 py-1 text-xs font-medium {$designStore.mode === 'controls' ? 'bg-white text-blue-600 shadow' : 'text-gray-600'}"
			onclick={() => setMode('controls')}
		>
			&#x1F39B;&#xFE0F; Controls
		</button>
	</div>

	{#if $designStore.mode === 'chat'}
		<div class="grid grid-cols-2 gap-2">
			<button class="w-full px-3 py-1.5 rounded bg-gray-100 text-gray-700 text-xs border hover:bg-gray-200" onclick={openConversationModal}>
				&#x1F4D2; Conversations
			</button>
			<button class="w-full px-3 py-1.5 rounded bg-gray-100 text-gray-700 text-xs border hover:bg-gray-200" onclick={startNewChat}>
				&#x1F195; New Chat
			</button>
		</div>
	{/if}

	{#if $designStore.mode === 'chat'}
		<div class="grid grid-cols-2 gap-2">
			<div>
				<p class="text-[10px] text-gray-500 mb-1">&#x1F3F7;&#xFE0F; Generate Type</p>
				<select
					class="w-full border rounded px-2 py-1 text-xs bg-white"
					value={$designStore.contentPreset}
					onchange={(e) => updateDesignState({ contentPreset: e.target.value })}
				>
					<option value="">🚫 None</option>
					<option value="character">&#x1F9D9; Character</option>
					<option value="building">&#x1F3F0; Building</option>
					<option value="item">&#x1F5E1;&#xFE0F; Item</option>
					<option value="asset">&#x1F9F1; Asset</option>
					<option value="scenery">&#x1F332; Scenery</option>
					<option value="effects">&#x2728; Special Effects</option>
				</select>
			</div>
			<div>
				<p class="text-[10px] text-gray-500 mb-1">&#x1F9F5; Theme Style</p>
				<select
					class="w-full border rounded px-2 py-1 text-xs bg-white"
					value={$designStore.stylePreset}
					onchange={(e) => updateDesignState({ stylePreset: e.target.value })}
				>
					<option value="default">🚫 None</option>
					<option value="oil_painting_fantasy">&#x1F5BC;&#xFE0F; Oil Painting Fantasy</option>
				</select>
			</div>
		</div>
	{/if}

	{#if uiNote}
		<p class="text-[11px] text-blue-700 bg-blue-50 border border-blue-100 rounded px-2 py-1">{uiNote}</p>
	{/if}

	{#if $designStore.mode === 'chat'}
		<div class="rounded-lg border bg-white p-2 space-y-1.5">
			<div class="h-36 overflow-y-auto space-y-1.5 pr-1" bind:this={chatMessagesEl}>
				{#each $designStore.messages as m}
					<div class="rounded px-2 py-1 text-xs border {m.role === 'assistant' ? 'bg-blue-50 border-blue-100 text-blue-900' : 'bg-gray-50 border-gray-200 text-gray-800'}">
						<strong>{m.role === 'assistant' ? '\u{1F916} GPT' : '\u{1F9D1} You'}:</strong> {m.content}
						{#if m.image}
							<img src={m.image} alt="Chat attachment" class="mt-1 max-h-24 rounded border bg-white object-contain" />
						{/if}
					</div>
				{/each}
			</div>
			{#if chatError}
				<p class="text-[11px] text-red-600">&#x26A0;&#xFE0F; {chatError}</p>
			{/if}
			<div class="flex items-center gap-2 rounded border border-gray-200 bg-gray-50 px-2 py-1">
				<button
					class="px-2 py-1 rounded border bg-white text-xs text-gray-700 hover:bg-gray-100"
					onclick={() => referenceInputEl?.click()}
				>
					&#x1F5BC;&#xFE0F; Upload Ref
				</button>
				<input
					class="hidden"
					type="file"
					accept="image/*"
					bind:this={referenceInputEl}
					onchange={handleChatReferenceUpload}
				/>
				{#if $designStore.chatReferenceImage}
					<img src={$designStore.chatReferenceImage} alt="GPT chat reference" class="w-8 h-8 object-cover rounded border bg-white" />
					<button class="text-[10px] text-red-600 hover:text-red-700" onclick={clearChatReferenceImage}>
						Remove
					</button>
					<span class="text-[10px] text-gray-500">Attached to GPT chat</span>
				{:else}
					<span class="text-[10px] text-gray-500">No reference image attached</span>
				{/if}
			</div>
			<div class="flex gap-2">
				<input
					class="flex-1 border rounded px-2 py-1 text-xs"
					placeholder="Describe your idea..."
					bind:value={userInput}
					onkeydown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), sendChat())}
				/>
				<button class="px-3 py-1 rounded bg-blue-500 text-white text-xs disabled:bg-gray-400" onclick={sendChat} disabled={isChatting || isWritingPrompt}>
					{isChatting ? '\u23F3...' : '\u{1F4E8} Send'}
				</button>
				<button
					class="px-3 py-1 rounded bg-violet-500 text-white text-xs disabled:bg-gray-400"
					onclick={writePromptFromChat}
					disabled={isWritingPrompt || isChatting || $designStore.messages.length < 2}
				>
					{isWritingPrompt ? '\u23F3...' : '\u270D\uFE0F Write Prompt'}
				</button>
			</div>
		</div>

		<div class="rounded-lg border p-2 space-y-1.5">
			<div class="flex items-center justify-between">
				<p class="text-xs font-medium text-gray-700">&#x1F9FE; Prompt Draft</p>
				<div class="flex gap-2">
					<button class="text-[10px] text-gray-500 hover:text-emerald-600" onclick={saveCurrentPromptToHistory}>&#x1F4BE; Save</button>
					<button class="text-[10px] text-gray-500 hover:text-blue-600" onclick={copyPrompt}>&#x1F4CB; Copy</button>
					<button class="text-[10px] text-gray-500 hover:text-red-600" onclick={clearPrompt}>&#x1F9F9; Clear</button>
				</div>
			</div>
			<textarea
				class="w-full border rounded px-2 py-1 text-xs"
				rows="4"
				value={$designStore.draftPrompt}
				oninput={(e) => updateDesignState({ draftPrompt: e.target.value })}
				placeholder="Click Write Prompt to generate from chat"
			></textarea>
			<button class="w-full px-3 py-2 rounded bg-blue-500 hover:bg-blue-600 text-white text-xs font-medium disabled:bg-gray-400" onclick={usePromptInGenesis} disabled={!$designStore.draftPrompt.trim()}>
				&#x26A1; Use This Prompt in Genesis
			</button>
		</div>
	{:else if $designStore.mode === 'genesis'}
		<div class="rounded-lg border p-2 space-y-2">
			<div>
				<p class="text-[10px] text-gray-500 mb-1">🧠 Genesis Model</p>
				<select
					class="w-full border rounded px-2 py-1 text-xs bg-white"
					value={$designStore.genesisModel || 'nano_banana'}
					onchange={(e) => updateDesignState({ genesisModel: e.target.value })}
				>
					{#each GENESIS_MODEL_OPTIONS as model}
						<option value={model.id}>{model.label}</option>
					{/each}
				</select>
			</div>
			<p class="text-xs font-medium text-gray-700">&#x26A1; Genesis Prompt</p>
			<textarea
				class="w-full border rounded px-2 py-1 text-xs"
				rows="4"
				value={$designStore.draftPrompt}
				oninput={(e) => updateDesignState({ draftPrompt: e.target.value })}
			></textarea>
			<div class="flex items-center gap-2 rounded border border-gray-200 bg-gray-50 px-2 py-1">
				<button
					class="px-2 py-1 rounded border bg-white text-xs text-gray-700 hover:bg-gray-100"
					onclick={() => genesisReferenceInputEl?.click()}
				>
					🖼️ Upload Ref
				</button>
				<input
					class="hidden"
					type="file"
					accept="image/*"
					bind:this={genesisReferenceInputEl}
					onchange={handleGenesisReferenceUpload}
				/>
				{#if $designStore.chatReferenceImage}
					<img src={$designStore.chatReferenceImage} alt="Genesis reference" class="w-8 h-8 object-cover rounded border bg-white" />
					<button class="text-[10px] text-red-600 hover:text-red-700" onclick={clearGenesisReferenceImage}>
						Remove
					</button>
					<span class="text-[10px] text-gray-500">Used during Genesis generate</span>
				{:else}
					<span class="text-[10px] text-gray-500">No Genesis reference image attached</span>
				{/if}
			</div>
			<button
				class="w-full px-2 py-1.5 text-xs rounded border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
				onclick={saveCurrentPromptToHistory}
			>
				&#x1F4BE; Save Prompt
			</button>
			<p class="text-xs font-medium text-gray-700">🚫 Negative Prompt</p>
			<textarea
				class="w-full border rounded px-2 py-1 text-xs"
				rows="2"
				value={$designStore.genesisControls?.negativePrompt || ''}
				oninput={(e) => updateNegativePrompt(e.target.value)}
				placeholder="e.g. blurry, text artifacts, extra limbs, warped anatomy"
			></textarea>
			<div class="grid grid-cols-2 gap-2">
				<button class="px-2 py-2 text-xs rounded bg-gray-100 text-gray-700" onclick={() => setMode('chat')}>&#x1F4AC; Back to Chat</button>
				<button class="px-2 py-2 text-xs rounded bg-blue-500 text-white disabled:bg-gray-400" onclick={generateGenesis} disabled={isGenerating || !$designStore.draftPrompt.trim()}>
					{isGenerating ? '\u23F3 Generating...' : '\u{1F680} Generate'}
				</button>
			</div>
			{#if generationError}
				<p class="text-[11px] text-red-600">&#x26A0;&#xFE0F; {generationError}</p>
			{/if}
		</div>

		{#if $designStore.generatedImage}
			<div class="rounded-lg border p-2 space-y-2">
				<div class="relative">
					<button class="w-full" onclick={openPreview}>
						<img src={$designStore.generatedImage} alt="Genesis result" class="w-full max-h-44 object-contain rounded bg-gray-50 border cursor-zoom-in" />
					</button>
					<button class="absolute top-1 right-1 px-2 py-1 text-[10px] rounded bg-black/70 text-white hover:bg-black/80" onclick={openPreview}>
						&#x1F50D; Full
					</button>
				</div>
				<div class="grid grid-cols-4 gap-2">
					<button
						class="px-2 py-2 text-xs rounded border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
						onclick={saveGeneratedToAsset}
						disabled={isSavingToAsset || !$activeAssetStore?.folderId}
					>
						{isSavingToAsset ? '\u23F3 Save...' : '\u{1F4BE} Save'}
					</button>
					<button
						class="px-2 py-2 text-xs rounded border border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100 disabled:opacity-50"
						onclick={sendGeneratedToChat}
						disabled={isChatting || isWritingPrompt}
					>
						{isChatting ? '\u23F3 Refine...' : '\u270D\uFE0F Refine'}
					</button>
					<button class="px-2 py-2 text-xs rounded border border-teal-200 bg-teal-50 text-teal-700 hover:bg-teal-100" onclick={() => useIn('edit')}>&#x270F;&#xFE0F; Edit</button>
					<button class="px-2 py-2 text-xs rounded border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100" onclick={() => useIn('animate')}>&#x1F3AC; Animate</button>
				</div>
			</div>
		{/if}
	{:else}
		<div class="rounded-lg border p-2 space-y-2 bg-white">
			<p class="text-xs font-semibold text-gray-800">&#x1F39B;&#xFE0F; Genesis Controls</p>
			<p class="text-[11px] text-gray-600">
				This tab is for generation controls that improve reliability and iteration quality.
			</p>
			<div class="rounded border border-emerald-200 bg-emerald-50/40 p-2 space-y-2">
				<p class="text-[11px] font-semibold text-emerald-800">1) Preflight Asset Readiness Checklist</p>
				<div class="grid grid-cols-2 gap-x-4 gap-y-1">
					<label class="flex items-center gap-2 text-[11px] text-gray-800">
						<input
							type="checkbox"
							checked={$designStore.genesisControls?.preflight?.fullBodyInFrame || false}
							onchange={(e) => updatePreflightToggle('fullBodyInFrame', e.target.checked)}
						/>
						<span>Full body in frame</span>
					</label>
					<label class="flex items-center gap-2 text-[11px] text-gray-800">
						<input
							type="checkbox"
							checked={$designStore.genesisControls?.preflight?.flatBg || false}
							onchange={(e) => updatePreflightToggle('flatBg', e.target.checked)}
						/>
						<span>Flat BG</span>
					</label>
					<label class="flex items-center gap-2 text-[11px] text-gray-800">
						<input
							type="checkbox"
							checked={$designStore.genesisControls?.preflight?.transparentReady || false}
							onchange={(e) => updatePreflightToggle('transparentReady', e.target.checked)}
						/>
						<span>Transparent-ready</span>
					</label>
					<label class="flex items-center gap-2 text-[11px] text-gray-800">
						<input
							type="checkbox"
							checked={$designStore.genesisControls?.preflight?.spriteSafeSilhouette || false}
							onchange={(e) => updatePreflightToggle('spriteSafeSilhouette', e.target.checked)}
						/>
						<span>Sprite-safe silhouette</span>
					</label>
				</div>
				<p class="text-[10px] text-emerald-700">
					Checked items are appended as mandatory preflight requirements on Genesis generate.
				</p>
			</div>
			<div class="rounded border border-gray-200 bg-gray-50 p-2 text-[11px] text-gray-700 space-y-1">
				<div class="flex items-center justify-between">
					<p class="font-semibold text-gray-800">2) Prompt History + Favorites</p>
					<span class="text-[10px] text-gray-500">
						{($designStore.genesisControls?.promptHistory || []).length}/{MAX_PROMPT_HISTORY}
					</span>
				</div>
				{#if ($designStore.genesisControls?.promptHistory || []).length === 0}
					<p class="text-[10px] text-gray-500">No prompt history yet. Generate once to start tracking prompts.</p>
				{:else}
					<div class="space-y-1.5 max-h-[7.25rem] overflow-y-auto pr-1">
						{#each $designStore.genesisControls.promptHistory as item (item.id)}
							<div class="rounded border border-gray-200 bg-white p-1.5 space-y-1">
								<p class="text-[10px] text-gray-700 max-h-8 overflow-hidden">
									{item.prompt}
								</p>
								<div class="flex items-center gap-1">
									<button
										class="px-1.5 py-0.5 rounded border text-[10px] {item.starred ? 'border-amber-300 bg-amber-50 text-amber-700' : 'border-gray-200 bg-gray-50 text-gray-600'}"
										onclick={() => togglePromptHistoryStar(item.id)}
									>
										{item.starred ? '★' : '☆'}
									</button>
									<button class="px-1.5 py-0.5 rounded border border-blue-200 bg-blue-50 text-blue-700 text-[10px]" onclick={() => reusePromptHistoryItem(item.prompt)}>
										Reuse
									</button>
									<button class="px-1.5 py-0.5 rounded border border-gray-200 bg-gray-50 text-gray-700 text-[10px]" onclick={() => copyPromptHistoryItem(item.prompt)}>
										Copy
									</button>
									<button class="ml-auto px-1.5 py-0.5 rounded border border-red-200 bg-red-50 text-red-700 text-[10px]" onclick={() => deletePromptHistoryItem(item.id)}>
										Delete
									</button>
								</div>
							</div>
						{/each}
					</div>
				{/if}
				<div class="rounded border border-gray-200 bg-white p-2 space-y-1.5">
					<p class="font-semibold text-gray-800">3) Seed + Reproducibility Controls</p>
					<div class="grid grid-cols-[1fr_auto] gap-2 items-center">
						<input
							class="w-full border rounded px-2 py-1 text-[10px]"
							placeholder="Seed (letters, numbers, _ or -)"
							value={$designStore.genesisControls?.seed || ''}
							oninput={(e) => updateSeedValue(e.target.value)}
						/>
						<label class="flex items-center gap-1 text-[10px] border rounded px-2 py-1 bg-gray-50">
							<input
								type="checkbox"
								checked={$designStore.genesisControls?.lockSeed || false}
								onchange={(e) => updateLockSeed(e.target.checked)}
							/>
							<span>Lock seed</span>
						</label>
					</div>
					<div class="flex items-center justify-between gap-2">
						<p class="text-[10px] text-gray-500 truncate">
							Last used: {$designStore.genesisControls?.lastUsedSeed || 'none'}
						</p>
						<button
							class="px-1.5 py-0.5 rounded border border-blue-200 bg-blue-50 text-blue-700 text-[10px] disabled:opacity-50"
							disabled={!$designStore.genesisControls?.lastUsedSeed}
							onclick={() => {
								const currentControls = $designStore.genesisControls || {};
								updateDesignState({
									genesisControls: {
										...currentControls,
										seed: currentControls.lastUsedSeed || '',
										lockSeed: true
									}
								});
								uiNote = '🎲 Seed locked to last used. Run Generate again to reproduce.';
							}}
						>
							Rerun with same seed
						</button>
					</div>
					<p class="text-[10px] text-gray-500">
						Provider behavior may vary; deterministic replay is best-effort.
					</p>
				</div>
				<p>4) Negative Prompt Field</p>
			</div>
			<p class="text-[10px] text-gray-500">
				Implementation sequence is documented and will be delivered one feature at a time.
			</p>
		</div>
	{/if}
</div>

{#if showPreview && $designStore.generatedImage}
	<div
		class="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-4"
		onclick={closePreview}
		onkeydown={(e) => { if (e.key === 'Escape') closePreview(); }}
		tabindex="0"
		role="dialog"
		aria-modal="true"
	>
		<div class="relative max-w-4xl max-h-[90vh]" onclick={(e) => e.stopPropagation()}>
			<button
				class="absolute -top-10 right-0 text-white hover:text-gray-300 text-2xl font-bold"
				onclick={closePreview}
				title="Close"
			>
				&#x2715;
			</button>
			<img
				src={$designStore.generatedImage}
				alt="Genesis full preview"
				class="max-w-full max-h-[85vh] object-contain rounded-lg"
			/>
		</div>
	</div>
{/if}

{#if showNewAssetModal}
	<div
		class="fixed inset-0 z-40 bg-black/40 flex items-center justify-center p-4"
		onclick={closeNewAssetModal}
		onkeydown={(e) => { if (e.key === 'Escape') closeNewAssetModal(); }}
		tabindex="0"
		role="dialog"
		aria-modal="true"
	>
		<div class="w-full max-w-md rounded-lg border bg-white p-3 space-y-2" onclick={(e) => e.stopPropagation()}>
			<p class="text-sm font-semibold text-gray-800">&#x1F4C1; New Asset Workspace</p>
			<input
				class="w-full border rounded px-2 py-1 text-xs"
				placeholder="Asset name"
				bind:value={newAssetName}
			/>
			<select
				class="w-full border rounded px-2 py-1 text-xs bg-white"
				bind:value={newAssetType}
			>
				<option value="character">Character</option>
				<option value="building">Building</option>
				<option value="item">Item</option>
				<option value="asset">Asset</option>
				<option value="scenery">Scenery</option>
				<option value="effects">Effects</option>
			</select>
			<textarea
				class="w-full border rounded px-2 py-1 text-xs"
				rows="2"
				placeholder="Notes (metadata)"
				bind:value={newAssetNotes}
			></textarea>
			<input
				class="w-full border rounded px-2 py-1 text-xs"
				placeholder="Tags (comma separated)"
				bind:value={newAssetTags}
			/>
			<div class="grid grid-cols-2 gap-2 pt-1">
				<button class="px-2 py-2 text-xs rounded bg-gray-100 text-gray-700" onclick={closeNewAssetModal}>Cancel</button>
				<button
					class="px-2 py-2 text-xs rounded bg-emerald-500 text-white disabled:bg-gray-400"
					onclick={createAssetFromDesign}
					disabled={isCreatingAsset || !newAssetName.trim()}
				>
					{isCreatingAsset ? '\u23F3 Creating...' : 'Create Asset'}
				</button>
			</div>
		</div>
	</div>
{/if}

