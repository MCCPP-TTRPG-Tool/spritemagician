<script>
	import { browser } from '$app/environment';
	import EditPanel from './EditPanel.svelte';
	import CharacterWizard from './CharacterWizard.svelte';
	import GenerationPanel from './GenerationPanel.svelte';
	import FolderPicker from './FolderPicker.svelte';
	import { projectStore } from '$lib/stores/project.js';
	import { userFiles } from '$lib/stores/userFiles.js';
	import { createFile } from '$lib/firebase/firestore.js';

	// ── Wizard Step ──────────────────────────────────
	let step = $state('setup'); // 'setup' | 'edit' | 'stylize' | 'animate'

	// ── Setup Config ─────────────────────────────────
	let assetName = $state('');
	let assetType = $state('character');
	let padding = $state(0);

	// ── Images flowing between steps ─────────────────
	let editedImage = $state(null);   // Latest image from edit step
	let stylizedImage = $state(null); // Latest image from stylize step
	let paddedImage = $state(null);   // After adding padding

	// ── Folder Picker ────────────────────────────────
	let showFolderPicker = $state(false);
	let pendingSaveImage = $state(null);
	let pendingSaveLabel = $state('');
	let saveStatus = $state(null); // 'saving' | 'saved' | 'error'
	let selectedFolderId = $state(null);
	let selectedFolderPath = $state('Root');
	let pickingForSetup = $state(false); // true = picking destination, false = picking to save now

	// ── Lightbox ─────────────────────────────────────
	let lightboxSrc = $state(null);

	// ── Presets ──────────────────────────────────────
	const ASSET_TYPES = [
		{ id: 'character',    label: '🧙 Character',    desc: 'Players, NPCs, enemies' },
		{ id: 'object',       label: '📦 Object',       desc: 'Items, furniture, props' },
		{ id: 'spell_effect', label: '✨ Spell Effect', desc: 'Magic, particles, VFX' },
	];

	const PADDING_OPTIONS = [0, 8, 16, 32, 64];

	// ── Derived ──────────────────────────────────────
	let stepNum = $derived(
		step === 'setup'   ? 0 :
		step === 'edit'    ? 1 :
		step === 'stylize' ? 2 :
		step === 'animate' ? 3 : 0
	);

	const STEPS = [
		{ num: 0, label: 'Setup',   color: 'gray'   },
		{ num: 1, label: 'Edit',    color: 'blue'   },
		{ num: 2, label: 'Stylize', color: 'amber'  },
		{ num: 3, label: 'Animate', color: 'green'  },
	];

	// ── Navigation ───────────────────────────────────
	function goToSetup()   { step = 'setup'; }
	function goToEdit()    { step = 'edit'; }
	function goToStylize() { step = 'stylize'; }
	function goToAnimate() {
		const img = paddedImage || stylizedImage || editedImage;
		if (img) {
			projectStore.update(p => ({ ...p, firstFrame: img }));
		}
		step = 'animate';
	}

	function startOver() {
		step = 'setup';
		editedImage = null;
		stylizedImage = null;
		paddedImage = null;
	}

	// ── Callbacks from child components ──────────────
	function handleEditChange(dataUrl) {
		editedImage = dataUrl;
	}

	async function handleGenerated(dataUrl) {
		stylizedImage = dataUrl;
		paddedImage = null;
		// Auto-apply padding if set
		if (dataUrl && padding > 0) {
			paddedImage = await addPadding(dataUrl, padding);
		}
	}

	// ── Padding (center asset on larger canvas) ──────
	function addPadding(dataUrl, pad) {
		return new Promise((resolve) => {
			const img = new Image();
			img.onload = () => {
				const canvas = document.createElement('canvas');
				canvas.width = img.width + pad * 2;
				canvas.height = img.height + pad * 2;
				const ctx = canvas.getContext('2d');
				ctx.imageSmoothingEnabled = false;
				ctx.drawImage(img, pad, pad);
				resolve(canvas.toDataURL('image/png'));
			};
			img.src = dataUrl;
		});
	}

	async function reapplyPadding() {
		if (!stylizedImage) return;
		if (padding > 0) {
			paddedImage = await addPadding(stylizedImage, padding);
		} else {
			paddedImage = null;
		}
	}

	// ── Save to Folder ───────────────────────────────

	/** Open picker just to choose a destination (Setup step) */
	function pickDestination() {
		pickingForSetup = true;
		pendingSaveImage = null;
		showFolderPicker = true;
	}

	/** Open picker and immediately save the given image after selection */
	function openSave(image, label) {
		if (selectedFolderId) {
			// Already have a destination – save directly
			doSave(image, label, selectedFolderId);
		} else {
			pickingForSetup = false;
			pendingSaveImage = image;
			pendingSaveLabel = label;
			showFolderPicker = true;
		}
	}

	async function handleFolderSelect(folderId, folderPath) {
		selectedFolderId = folderId;
		selectedFolderPath = folderPath || 'Root';
		showFolderPicker = false;

		// If we were just picking a destination (setup), we're done
		if (pickingForSetup) {
			pickingForSetup = false;
			return;
		}

		// Otherwise save the pending image immediately
		if (pendingSaveImage) {
			await doSave(pendingSaveImage, pendingSaveLabel, folderId);
			pendingSaveImage = null;
			pendingSaveLabel = '';
		}
	}

	async function doSave(image, label, folderId) {
		saveStatus = 'saving';
		try {
			const filename = `${(assetName || label || 'asset').slice(0, 40).replace(/[^a-zA-Z0-9_-]/g, '_')}_${Date.now()}.png`;

			const res = await fetch('/api/upload-file', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					imageData: image,
					filename,
					folder: 'root'
				})
			});
			if (!res.ok) throw new Error((await res.json()).error || 'Upload failed');
			const { url } = await res.json();

			const uid = userFiles.getUid();
			if (uid) {
				await createFile(uid, folderId, filename, url, 'image', {
					sourceType: 'wizard',
					assetType,
					assetName,
					padding
				});
			}
			saveStatus = 'saved';
			setTimeout(() => { saveStatus = null; }, 2000);
		} catch (e) {
			console.error('[AssetWizard] Save error:', e);
			saveStatus = 'error';
			alert('Save failed: ' + e.message);
			setTimeout(() => { saveStatus = null; }, 2000);
		}
	}
