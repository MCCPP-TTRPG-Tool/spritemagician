<script>
	import { assetStore } from '$lib/stores/assets.js';
	import { jobQueue } from '$lib/stores/jobQueue.js';
	import { POSE_PRESETS, renderSkeleton, renderSkeletonPreview, cloneKeypoints, getPresetsByCategory } from '$lib/utils/posePresets.js';

	// ── State ─────────────────────────────────────────
	let step = $state('select'); // 'select' | 'configure' | 'generating' | 'approve'

	// Character selection
	let characters = $state([]);
	let selectedCharacter = $state(null); // { categoryId, name, styledImage, referenceImage }

	// Pose configuration
	let selectedPresetId = $state('idle');
	let customPrompt = $state('');
	let editableKeypoints = $state(null); // cloned from preset for future dragging

	// Generation
	let isGenerating = $state(false);
	let error = $state('');
	let generatedPose = $state(null);

	// Preview
	let fullPreviewImage = $state(null);
	let fullPreviewLabel = $state('');

	// ── Derived ───────────────────────────────────────
	const selectedPreset = $derived(POSE_PRESETS.find(p => p.id === selectedPresetId));
	const presetsByCategory = $derived(getPresetsByCategory());

	// Build skeleton preview when preset or keypoints change
	let skeletonPreview = $state(null);
	$effect(() => {
		if (selectedPreset && typeof document !== 'undefined') {
			const kps = editableKeypoints || selectedPreset.keypoints;
			skeletonPreview = renderSkeleton(kps, 512, 512);
		}
	});

	// ── Load characters from asset store ──────────────
	assetStore.subscribe(state => {
		const chars = [];
		// Find "Characters" root category
		const charRoot = state.categories.find(c => c.name === 'Characters' && !c.parentId);
		if (charRoot) {
			// Each child category is a character
			const charFolders = state.categories.filter(c => c.parentId === charRoot.id);
			for (const folder of charFolders) {
				const styledAsset = folder.assets.find(a => a.type === 'styled');
				const sourceAsset = folder.assets.find(a => a.type === 'source');
				const sheetAsset = folder.assets.find(a => a.type === 'sheet');
				if (styledAsset) {
					chars.push({
						categoryId: folder.id,
						name: folder.name,
						styledImage: styledAsset.imageData,
						referenceImage: sourceAsset?.imageData || null,
						sheetImage: sheetAsset?.imageData || null,
						poseCount: folder.assets.filter(a => a.type === 'pose').length,
					});
				}
			}
		}
		characters = chars;
	});

	// ── Step handlers ─────────────────────────────────

	function selectCharacter(char) {
		selectedCharacter = char;
		step = 'configure';
		selectedPresetId = 'idle';
		editableKeypoints = null;
		customPrompt = '';
		generatedPose = null;
		error = '';
	}

	function backToSelect() {
		step = 'select';
		selectedCharacter = null;
		generatedPose = null;
		error = '';
	}

	function selectPreset(presetId) {
		selectedPresetId = presetId;
		editableKeypoints = null; // Reset to default keypoints
		// Auto-fill prompt based on preset
		const preset = POSE_PRESETS.find(p => p.id === presetId);
		if (preset) {
			customPrompt = `${selectedCharacter?.name || 'Character'} in a ${preset.name.toLowerCase()} pose, ${preset.desc.toLowerCase()}`;
		}
	}

	// ── Generate ──────────────────────────────────────

	async function generatePose() {
		if (!selectedCharacter || !selectedPreset) return;

		isGenerating = true;
		error = '';
		step = 'generating';

		const kps = editableKeypoints || selectedPreset.keypoints;
		// Render the skeleton at 512x512 for the API
		const skeletonImage = renderSkeleton(kps, 512, 512);

		const jobId = jobQueue.addJob({
			type: '🦴 ControlNet Pose',
			name: `${selectedCharacter.name} — ${selectedPreset.name}`,
			status: 'processing',
			message: 'Generating pose with ControlNet...'
		});

		try {
			const controller = new AbortController();
			const timeoutId = setTimeout(() => controller.abort(), 5 * 60 * 1000); // 5 min

			const response = await fetch('/api/generate-controlnet-pose', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					characterImage: selectedCharacter.styledImage,  // IP-Adapter: identity lock
					skeletonImage,                                   // ControlNet: pose skeleton
					prompt: customPrompt || undefined,
					poseName: selectedPreset.name,
					characterName: selectedCharacter.name,
				}),
				signal: controller.signal,
			});

			clearTimeout(timeoutId);
			const data = await response.json();

			if (!response.ok) {
				throw new Error(data.error || data.details || 'Pose generation failed');
			}

			generatedPose = data.image;
			jobQueue.completeJob(jobId);
			step = 'approve';

		} catch (err) {
			error = err.name === 'AbortError' ? 'Generation timed out. Please try again.' : err.message;
			jobQueue.failJob(jobId, error);
			step = 'configure';
		} finally {
			isGenerating = false;
		}
	}

	// ── Approve / Reject ──────────────────────────────

	function approvePose() {
		if (!generatedPose || !selectedCharacter) return;

		// Save to the character's folder
		assetStore.addAsset(selectedCharacter.categoryId, {
			name: `Pose — ${selectedPreset?.name || 'Custom'}`,
			imageData: generatedPose,
			description: `ControlNet generated pose: ${selectedPreset?.name || 'Custom'}`,
			type: 'pose'
		});

		// Update the character's pose count locally
		selectedCharacter = {
			...selectedCharacter,
			poseCount: (selectedCharacter.poseCount || 0) + 1
		};

		// Stay on configure to generate more
		generatedPose = null;
		error = '';
		step = 'configure';
	}

	function rejectPose() {
		generatedPose = null;
		error = '';
		step = 'configure';
	}

	function regeneratePose() {
		generatePose();
	}

	// ── Preview ───────────────────────────────────────

	function openPreview(src, label) {
		fullPreviewImage = src;
		fullPreviewLabel = label;
	}

	function closePreview() {
		fullPreviewImage = null;
		fullPreviewLabel = '';
	}
