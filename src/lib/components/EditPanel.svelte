<script>
	import { browser } from '$app/environment';
	import { projectStore } from '$lib/stores/project.js';
	import { jobQueue } from '$lib/stores/jobQueue.js';
	import { userFiles } from '$lib/stores/userFiles.js';
	import { createFile } from '$lib/firebase/firestore.js';
	import FolderPicker from './FolderPicker.svelte';
	import { activeAssetStore } from '$lib/stores/activeAsset.js';

	let { initialImage = null, onChange = null } = $props();

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
	
	// Save to folder
	let showFolderPicker = $state(false);
	let saveFolderId = $state(null);
	let saveFolderPath = $state(null);
	const EDIT_STATE_KEY = 'spritemagician.edit.panel.v1';

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
				if (typeof parsed?.editContext === 'string') editContext = parsed.editContext;
				if (typeof parsed?.selectedStyleFlavor === 'string') selectedStyleFlavor = parsed.selectedStyleFlavor;
				if (typeof parsed?.selectedPresetId === 'string') selectedPresetId = parsed.selectedPresetId;
				if (typeof parsed?.enforceUncropped === 'boolean') enforceUncropped = parsed.enforceUncropped;
				if (typeof parsed?.removeBackgroundSetting === 'boolean') removeBackgroundSetting = parsed.removeBackgroundSetting;
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
		{ id: 'asset', label: '\u{1F9F1} Asset' },
		{ id: 'scenery', label: '\u{1F332} Scenery' },
		{ id: 'effects', label: '\u2728 Special Effect' }
	];

	const CHARACTER_POSE_PRESETS = [
		{ id: 'reframe', label: '\u{1F4D0} Reframe Uncropped', prompt: 'show the full character from head to toe, centered, with clear margin around the silhouette' },
		{ id: 'tposefront', label: '\u{1F9CD} Front T-Pose', prompt: 'front profile facing camera, full-body T-pose, arms extended horizontally, legs shoulder-width, neutral expression, fully visible and uncropped' },
		{ id: 'idle', label: '\u{1F9CD} Idle', prompt: 'neutral idle stance, full body visible, balanced posture, clear silhouette' },
		{ id: 'ready', label: '\u2694\uFE0F Ready Stance', prompt: 'combat-ready stance, weight centered, full body visible, readable silhouette' },
		{ id: 'walk', label: '\u{1F6B6} Walking', prompt: 'walking pose, one leg forward and one back, full body visible' },
		{ id: 'midstride', label: '\u{1F463} Mid Stride', prompt: 'mid-stride pose with clear leg separation, full body visible' },
		{ id: 'run', label: '\u{1F3C3} Running', prompt: 'running pose with dynamic arm and leg swing, full body visible' },
		{ id: 'midsprint', label: '\u{1F4A8} Mid Sprint', prompt: 'mid-sprint pose, aggressive forward lean, full body visible, no crop' },
		{ id: 'jump', label: '\u{1F998} Jumping', prompt: 'jumping pose, airborne, full body visible including feet and hands' },
		{ id: 'land', label: '\u{1F6EC} Landing', prompt: 'landing pose with bent knees and impact posture, full body visible' },
		{ id: 'attack', label: '\u{1F5E1}\uFE0F Attack Windup', prompt: 'attack windup pose, strong anticipation, full body visible' },
		{ id: 'cast', label: '\u2728 Casting', prompt: 'spell casting pose, one arm extended, full body visible' },
		{ id: 'damage', label: '\u{1F4A5} Taking Damage', prompt: 'hit reaction pose, torso recoiling, full body visible, maintain identity' },
		{ id: 'pain', label: '\u{1F616} In Pain', prompt: 'pain reaction pose, tense body language, full body visible' },
		{ id: 'stagger', label: '\u{1F300} Staggered', prompt: 'staggered off-balance pose after impact, full body visible' },
		{ id: 'knockdown', label: '\u{1FAA6} Knocked Down', prompt: 'knocked-down pose on ground plane, full body visible, uncropped' },
		{ id: 'dead', label: '\u2620\uFE0F Dead', prompt: 'defeated dead pose, body fully visible in frame, uncropped' }
	];

	const CONTEXT_PRESETS = {
		character: CHARACTER_POSE_PRESETS,
		building: [
			{ id: 'facade', label: '\u{1F3D7}\uFE0F Repair Facade', prompt: 'repair damaged structure details while preserving building silhouette and style' },
			{ id: 'ruin', label: '\u{1F9F1} Ruined Variant', prompt: 'create a ruined variant with broken sections and debris while preserving composition' },
			{ id: 'lighting', label: '\u{1F56F}\uFE0F Lighting Pass', prompt: 'enhance architectural lighting readability while preserving forms and scale' }
		],
		item: [
			{ id: 'clean', label: '\u{1F9FC} Clean Readability', prompt: 'clean up shape readability and material clarity while preserving item identity' },
			{ id: 'rare', label: '\u{1F48E} Rare Variant', prompt: 'create a rare-tier variant with richer accents and clearer focal highlights' },
			{ id: 'battleworn', label: '\u{1F6E0}\uFE0F Battle Worn', prompt: 'add battle-worn wear, scratches, and grime while preserving silhouette' }
		],
		asset: [
			{ id: 'modular', label: '\u{1F9E9} Modular Cleanup', prompt: 'improve modular readability and edge continuity while preserving asset shape' },
			{ id: 'material', label: '\u{1FAB5} Material Pass', prompt: 'improve material definition and texture readability, keep proportions identical' },
			{ id: 'variant', label: '\u{1F3A8} Color Variant', prompt: 'create a color variant while preserving form and details' }
		],
		scenery: [
			{ id: 'depth', label: '\u{1F32B}\uFE0F Add Depth', prompt: 'improve scene depth layering and atmospheric separation while preserving composition' },
			{ id: 'clean', label: '\u{1F9F9} Cleanup', prompt: 'remove distracting clutter and improve scene readability while keeping key forms' },
			{ id: 'mood', label: '\u{1F319} Mood Pass', prompt: 'adjust mood lighting and color grading while preserving structural composition' }
		],
		effects: [
			{ id: 'boost', label: '\u26A1 Boost Intensity', prompt: 'increase effect intensity and contrast while preserving the effect shape language' },
			{ id: 'clean', label: '\u{1F300} Clean Effect', prompt: 'remove noise and improve edge readability of the effect' },
			{ id: 'variant', label: '\u{1F308} Color Shift', prompt: 'create a color-shifted effect variant while preserving motion language' }
		]
	};

	const EDIT_STYLE_FLAVORS = [
		{ id: 'none', label: 'Default (no style boost)', prompt: '' },
		{
			id: 'cinematic',
			label: '🎬 Cinematic',
			prompt: 'cinematic composition, controlled contrast, dramatic but clean lighting, premium concept-art finish'
		},
		{
			id: 'painterly',
			label: '🖌️ Painterly',
			prompt: 'painterly brushwork, rich texture, organic strokes, handcrafted illustrative finish'
		},
		{
			id: 'pixel',
			label: '🧩 Pixel-art ready',
			prompt: 'sprite-readability emphasis, simplified shape clusters, clean edges, controlled pixel-art friendly detailing'
		},
		{
			id: 'anime',
			label: '✨ Anime stylized',
			prompt: 'anime-influenced stylization, clean line hierarchy, cel-friendly shading logic, crisp silhouette readability'
		},
		{
			id: 'dark_fantasy',
			label: '🌑 Dark fantasy',
			prompt: 'dark fantasy mood, gritty material treatment, moody atmosphere, strong focal readability'
		}
	];

	let editContext = $state('character');
	let selectedStyleFlavor = $state('none');
	let selectedPresetId = $state(null);
	let enforceUncropped = $state(true);
	let removeBackgroundSetting = $state(true);

	let activePresets = $derived(CONTEXT_PRESETS[editContext] || []);
	let isCharacterContext = $derived(editContext === 'character');

	$effect(() => {
		selectedPresetId = null;
		if (editContext !== 'character' && mode === 'edit' && editPrompt.trim() === '') {
			// Keep prompt empty unless user applies a preset
		}
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
			sourceImage = ev.target.result;
			resultImage = null;
			error = null;
			onChange?.(ev.target.result);
			const img = new Image();
			img.onload = () => {
				imgWidth = img.width;
				imgHeight = img.height;
			};
			img.src = ev.target.result;
		};
		reader.readAsDataURL(file);
	}

	// Load image from parent handoff/store whenever the prop changes
	let _lastLoadedImage = null;
	$effect(() => {
		if (initialImage && initialImage !== _lastLoadedImage) {
			_lastLoadedImage = initialImage;
			sourceImage = initialImage;
			resultImage = null;
			error = null;
			const img = new Image();
			img.onload = () => { imgWidth = img.width; imgHeight = img.height; };
			img.src = initialImage;
		}
	});

	function clearImage() {
		sourceImage = null;
		resultImage = null;
		error = null;
		imgWidth = 0;
		imgHeight = 0;
		onChange?.(null);
	}

	function appendPromptInstruction(instruction) {
		const next = (instruction || '').trim();
		if (!next) return;
		const current = (editPrompt || '').trim();
		if (!current) {
			editPrompt = next;
			return;
		}
		const currentLower = current.toLowerCase();
		const nextLower = next.toLowerCase();
		if (currentLower.includes(nextLower)) return;
		editPrompt = `${current}\n${next}`;
	}


	function applyPreset(preset) {
		if (!preset?.prompt) return;
		selectedPresetId = preset.id;
		appendPromptInstruction(preset.prompt);
	}

	function applySelectedPreset() {
		const preset = activePresets.find((p) => p.id === selectedPresetId);
		if (preset) applyPreset(preset);
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
					editContext,
					selectedStyleFlavor,
					selectedPresetId,
					enforceUncropped,
					removeBackgroundSetting,
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

	function applyFlatBackgroundPreset() {
		const hex = getActiveChromaKeyHex();
		appendPromptInstruction(`set the background to a perfectly flat solid color (${hex}), keep subject edges clean and fully separated`);
	}

	function buildGlobalGuardrails() {
		const rules = [];

		if (enforceUncropped) {
			rules.push(`CRITICAL FRAMING RULES (MANDATORY):
- Entire subject must be fully visible and uncropped.
- Keep margin around the subject silhouette.
- Do not cut off any key parts of the subject.
- If any instruction implies close-up or crop, ignore that and keep full-subject framing.`);
		}

		if (isCharacterContext && enforceUncropped) {
			rules.push(`CHARACTER-SPECIFIC FRAMING RULES:
- Show full body from head to toe, including hands and feet.
- Do not cut off limbs, weapons, hair, tails, wings, or accessories.
- Maintain character identity, outfit, anatomy, and proportions.`);
		}

		if (removeBackgroundSetting) {
			const chromaHex = getActiveChromaKeyHex();
			rules.push(`BACKGROUND RULE (MANDATORY):
- Remove background and environmental clutter.
- Keep only the isolated subject.
- Output should have a solid chroma key background (${chromaHex}).
- Reserve ${chromaHex} for background only; do not use that exact color on the subject.`);
		}

		return rules.join('\n\n');
	}

	function buildAutoEditInstruction() {
		if (editContext === 'character') {
			return 'isolate the character as the main subject and keep pose readability high';
		}
		if (editContext === 'building') {
			return 'isolate the building structure as the main subject and preserve architectural readability';
		}
		if (editContext === 'item') {
			return 'isolate the item as the main subject and improve shape/material readability';
		}
		if (editContext === 'asset') {
			return 'isolate the asset as the main subject and preserve form clarity';
		}
		if (editContext === 'scenery') {
			return 'isolate the primary scenery subject and preserve composition readability';
		}
		if (editContext === 'effects') {
			return 'isolate the effect subject and keep effect shape and intensity readable';
		}
		return 'isolate the subject and keep it fully readable';
	}

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
			name: editContext || 'image',
			status: 'processing',
			progress: 10,
			message: mode === 'edit' ? 'Applying edit...' : 'Preparing expansion...'
		});

		try {
			let imageToSend = sourceImage;
			let promptToSend = editPrompt;

			if (mode === 'expand') {
				try {
					imageToSend = await buildExpandedImage();
					if (queueJobId) {
						jobQueue.updateJob(queueJobId, { progress: 35, message: 'Expanded canvas prepared...' });
					}
				} catch (expandError) {
					error = `Failed to build expanded image: ${expandError.message}. Make sure the image is from the same origin or has CORS enabled.`;
					if (queueJobId) {
						jobQueue.failJob(queueJobId, error);
					}
					generating = false;
					queueJobId = null;
					return;
				}
				promptToSend = `OUTPAINTING: The provided image has gray (#C0C0C0) border areas where the canvas was expanded. The original artwork is intact in its position. Generate new content ONLY in the gray areas to seamlessly extend the scene. Keep the original pixels untouched. Expansion direction: ${expandDirection}. What to generate in the new space: ${editPrompt}`;
			} else {
				const effectiveInstruction = editPrompt.trim() || buildAutoEditInstruction();
				const contextInstruction = `Context: ${editContext}.`;
				const styleFlavorInstruction =
					EDIT_STYLE_FLAVORS.find((item) => item.id === selectedStyleFlavor)?.prompt || '';
				const guardrail = buildGlobalGuardrails();
				const guardrailBlock = guardrail ? `\n\n${guardrail}` : '';
				const styleBlock = styleFlavorInstruction ? ` Style Flavor: ${styleFlavorInstruction}.` : '';
				promptToSend = `Edit this image according to these instructions: ${effectiveInstruction}. ${contextInstruction}${styleBlock}${guardrailBlock}

Keep everything not explicitly mentioned unchanged. Maintain the same art style, lighting, and quality.`;
			}

			const res = await fetch('/api/edit-image', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					image: imageToSend,
					prompt: promptToSend,
					mode
				})
			});

			const data = await res.json();
			if (!res.ok) throw new Error(data.error || 'Edit failed');

			if (queueJobId) {
				jobQueue.updateJob(queueJobId, { progress: 90, message: 'Finalizing image...' });
			}
			resultImage = data.image;
			onChange?.(data.image);
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
				jobQueue.completeJob(queueJobId, { image: data.image });
			}
		} catch (e) {
			error = e.message;
			if (queueJobId) {
				jobQueue.failJob(queueJobId, e.message || 'Edit failed');
			}
		} finally {
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
		const img = new Image();
		img.onload = () => {
			imgWidth = img.width;
			imgHeight = img.height;
		};
		img.src = sourceImage;
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

<div class="space-y-2">
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

	<div class="rounded-lg border border-gray-200 bg-white p-2.5 space-y-1.5">
		<div class="flex items-center justify-between">
			<p class="text-sm font-semibold text-gray-800">&#x1F5BC;&#xFE0F; Source Image</p>
			{#if sourceMetaText}
				<p class="text-xs text-gray-500">{sourceMetaText}</p>
			{/if}
		</div>

		{#if !sourceImage}
			<label
				class="block border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors {isDragging ? 'border-blue-400 bg-blue-50' : 'border-gray-300 hover:border-gray-400'}"
				ondragover={(e) => { e.preventDefault(); isDragging = true; }}
				ondragleave={() => isDragging = false}
				ondrop={handleDrop}
			>
				<input type="file" accept="image/*" class="hidden" onchange={handleFileChange} />
				<div class="text-2xl mb-1">{isDragging ? '&#x1F4E5;' : '&#x1F5BC;&#xFE0F;'}</div>
				<p class="text-sm text-gray-600 font-medium">Drop an image or click to upload</p>
				<p class="text-xs text-gray-400 mt-1">PNG, JPG, WebP supported</p>
			</label>
		{:else}
			<div class="relative rounded-md border border-gray-200 bg-gray-300 p-0.5">
				<button class="w-full cursor-zoom-in" onclick={() => lightboxSrc = sourceImage}>
					<div class="w-full rounded flex items-center justify-center">
						<img
							src={sourceImage}
							alt="Source"
							class="w-full max-h-24 object-contain rounded"
							style="image-rendering: pixelated; background-color: #808080;"
						/>
					</div>
				</button>
				<button
					onclick={clearImage}
					class="absolute top-2 right-2 w-7 h-7 bg-red-500 text-white rounded-full text-sm flex items-center justify-center hover:bg-red-600"
					title="Remove image"
				>✕</button>
			</div>
		{/if}
	</div>

	{#if mode === 'expand' && sourceImage}
		<div class="rounded-lg border border-orange-200 bg-orange-50 p-2.5 space-y-2">
			<p class="text-sm font-semibold text-orange-800">&#x1F532; Expand Setup</p>
			<div class="grid grid-cols-2 gap-3">
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
			</div>

			{#if imgWidth && imgHeight}
				<p class="text-xs text-orange-700 bg-orange-100 border border-orange-200 rounded px-2 py-1">
					New canvas: {imgWidth}×{imgHeight} -> {expandedWidth}×{expandedHeight}px
				</p>
			{/if}
		</div>
	{/if}

	{#if sourceImage}
		{#if mode === 'edit'}
			<div class="rounded-lg border border-gray-200 bg-white p-2 space-y-1.5">
				<div class="grid grid-cols-2 gap-3">
					<div>
						<label for="edit-context" class="block text-xs font-medium text-gray-700 mb-1">Context Type</label>
						<select
							id="edit-context"
							bind:value={editContext}
							class="w-full px-2 py-1.5 text-xs border rounded bg-white"
						>
							{#each EDIT_CONTEXTS as ctx}
								<option value={ctx.id}>{ctx.label}</option>
							{/each}
						</select>
					</div>
					<div>
						<label for="edit-style" class="block text-xs font-medium text-gray-700 mb-1">Style</label>
						<select
							id="edit-style"
							bind:value={selectedStyleFlavor}
							class="w-full px-2 py-1.5 text-xs border rounded bg-white"
						>
							{#each EDIT_STYLE_FLAVORS as styleItem}
								<option value={styleItem.id}>{styleItem.label}</option>
							{/each}
						</select>
					</div>
				</div>

				<div class="grid grid-cols-2 gap-3">
					<label class="flex items-center gap-1.5 text-xs border rounded px-2 py-1.5 bg-white">
						<input type="checkbox" bind:checked={enforceUncropped} class="w-3.5 h-3.5" />
						<span>&#x1F9CD; Keep Uncropped</span>
					</label>
					<label class="flex items-center gap-1.5 text-xs border rounded px-2 py-1.5 bg-white">
						<input type="checkbox" bind:checked={removeBackgroundSetting} class="w-3.5 h-3.5" />
						<span>&#x1F5D1;&#xFE0F; Remove Background</span>
					</label>
				</div>

				<div class="grid grid-cols-[1fr_auto] gap-2 items-end">
					<div>
						<label for="edit-preset" class="block text-xs font-medium text-gray-700 mb-1">Quick Direction</label>
						<select
							id="edit-preset"
							bind:value={selectedPresetId}
							class="w-full px-2 py-1.5 text-xs border rounded bg-white"
						>
							<option value="">Choose preset...</option>
							{#each activePresets as preset}
								<option value={preset.id}>{preset.label}</option>
							{/each}
						</select>
					</div>
					<button
						class="px-2.5 py-1.5 text-xs rounded border border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100 disabled:border-gray-200 disabled:bg-gray-100 disabled:text-gray-400"
						onclick={applySelectedPreset}
						disabled={!selectedPresetId}
					>
						Apply Preset
					</button>
				</div>

				<div class="grid grid-cols-2 gap-2">
					{#if isCharacterContext}
						<button
							class="w-full px-2 py-1.5 text-xs rounded border border-blue-300 bg-blue-50 text-blue-700 text-left hover:bg-blue-100"
							onclick={() => {
								const tPosePreset = activePresets.find((p) => p.id === 'tposefront');
								if (tPosePreset) applyPreset(tPosePreset);
							}}
						>
							&#x1F9CD; Front T-Pose
						</button>
					{/if}
					<button
						class="w-full px-2 py-1.5 text-xs rounded border border-emerald-300 bg-emerald-50 text-emerald-700 text-left hover:bg-emerald-100"
						onclick={applyFlatBackgroundPreset}
					>
						&#x1F7E9; Flat BG ({getActiveChromaKeyHex()})
					</button>
				</div>

			</div>
		{/if}

		<div class="rounded-lg border border-gray-200 bg-white p-2 space-y-1">
			<textarea
				id="edit-prompt"
				bind:value={editPrompt}
				placeholder={mode === 'edit'
					? 'Optional: add extra instructions, or leave blank to use context + guardrails'
					: 'e.g. "Show the full body with legs and feet on a stone floor"'}
				class="w-full px-2 py-1.5 text-xs border rounded resize-none"
				rows="5"
			></textarea>
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
	{/if}

	<!-- Error -->
	{#if error}
		<p class="text-xs text-red-600 bg-red-50 rounded p-2">{error}</p>
	{/if}

	<!-- Help Text -->
	{#if !sourceImage}
		<div class="text-xs text-gray-400 space-y-1">
			<p><strong>✏️ Edit:</strong> Upload an image and describe changes via prompt.</p>
			<p><strong>🔲 Expand:</strong> Outpaint — extend the canvas and fill with AI-generated content.</p>
		</div>
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