</script>

<div class="space-y-3 text-sm">
	<!-- ═══ HEADER ═══ -->
	<div class="flex items-center justify-between">
		<h3 class="text-sm font-bold text-gray-800">🪄 Asset Wizard</h3>
		{#if step !== 'setup'}
			<button class="text-[10px] text-gray-400 hover:text-red-500" onclick={startOver}>↩ Start Over</button>
		{/if}
	</div>

	<!-- ═══ PROGRESS BAR ═══ -->
	<div class="flex items-center gap-1 text-[10px]">
		{#each STEPS as s, i}
			{#if i > 0}<span class="text-gray-300">→</span>{/if}
			<button
				class="px-2 py-0.5 rounded-full transition-colors
					{stepNum === s.num
						? s.color === 'gray'   ? 'bg-gray-700 text-white font-medium'
						: s.color === 'blue'   ? 'bg-blue-500 text-white font-medium'
						: s.color === 'amber'  ? 'bg-amber-500 text-white font-medium'
						: 'bg-green-500 text-white font-medium'
					: stepNum > s.num
						? 'bg-green-100 text-green-700'
						: 'bg-gray-100 text-gray-400'}"
				onclick={() => {
					if (s.num === 0) goToSetup();
					else if (s.num === 1) goToEdit();
					else if (s.num === 2 && editedImage) goToStylize();
					else if (s.num === 3 && (stylizedImage || editedImage)) goToAnimate();
				}}
				disabled={s.num > 1 && !editedImage}
			>
				{s.num + 1}. {s.label}
			</button>
		{/each}
	</div>

	<!-- ═══ SAVE STATUS ═══ -->
	{#if saveStatus === 'saving'}
		<div class="text-[10px] text-blue-600 bg-blue-50 rounded px-2 py-1 text-center animate-pulse">💾 Saving...</div>
	{:else if saveStatus === 'saved'}
		<div class="text-[10px] text-green-600 bg-green-50 rounded px-2 py-1 text-center">✅ Saved!</div>
	{/if}

	<!-- ═══════════════════════════════════════════════ -->
	<!-- STEP 1: SETUP                                  -->
	<!-- ═══════════════════════════════════════════════ -->
	{#if step === 'setup'}
		<div class="space-y-3">
			<!-- Asset Name -->
			<div>
				<label for="asset-name" class="block text-xs font-medium text-gray-700 mb-1">Asset Name</label>
				<input
					id="asset-name"
					type="text"
					bind:value={assetName}
					placeholder="e.g. Fire Elemental, Health Potion..."
					class="w-full px-2 py-1.5 text-xs border rounded focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
				/>
			</div>

			<!-- Asset Type -->
			<div>
				<label class="block text-xs font-medium text-gray-700 mb-1">Asset Type</label>
				<div class="grid grid-cols-3 gap-1.5">
					{#each ASSET_TYPES as type}
						<button
							class="px-2 py-2 text-xs border-2 rounded-lg text-center transition-all
								{assetType === type.id
									? 'border-blue-500 bg-blue-50 shadow-sm'
									: 'border-gray-200 hover:border-gray-300'}"
							onclick={() => assetType = type.id}
						>
							<div class="font-medium">{type.label}</div>
							<div class="text-[10px] text-gray-400 mt-0.5">{type.desc}</div>
						</button>
					{/each}
				</div>
			</div>

			<!-- Padding -->
			<div>
				<label class="block text-xs font-medium text-gray-700 mb-1">
					Padding
					<span class="font-normal text-gray-400">— extra space around the asset for animation effects</span>
				</label>
				<div class="flex gap-1">
					{#each PADDING_OPTIONS as pad}
						<button
							class="flex-1 px-2 py-1.5 text-xs border-2 rounded transition-all
								{padding === pad
									? 'border-blue-500 bg-blue-50 font-medium'
									: 'border-gray-200 hover:border-gray-300'}"
							onclick={() => padding = pad}
						>
							{pad === 0 ? 'None' : `+${pad}px`}
						</button>
					{/each}
				</div>
				{#if padding > 0}
					<p class="text-[10px] text-gray-400 mt-1">
						Adds {padding}px of transparent space on each side, centering the asset on a larger canvas.
					</p>
				{/if}
			</div>

			<!-- Save Destination -->
			<div>
				<label class="block text-xs font-medium text-gray-700 mb-1">Save Destination</label>
				<button
					class="w-full flex items-center gap-2 px-3 py-2 text-xs border-2 rounded-lg text-left transition-all
						{selectedFolderId
							? 'border-green-400 bg-green-50'
							: 'border-gray-200 hover:border-blue-300 bg-white'}"
					onclick={pickDestination}
				>
					<span class="text-base">📁</span>
					<span class="flex-1 truncate {selectedFolderId ? 'text-green-700 font-medium' : 'text-gray-400'}">
						{selectedFolderId ? selectedFolderPath : 'Choose a folder to save assets...'}
					</span>
					<span class="text-gray-400 text-[10px]">{selectedFolderId ? 'Change' : 'Select'}</span>
				</button>
				{#if !selectedFolderId}
					<p class="text-[10px] text-amber-500 mt-1">⚠ Pick a folder before you start — you can also save later.</p>
				{/if}
			</div>

			<!-- Summary -->
			<div class="bg-gray-50 border rounded-lg p-2.5 text-[10px] text-gray-600 space-y-1">
				<p><strong>Name:</strong> {assetName || '(unnamed)'}</p>
				<p><strong>Type:</strong> {ASSET_TYPES.find(t => t.id === assetType)?.label}</p>
				{#if padding > 0}<p><strong>Padding:</strong> +{padding}px each side</p>{/if}
				<p><strong>Folder:</strong> {selectedFolderId ? selectedFolderPath : '(not selected)'}</p>
			</div>

			<!-- Next -->
			<button
				class="w-full px-3 py-2.5 bg-blue-500 text-white rounded-lg hover:bg-blue-600 font-medium text-sm disabled:bg-gray-400 disabled:cursor-not-allowed"
				onclick={goToEdit}
			>
				Continue to Edit →
			</button>
		</div>

	<!-- ═══════════════════════════════════════════════ -->
	<!-- STEP 2: EDIT                                   -->
	<!-- ═══════════════════════════════════════════════ -->
	{:else if step === 'edit'}
		<!-- Config Bar -->
		<div class="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2 text-[10px]">
			<div class="text-gray-500">
				<span class="font-medium text-gray-700">{assetName || 'Asset'}</span>
				{#if padding > 0}· +{padding}px padding{/if}
			</div>
			<button class="text-gray-400 hover:text-gray-600" onclick={goToSetup}>⚙️ Setup</button>
		</div>

		<!-- Embed EditPanel -->
		<EditPanel initialImage={editedImage} onChange={handleEditChange} />

		<!-- Wizard nav (shows when we have an image) -->
		{#if editedImage}
			<div class="border-t pt-3 space-y-2">
				{#if !selectedFolderId}
					<button
						class="w-full px-2 py-1.5 text-xs border-2 border-dashed border-gray-300 text-gray-500 rounded-lg hover:border-blue-400 hover:text-blue-600"
						onclick={pickDestination}
					>
						📁 Select a folder first...
					</button>
				{/if}
				<div class="flex gap-2">
					<button
						class="flex-1 px-2 py-1.5 text-xs rounded-lg font-medium
							{selectedFolderId
								? 'bg-green-500 text-white hover:bg-green-600'
								: 'bg-gray-200 text-gray-400 cursor-not-allowed'}"
						onclick={() => openSave(editedImage, 'edited')}
						disabled={!selectedFolderId}
					>
						💾 Save to {selectedFolderId ? selectedFolderPath : '...'}
					</button>
					<button
						class="flex-1 px-2 py-1.5 text-xs bg-amber-500 text-white rounded-lg hover:bg-amber-600 font-medium"
						onclick={goToStylize}
					>
						✨ Stylize →
					</button>
				</div>
			</div>
		{/if}

	<!-- ═══════════════════════════════════════════════ -->
	<!-- STEP 3: STYLIZE                                -->
	<!-- ═══════════════════════════════════════════════ -->
	{:else if step === 'stylize'}
		<!-- Config Bar -->
		<div class="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2 text-[10px]">
			<div class="flex items-center gap-2">
				{#if editedImage}
					<button class="flex-shrink-0" onclick={() => lightboxSrc = editedImage}>
						<img src={editedImage} alt="Source" class="w-8 h-8 rounded border object-contain bg-white" style="image-rendering: pixelated;" />
					</button>
				{/if}
				<div class="text-gray-500">
					<span class="font-medium text-gray-700">{assetName || 'Asset'}</span>
					{#if padding > 0}· +{padding}px padding{/if}
				</div>
			</div>
			<button class="text-gray-400 hover:text-gray-600" onclick={goToEdit}>← Edit</button>
		</div>

		<!-- Embed CharacterWizard (create step only) -->
		<CharacterWizard initialReferenceImage={editedImage} onGenerated={handleGenerated} />

		<!-- Post-stylize actions -->
		{#if stylizedImage}
			<div class="border-t pt-3 space-y-2">
				<!-- Result preview -->
				<div class="flex items-center gap-3 bg-gray-50 rounded-lg p-2.5">
					<button class="flex-shrink-0" onclick={() => lightboxSrc = paddedImage || stylizedImage}>
						<div class="w-16 h-16 rounded border-2 border-green-400 overflow-hidden" style="background: repeating-conic-gradient(#e5e7eb 0% 25%, #fff 0% 50%) 50%/8px 8px;">
							<img src={paddedImage || stylizedImage} alt="Result" class="w-full h-full object-contain" style="image-rendering: pixelated;" />
						</div>
					</button>
					<div class="text-[10px] text-gray-500 leading-relaxed">
						<p class="font-medium text-gray-700">✅ Stylized</p>
						{#if padding > 0}
							<p>+{padding}px padding applied</p>
						{/if}
					</div>
				</div>

				<!-- Action buttons -->
				{#if !selectedFolderId}
					<button
						class="w-full px-2 py-1.5 text-xs border-2 border-dashed border-gray-300 text-gray-500 rounded-lg hover:border-blue-400 hover:text-blue-600"
						onclick={pickDestination}
					>
						📁 Select a folder first...
					</button>
				{/if}
				<div class="flex gap-1.5">
					<button
						class="flex-1 px-2 py-1.5 text-xs rounded-lg font-medium
							{selectedFolderId
								? 'bg-green-500 text-white hover:bg-green-600'
								: 'bg-gray-200 text-gray-400 cursor-not-allowed'}"
						onclick={() => openSave(paddedImage || stylizedImage, 'stylized')}
						disabled={!selectedFolderId}
					>
						💾 {selectedFolderId ? `Save → ${selectedFolderPath}` : 'No folder'}
					</button>
					<button
						class="flex-1 px-2 py-1.5 text-xs bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200"
						onclick={goToEdit}
					>
						✏️ Edit More
					</button>
					<button
						class="flex-1 px-2 py-1.5 text-xs bg-green-500 text-white rounded-lg hover:bg-green-600 font-medium"
						onclick={goToAnimate}
					>
						🎬 Animate →
					</button>
				</div>
			</div>
		{/if}

	<!-- ═══════════════════════════════════════════════ -->
	<!-- STEP 4: ANIMATE                                -->
	<!-- ═══════════════════════════════════════════════ -->
	{:else if step === 'animate'}
		<!-- Config Bar -->
		<div class="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2 text-[10px]">
			<div class="flex items-center gap-2">
				{#if paddedImage || stylizedImage || editedImage}
					<img src={paddedImage || stylizedImage || editedImage} alt="Asset" class="w-8 h-8 rounded border object-contain bg-white" style="image-rendering: pixelated;" />
				{/if}
				<div class="text-gray-500">
					<span class="font-medium text-gray-700">{assetName || 'Asset'}</span> · Animate
				</div>
			</div>
			<div class="flex gap-2">
				<button class="text-gray-400 hover:text-gray-600" onclick={goToEdit}>← Edit</button>
				<button class="text-gray-400 hover:text-gray-600" onclick={goToStylize}>← Stylize</button>
			</div>
		</div>

		<!-- Embed GenerationPanel -->
		<GenerationPanel />
	{/if}
</div>

<!-- ═══ FOLDER PICKER MODAL ═══ -->
{#if showFolderPicker}
	<FolderPicker
		onSelect={handleFolderSelect}
		onClose={() => { showFolderPicker = false; pendingSaveImage = null; pickingForSetup = false; }}
	/>
{/if}

<!-- ═══ LIGHTBOX ═══ -->
{#if lightboxSrc}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="fixed inset-0 z-[999] bg-black/80 flex items-center justify-center cursor-zoom-out"
		onclick={() => lightboxSrc = null}
		onkeydown={(e) => { if (e.key === 'Escape') lightboxSrc = null; }}
	>
		<img
			src={lightboxSrc}
			alt="Full size preview"
			class="max-w-[90vw] max-h-[90vh] object-contain rounded shadow-2xl"
			style="image-rendering: pixelated;"
		/>
		<button
			class="absolute top-4 right-4 w-10 h-10 bg-white/20 hover:bg-white/40 text-white rounded-full text-xl flex items-center justify-center transition-colors"
			onclick={() => lightboxSrc = null}
		>✕</button>
	</div>
{/if}