</script>

<div class="space-y-3 text-sm">
	<!-- ═══════════════════════════════════════════════ -->
	<!-- STEP: Select Character                         -->
	<!-- ═══════════════════════════════════════════════ -->
	{#if step === 'select'}
		<div class="text-center mb-3">
			<p class="text-lg font-bold text-gray-800">🦴 Pose Generator</p>
			<p class="text-xs text-gray-500 mt-1">Select a character to generate ControlNet poses</p>
		</div>

		{#if characters.length === 0}
			<div class="text-center py-8 border-2 border-dashed border-gray-200 rounded-xl">
				<div class="text-4xl mb-3">🚫</div>
				<p class="text-sm font-medium text-gray-600">No styled characters found</p>
				<p class="text-xs text-gray-400 mt-1">
					Use the <strong>Create</strong> tab to create a character with a styled idle first.
				</p>
			</div>
		{:else}
			<div class="space-y-2">
				{#each characters as char}
					<button
						class="w-full flex items-center gap-3 p-3 border-2 border-gray-200 rounded-xl hover:border-purple-400 hover:bg-purple-50/50 transition-all text-left cursor-pointer group"
						onclick={() => selectCharacter(char)}
					>
						<!-- Styled idle thumbnail -->
						<div class="w-16 h-16 rounded-lg overflow-hidden border border-gray-300 bg-gray-100 flex-shrink-0">
							{#if char.styledImage && char.styledImage !== 'stored'}
								<img src={char.styledImage} alt={char.name} class="w-full h-full object-contain" />
							{:else}
								<div class="w-full h-full flex items-center justify-center text-2xl">🧙</div>
							{/if}
						</div>

						<div class="flex-1 min-w-0">
							<p class="font-semibold text-gray-800 group-hover:text-purple-700 truncate">{char.name}</p>
							<p class="text-[10px] text-gray-500">
								{char.poseCount} pose{char.poseCount !== 1 ? 's' : ''} generated
							</p>
						</div>

						<div class="text-gray-400 group-hover:text-purple-500 text-lg">→</div>
					</button>
				{/each}
			</div>
		{/if}

	<!-- ═══════════════════════════════════════════════ -->
	<!-- STEP: Configure Pose                           -->
	<!-- ═══════════════════════════════════════════════ -->
	{:else if step === 'configure'}
		<div class="text-center mb-2">
			<p class="text-lg font-bold text-gray-800">Configure Pose</p>
			<p class="text-xs text-gray-500 mt-1">{selectedCharacter?.name} — pick a pose and generate</p>
		</div>

		<!-- Character reference bar -->
		<div class="flex items-center gap-2 border border-gray-200 rounded-lg p-2 bg-gray-50">
			<button
				class="flex-shrink-0 cursor-pointer"
				onclick={() => openPreview(selectedCharacter?.styledImage, 'Styled Idle')}
			>
				{#if selectedCharacter?.styledImage && selectedCharacter.styledImage !== 'stored'}
					<img src={selectedCharacter.styledImage} alt="Styled" class="w-12 h-12 object-contain rounded border border-amber-300 bg-white" />
				{/if}
			</button>
			<div class="text-left text-[10px] text-gray-600 min-w-0 flex-1">
				<p class="font-medium text-gray-800 truncate">{selectedCharacter?.name}</p>
				<p>🎨 Styled Idle · {selectedCharacter?.poseCount || 0} poses</p>
			</div>
			<button
				class="text-xs text-gray-500 hover:text-gray-700 px-2 py-1 rounded hover:bg-gray-200"
				onclick={backToSelect}
			>← Change</button>
		</div>

		<!-- ── Pose Preset Grid ──────────────────────── -->
		<div class="border border-gray-200 rounded-lg p-3 bg-gray-50">
			<p class="text-xs font-semibold text-gray-700 mb-2">🦴 Pose Preset</p>

			{#each Object.entries(presetsByCategory) as [category, presets]}
				<p class="text-[10px] font-medium text-gray-500 uppercase tracking-wider mb-1.5 mt-2 first:mt-0">
					{category}
				</p>
				<div class="grid grid-cols-3 gap-1.5 mb-2">
					{#each presets as preset}
						<button
							class="py-1.5 px-1 rounded-lg text-center transition-all text-[10px] leading-tight cursor-pointer
								{selectedPresetId === preset.id
									? 'bg-purple-500 text-white border-2 border-purple-600 shadow-sm'
									: 'bg-white border border-gray-200 text-gray-600 hover:border-purple-300 hover:bg-purple-50'}"
							onclick={() => selectPreset(preset.id)}
						>
							<div class="text-base">{preset.icon}</div>
							<div class="font-medium">{preset.name}</div>
						</button>
					{/each}
				</div>
			{/each}
		</div>

		<!-- ── Skeleton Preview + Character Side-by-Side ── -->
		<div class="border border-gray-200 rounded-lg p-3 bg-gray-50">
			<p class="text-xs font-semibold text-gray-700 mb-2">👁️ Preview</p>
			<div class="grid grid-cols-2 gap-2">
				<!-- Styled idle reference -->
				<div class="text-center">
					<button
						class="w-full aspect-square rounded-lg overflow-hidden border border-amber-300 bg-gray-100 cursor-pointer hover:border-amber-500 transition-colors"
						onclick={() => openPreview(selectedCharacter?.styledImage, 'Styled Idle')}
					>
						{#if selectedCharacter?.styledImage && selectedCharacter.styledImage !== 'stored'}
							<img src={selectedCharacter.styledImage} alt="Styled" class="w-full h-full object-contain" />
						{/if}
					</button>
					<p class="text-[9px] text-gray-500 mt-1">🎨 Styled Idle</p>
				</div>

				<!-- Skeleton preview -->
				<div class="text-center">
					<button
						class="w-full aspect-square rounded-lg overflow-hidden border border-purple-300 bg-black cursor-pointer hover:border-purple-500 transition-colors"
						onclick={() => { if (skeletonPreview) openPreview(skeletonPreview, `Skeleton: ${selectedPreset?.name}`); }}
					>
						{#if skeletonPreview}
							<img src={skeletonPreview} alt="Skeleton" class="w-full h-full object-contain" />
						{/if}
					</button>
					<p class="text-[9px] text-gray-500 mt-1">🦴 {selectedPreset?.name} Skeleton</p>
				</div>
			</div>
			<p class="text-[9px] text-gray-400 mt-2 text-center">Skeleton guides ControlNet pose generation. Draggable joints coming soon.</p>
		</div>

		<!-- ── Prompt ─────────────────────────────────── -->
		<div class="border border-gray-200 rounded-lg p-3 bg-gray-50">
			<div class="flex items-center justify-between mb-1">
				<p class="text-xs font-semibold text-gray-700">✏️ Prompt</p>
				<button
					class="text-[10px] text-purple-600 hover:text-purple-800 underline"
					onclick={() => {
						if (selectedPreset && selectedCharacter) {
							customPrompt = `${selectedCharacter.name} in a ${selectedPreset.name.toLowerCase()} pose, ${selectedPreset.desc.toLowerCase()}`;
						}
					}}
				>Reset to default</button>
			</div>
			<textarea
				bind:value={customPrompt}
				class="w-full px-3 py-2 border border-gray-300 rounded-lg text-xs focus:border-purple-500 focus:ring-1 focus:ring-purple-500 outline-none resize-none bg-white"
				rows="3"
				placeholder="Describe the pose... (auto-filled from preset)"
			></textarea>
		</div>

		{#if error}
			<div class="bg-red-50 border border-red-200 rounded-lg p-2">
				<p class="text-xs text-red-600">{error}</p>
			</div>
		{/if}

		<!-- Action buttons -->
		<div class="flex gap-2">
			<button
				class="px-4 py-2.5 text-xs bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 cursor-pointer"
				onclick={backToSelect}
			>← Back</button>
			<button
				class="flex-1 px-4 py-2.5 bg-purple-500 text-white rounded-lg hover:bg-purple-600 font-medium text-xs disabled:bg-gray-400 cursor-pointer"
				onclick={generatePose}
				disabled={isGenerating || !selectedCharacter}
			>🦴 Generate Pose →</button>
		</div>

	<!-- ═══════════════════════════════════════════════ -->
	<!-- STEP: Generating                               -->
	<!-- ═══════════════════════════════════════════════ -->
	{:else if step === 'generating'}
		<div class="text-center py-8">
			<div class="text-5xl mb-4 animate-pulse">🦴</div>
			<p class="text-lg font-bold text-gray-800">Generating Pose</p>
			<p class="text-xs text-gray-500 mt-1">
				{selectedCharacter?.name} — {selectedPreset?.name}
			</p>

			<div class="mt-4 grid grid-cols-2 gap-2">
				<!-- Styled reference -->
				<div class="aspect-square rounded-lg overflow-hidden border border-amber-300 bg-gray-100">
					{#if selectedCharacter?.styledImage && selectedCharacter.styledImage !== 'stored'}
						<img src={selectedCharacter.styledImage} alt="Reference" class="w-full h-full object-contain" />
					{/if}
				</div>
				<!-- Skeleton -->
				<div class="aspect-square rounded-lg overflow-hidden border border-purple-300 bg-black">
					{#if skeletonPreview}
						<img src={skeletonPreview} alt="Target pose" class="w-full h-full object-contain" />
					{/if}
				</div>
			</div>

			<div class="mt-6 flex items-center justify-center gap-2">
				<svg class="animate-spin h-5 w-5 text-purple-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
					<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
					<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
				</svg>
				<span class="text-sm text-purple-600">ControlNet processing...</span>
			</div>

			{#if error}
				<div class="mt-4 bg-red-50 border border-red-200 rounded-lg p-3">
					<p class="text-xs text-red-600">{error}</p>
					<button
						class="mt-2 px-4 py-1.5 text-xs bg-red-500 text-white rounded hover:bg-red-600 cursor-pointer"
						onclick={() => { error = ''; step = 'configure'; }}
					>← Back to Configure</button>
				</div>
			{/if}
		</div>

	<!-- ═══════════════════════════════════════════════ -->
	<!-- STEP: Approve                                  -->
	<!-- ═══════════════════════════════════════════════ -->
	{:else if step === 'approve'}
		<div class="text-center mb-2">
			<p class="text-lg font-bold text-gray-800">Pose Generated</p>
			<p class="text-xs text-gray-500 mt-1">{selectedCharacter?.name} — {selectedPreset?.name}</p>
		</div>

		<!-- Side-by-side: styled idle vs generated pose -->
		<div class="grid grid-cols-2 gap-2 mb-3">
			<button
				class="border rounded-lg overflow-hidden cursor-pointer hover:border-amber-400 transition-colors text-left"
				onclick={() => openPreview(selectedCharacter?.styledImage, 'Styled Idle (Reference)')}
			>
				{#if selectedCharacter?.styledImage && selectedCharacter.styledImage !== 'stored'}
					<img src={selectedCharacter.styledImage} alt="Reference" class="w-full aspect-square object-contain bg-gray-100" />
				{/if}
				<p class="text-[10px] text-center py-1 text-gray-500">🎨 Styled Idle</p>
			</button>
			<button
				class="border-2 border-purple-400 rounded-lg overflow-hidden cursor-pointer hover:border-purple-600 transition-colors text-left"
				onclick={() => openPreview(generatedPose, `Pose: ${selectedPreset?.name}`)}
			>
				{#if generatedPose}
					<img src={generatedPose} alt="Generated pose" class="w-full aspect-square object-contain bg-gray-100" />
				{/if}
				<p class="text-[10px] text-center py-1 font-medium text-purple-600">🦴 {selectedPreset?.name}</p>
			</button>
		</div>

		<!-- Skeleton reference -->
		<div class="flex items-center gap-2 border border-gray-200 rounded-lg p-2 bg-gray-50 mb-3">
			{#if skeletonPreview}
				<img src={skeletonPreview} alt="Skeleton" class="w-10 h-10 rounded bg-black object-contain" />
			{/if}
			<p class="text-[10px] text-gray-500">Skeleton guide used for this pose</p>
		</div>

		<div class="flex gap-2">
			<button
				class="flex-1 px-3 py-2.5 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 font-medium text-xs cursor-pointer"
				onclick={rejectPose}
			>✕ Discard</button>
			<button
				class="px-3 py-2.5 bg-amber-100 text-amber-700 rounded-lg hover:bg-amber-200 font-medium text-xs cursor-pointer"
				onclick={regeneratePose}
			>🔄 Redo</button>
			<button
				class="flex-1 px-3 py-2.5 bg-green-500 text-white rounded-lg hover:bg-green-600 font-medium text-xs cursor-pointer"
				onclick={approvePose}
			>✅ Save Pose</button>
		</div>

		<p class="text-[9px] text-gray-400 text-center mt-1">
			Saved poses go into the character's folder and can be used for animation later.
		</p>
	{/if}
</div>

<!-- ═══════════════════════════════════════════════════ -->
<!-- Full Image Preview Popup                           -->
<!-- ═══════════════════════════════════════════════════ -->
{#if fullPreviewImage}
	<div
		class="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
		onclick={closePreview}
		onkeydown={(e) => { if (e.key === 'Escape') closePreview(); }}
		tabindex="0"
		role="dialog"
	>
		<div class="relative max-w-3xl max-h-[90vh]" onclick={(e) => e.stopPropagation()}>
			<button
				class="absolute -top-9 right-0 text-white hover:text-gray-300 text-2xl z-10 cursor-pointer"
				onclick={closePreview}
			>✕</button>
			<img
				src={fullPreviewImage}
				alt={fullPreviewLabel}
				class="max-w-full max-h-[85vh] object-contain bg-gray-900 rounded-lg border-2 border-gray-700"
			/>
			{#if fullPreviewLabel}
				<p class="text-white text-sm font-medium text-center mt-2">{fullPreviewLabel}</p>
			{/if}
		</div>
	</div>
{/if}
