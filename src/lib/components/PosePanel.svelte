<script>
	import { assetStore } from '$lib/stores/assets.js';
	import { jobQueue } from '$lib/stores/jobQueue.js';

	// ── State ─────────────────────────────────────────
	let step = $state('select'); // 'select' | 'configure' | 'generating' | 'approve'

	// Character selection
	let characters = $state([]);
	let selectedCharacter = $state(null);

	// Pose configuration
	let posePrompt = $state('');
	let poseReference = $state(null); // base64 of uploaded reference image
	let poseReferencePreview = $state(null);
	let fileInput = $state();

	// Generation
	let isGenerating = $state(false);
	let error = $state('');
	let generatedPose = $state(null);

	// Preview
	let fullPreviewImage = $state(null);
	let fullPreviewLabel = $state('');

	// ── Load characters from asset store ──────────────
	assetStore.subscribe(state => {
		const chars = [];
		const charRoot = state.categories.find(c => c.name === 'Characters' && !c.parentId);
		if (charRoot) {
			const charFolders = state.categories.filter(c => c.parentId === charRoot.id);
			for (const folder of charFolders) {
				const styledAsset = folder.assets.find(a => a.type === 'styled');
				const sourceAsset = folder.assets.find(a => a.type === 'source');
				if (styledAsset) {
					chars.push({
						categoryId: folder.id,
						name: folder.name,
						styledImage: styledAsset.imageData,
						referenceImage: sourceAsset?.imageData || null,
						poseCount: folder.assets.filter(a => a.type === 'pose').length,
					});
				}
			}
		}
		characters = chars;
	});

	// ── Helpers ───────────────────────────────────────

	function selectCharacter(char) {
		selectedCharacter = char;
		step = 'configure';
		posePrompt = '';
		poseReference = null;
		poseReferencePreview = null;
		generatedPose = null;
		error = '';
	}

	function backToSelect() {
		step = 'select';
		selectedCharacter = null;
		generatedPose = null;
		error = '';
	}

	function handleReferenceUpload(e) {
		const file = e.target.files?.[0];
		if (!file) return;
		const reader = new FileReader();
		reader.onload = () => {
			poseReference = reader.result;
			poseReferencePreview = reader.result;
		};
		reader.readAsDataURL(file);
	}

	function removeReference() {
		poseReference = null;
		poseReferencePreview = null;
		if (fileInput) fileInput.value = '';
	}

	// ── Generate ──────────────────────────────────────

	async function generatePose() {
		if (!selectedCharacter) return;
		if (!posePrompt.trim() && !poseReference) {
			error = 'Describe the pose you want, or upload a reference image (or both).';
			return;
		}

		isGenerating = true;
		error = '';
		step = 'generating';

		const jobId = jobQueue.addJob({
			type: '🦴 Pose',
			name: `${selectedCharacter.name} — ${posePrompt.slice(0, 30) || 'Reference pose'}`,
			status: 'processing',
			message: 'Generating pose via ControlNet + IP-Adapter...'
		});

		try {
			const controller = new AbortController();
			const timeoutId = setTimeout(() => controller.abort(), 5 * 60 * 1000);

			const response = await fetch('/api/generate-controlnet-pose', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					characterImage: selectedCharacter.styledImage,
					poseReference: poseReference || null,
					prompt: posePrompt.trim() || undefined,
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
			error = err.name === 'AbortError' ? 'Generation timed out. Try again.' : err.message;
			jobQueue.failJob(jobId, error);
			step = 'configure';
		} finally {
			isGenerating = false;
		}
	}

	// ── Approve / Reject ─────────────────────────────

	function approvePose() {
		if (!generatedPose || !selectedCharacter) return;

		assetStore.addAsset(selectedCharacter.categoryId, {
			name: `Pose — ${posePrompt.slice(0, 40) || 'Custom'}`,
			imageData: generatedPose,
			description: posePrompt || 'ControlNet generated pose',
			type: 'pose'
		});

		selectedCharacter = {
			...selectedCharacter,
			poseCount: (selectedCharacter.poseCount || 0) + 1
		};

		generatedPose = null;
		error = '';
		step = 'configure';
	}

	function rejectPose() {
		generatedPose = null;
		error = '';
		step = 'configure';
	}

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
	<!-- SELECT CHARACTER                               -->
	<!-- ═══════════════════════════════════════════════ -->
	{#if step === 'select'}
		<div class="text-center mb-3">
			<p class="text-lg font-bold text-gray-800">🦴 Pose Generator</p>
			<p class="text-xs text-gray-500 mt-1">ControlNet + IP-Adapter — generate your character in any pose</p>
		</div>

		{#if characters.length === 0}
			<div class="text-center py-8 border-2 border-dashed border-gray-200 rounded-xl">
				<div class="text-4xl mb-3">🚫</div>
				<p class="text-sm font-medium text-gray-600">No styled characters yet</p>
				<p class="text-xs text-gray-400 mt-1">
					Use the <strong>Create</strong> tab first to make a styled character.
				</p>
			</div>
		{:else}
			<div class="space-y-2">
				{#each characters as char}
					<button
						class="w-full flex items-center gap-3 p-3 border-2 border-gray-200 rounded-xl hover:border-purple-400 hover:bg-purple-50/50 transition-all text-left cursor-pointer group"
						onclick={() => selectCharacter(char)}
					>
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
								{char.poseCount} pose{char.poseCount !== 1 ? 's' : ''} saved
							</p>
						</div>
						<div class="text-gray-400 group-hover:text-purple-500 text-lg">→</div>
					</button>
				{/each}
			</div>
		{/if}

	<!-- ═══════════════════════════════════════════════ -->
	<!-- CONFIGURE POSE                                 -->
	<!-- ═══════════════════════════════════════════════ -->
	{:else if step === 'configure'}

		<!-- Character bar -->
		<div class="flex items-center gap-2 border border-gray-200 rounded-lg p-2 bg-gray-50">
			<button
				class="flex-shrink-0 cursor-pointer"
				onclick={() => openPreview(selectedCharacter?.styledImage, 'Styled Character')}
			>
				{#if selectedCharacter?.styledImage && selectedCharacter.styledImage !== 'stored'}
					<img src={selectedCharacter.styledImage} alt="Styled" class="w-12 h-12 object-contain rounded border border-amber-300 bg-white" />
				{/if}
			</button>
			<div class="text-left text-[10px] text-gray-600 min-w-0 flex-1">
				<p class="font-medium text-gray-800 truncate">{selectedCharacter?.name}</p>
				<p>IP-Adapter will lock this character's identity</p>
			</div>
			<button
				class="text-xs text-gray-500 hover:text-gray-700 px-2 py-1 rounded hover:bg-gray-200 cursor-pointer"
				onclick={backToSelect}
			>← Back</button>
		</div>

		<!-- Pose description -->
		<div class="border border-gray-200 rounded-lg p-3 bg-gray-50">
			<p class="text-xs font-semibold text-gray-700 mb-1">✏️ Describe the pose</p>
			<p class="text-[10px] text-gray-400 mb-2">What should the character be doing?</p>
			<textarea
				bind:value={posePrompt}
				class="w-full px-3 py-2 border border-gray-300 rounded-lg text-xs focus:border-purple-500 focus:ring-1 focus:ring-purple-500 outline-none resize-none bg-white"
				rows="3"
				placeholder="e.g. attacking with sword raised overhead, 3/4 view facing right"
			></textarea>
		</div>

		<!-- Pose reference image (optional) -->
		<div class="border border-gray-200 rounded-lg p-3 bg-gray-50">
			<p class="text-xs font-semibold text-gray-700 mb-1">📷 Pose reference image <span class="font-normal text-gray-400">(optional)</span></p>
			<p class="text-[10px] text-gray-400 mb-2">
				Upload any image of a person/character in the pose you want. DWPose will extract the skeleton automatically.
			</p>

			{#if poseReferencePreview}
				<div class="relative inline-block">
					<button
						class="cursor-pointer"
						onclick={() => openPreview(poseReferencePreview, 'Pose Reference')}
					>
						<img src={poseReferencePreview} alt="Pose reference" class="w-32 h-32 object-contain rounded-lg border border-purple-300 bg-white" />
					</button>
					<button
						class="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full text-xs flex items-center justify-center hover:bg-red-600 cursor-pointer shadow"
						onclick={removeReference}
					>✕</button>
				</div>
			{:else}
				<button
					class="w-full py-4 border-2 border-dashed border-gray-300 rounded-lg text-gray-500 hover:border-purple-400 hover:text-purple-600 transition-colors cursor-pointer text-xs"
					onclick={() => fileInput?.click()}
				>
					📤 Click to upload a pose reference
				</button>
				<input
					bind:this={fileInput}
					type="file"
					accept="image/*"
					class="hidden"
					onchange={handleReferenceUpload}
				/>
			{/if}
		</div>

		<!-- How it works -->
		<div class="border border-gray-200 rounded-lg p-3 bg-blue-50/50">
			<p class="text-[10px] font-medium text-blue-700 mb-1">How it works:</p>
			<ul class="text-[10px] text-blue-600 space-y-0.5">
				<li><strong>IP-Adapter</strong> — locks your character's face, colors, and details</li>
				<li><strong>ControlNet</strong> — if you upload a reference, DWPose extracts the skeleton to control the pose</li>
				<li><strong>Text prompt</strong> — describes what the character should be doing</li>
			</ul>
		</div>

		{#if error}
			<div class="bg-red-50 border border-red-200 rounded-lg p-2">
				<p class="text-xs text-red-600">{error}</p>
			</div>
		{/if}

		<button
			class="w-full px-4 py-2.5 bg-purple-500 text-white rounded-lg hover:bg-purple-600 font-medium text-xs disabled:bg-gray-400 cursor-pointer"
			onclick={generatePose}
			disabled={isGenerating}
		>🦴 Generate Pose →</button>

	<!-- ═══════════════════════════════════════════════ -->
	<!-- GENERATING                                     -->
	<!-- ═══════════════════════════════════════════════ -->
	{:else if step === 'generating'}
		<div class="text-center py-8">
			<div class="text-5xl mb-4 animate-pulse">🦴</div>
			<p class="text-lg font-bold text-gray-800">Generating Pose</p>
			<p class="text-xs text-gray-500 mt-1">{selectedCharacter?.name}</p>

			<div class="mt-4 flex justify-center gap-2">
				{#if selectedCharacter?.styledImage && selectedCharacter.styledImage !== 'stored'}
					<div class="w-24 h-24 rounded-lg overflow-hidden border border-amber-300 bg-gray-100">
						<img src={selectedCharacter.styledImage} alt="Identity" class="w-full h-full object-contain" />
					</div>
				{/if}
				{#if poseReferencePreview}
					<div class="w-24 h-24 rounded-lg overflow-hidden border border-purple-300 bg-gray-100">
						<img src={poseReferencePreview} alt="Pose ref" class="w-full h-full object-contain" />
					</div>
				{/if}
			</div>

			<div class="mt-6 flex items-center justify-center gap-2">
				<svg class="animate-spin h-5 w-5 text-purple-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
					<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
					<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
				</svg>
				<span class="text-sm text-purple-600">
					{poseReference ? 'DWPose extracting skeleton → ControlNet + IP-Adapter...' : 'IP-Adapter generating...'}
				</span>
			</div>
			<p class="text-[10px] text-gray-400 mt-3">First run may take 2-3 min (GPU cold start)</p>
		</div>

	<!-- ═══════════════════════════════════════════════ -->
	<!-- APPROVE                                        -->
	<!-- ═══════════════════════════════════════════════ -->
	{:else if step === 'approve'}
		<div class="text-center mb-2">
			<p class="text-lg font-bold text-gray-800">Approve Pose</p>
			<p class="text-xs text-gray-500 mt-1">{selectedCharacter?.name}</p>
		</div>

		<div class="grid grid-cols-2 gap-2 mb-3">
			<!-- Reference: styled idle -->
			<button
				class="border rounded-lg overflow-hidden cursor-pointer hover:border-amber-400 transition-colors text-left"
				onclick={() => openPreview(selectedCharacter?.styledImage, 'Styled Character (Identity Source)')}
			>
				{#if selectedCharacter?.styledImage && selectedCharacter.styledImage !== 'stored'}
					<img src={selectedCharacter.styledImage} alt="Reference" class="w-full aspect-square object-contain bg-gray-100" />
				{/if}
				<p class="text-[10px] text-center py-1 text-gray-500">🎨 Identity Source</p>
			</button>

			<!-- Generated pose -->
			<button
				class="border-2 border-purple-400 rounded-lg overflow-hidden cursor-pointer hover:border-purple-600 transition-colors text-left"
				onclick={() => openPreview(generatedPose, 'Generated Pose')}
			>
				{#if generatedPose}
					<img src={generatedPose} alt="Generated pose" class="w-full aspect-square object-contain bg-gray-100" />
				{/if}
				<p class="text-[10px] text-center py-1 font-medium text-purple-600">🦴 Generated Pose</p>
			</button>
		</div>

		{#if posePrompt}
			<div class="bg-gray-50 border border-gray-200 rounded-lg p-2 mb-3">
				<p class="text-[10px] text-gray-500">Prompt: <span class="text-gray-700">{posePrompt}</span></p>
			</div>
		{/if}

		<div class="flex gap-2">
			<button
				class="flex-1 px-3 py-2.5 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 font-medium text-xs cursor-pointer"
				onclick={rejectPose}
			>✕ Discard</button>
			<button
				class="px-3 py-2.5 bg-amber-100 text-amber-700 rounded-lg hover:bg-amber-200 font-medium text-xs cursor-pointer"
				onclick={generatePose}
			>🔄 Redo</button>
			<button
				class="flex-1 px-3 py-2.5 bg-green-500 text-white rounded-lg hover:bg-green-600 font-medium text-xs cursor-pointer"
				onclick={approvePose}
			>✅ Save Pose</button>
		</div>
	{/if}
</div>

<!-- Full Image Preview -->
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
