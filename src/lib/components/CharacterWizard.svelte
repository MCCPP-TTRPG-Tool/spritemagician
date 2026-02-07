<script>
	import { browser } from '$app/environment';
	import { projectStore } from '$lib/stores/project.js';
	import { jobQueue } from '$lib/stores/jobQueue.js';
	import { completedJobs } from '$lib/stores/completedJobs.js';

	// ── Wizard step ──────────────────────────────────
	let step = $state('create'); // 'create' | 'creating' | 'review' | 'pose-config' | 'pose-generating' | 'pose-review'

	// ── Step 1: Create state ─────────────────────────
	let referenceImage = $state(null);
	let description = $state('');
	let homm3Mode = $state(true); // default ON since it gives best results
	let generatedCharacter = $state(null);
	let isGenerating = $state(false);
	let error = $state(null);
	let fileInput = $state(null);
	let showPreview = $state(false);
	let previewImage = $state(null);
	let previewLabel = $state('');

	// ── Step 2: Pose state ───────────────────────────
	let posePrompt = $state('');
	let poseReference = $state(null);
	let poseReferencePreview = $state(null);
	let poseFileInput = $state(null);
	let generatedPose = $state(null);
	let savedPoses = $state([]);

	// ── Style Anchor state ───────────────────────────
	let showStylePanel = $state(false);
	let styleAnchor = $state(null);
	let styleLoading = $state(false);
	let styleError = $state(null);
	let styleFileInput = $state(null);
	let styleUploading = $state(false);

	// ── Load style anchor on mount ───────────────────
	$effect(() => {
		if (browser) loadStyleAnchor();
	});

	async function loadStyleAnchor() {
		styleLoading = true;
		try {
			const res = await fetch('/api/style-anchor');
			const data = await res.json();
			styleAnchor = data.styleAnchor;
		} catch (err) {
			console.warn('Could not load style anchor:', err);
		} finally {
			styleLoading = false;
		}
	}

	// ═══════════════════════════════════════════════════
	// STEP 1: CREATE CHARACTER
	// ═══════════════════════════════════════════════════

	function handleFileUpload(event) {
		const file = event.target.files?.[0];
		if (!file) return;
		const reader = new FileReader();
		reader.onload = (e) => {
			referenceImage = e.target.result;
			error = null;
		};
		reader.readAsDataURL(file);
	}

	function clearReference() {
		referenceImage = null;
		if (fileInput) fileInput.value = '';
	}

	function buildPrompt() {
		if (referenceImage) {
			const mod = description.trim();
			if (homm3Mode) {
				const base = `Recreate the character from the reference image in the exact visual style of Heroes of Might and Magic 3 (1999). Pre-rendered 3D model converted to 2D sprite with visible pixel texture. Soft dithered shading, rich shadows, 256-color palette aesthetic. Clean 1-pixel dark outline. 3/4 view angle. Solid grey background. IMPORTANT: Maintain the same level of detail and quality as the reference.`;
				return mod ? `${base} Additional instruction: ${mod}` : base;
			}
			const base = `Generate a sprite variation based on the reference image. Keep the same character style and quality. Clean game sprite, transparent background.`;
			return mod ? `${base} Modification: ${mod}` : base;
		}

		if (homm3Mode) {
			return `Create a sprite of ${description || 'a fantasy character'} in the exact visual style of Heroes of Might and Magic 3 (1999). Pre-rendered 3D model converted to 2D sprite with visible pixel texture. Soft dithered shading, rich shadows, 256-color palette aesthetic. Clean 1-pixel dark outline. 3/4 view angle. Solid grey background.`;
		}

		return `Create a 2D game sprite: ${description || 'a fantasy character'}. Clean lines, game asset quality, transparent background.`;
	}

	async function generateCharacter() {
		if (!description.trim() && !referenceImage) {
			error = 'Describe what you want or upload a reference image';
			return;
		}

		isGenerating = true;
		error = null;
		step = 'creating';

		const jobName = description.substring(0, 30) || 'Sprite';
		const jobId = jobQueue.addJob({
			type: '✨ Sprite',
			name: jobName,
			status: 'processing',
			message: 'Generating character...'
		});

		try {
			const prompt = buildPrompt();

			const response = await fetch('/api/generate-sprite', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					prompt,
					referenceImage: referenceImage || null
				})
			});

			const data = await response.json();
			if (!response.ok) throw new Error(data.error || data.details || 'Generation failed');

			generatedCharacter = data.image;

			// Auto-save
			await completedJobs.addSprite({
				name: jobName,
				image: data.image,
				description
			});
			projectStore.update(p => ({ ...p, firstFrame: data.image }));

			if (browser) {
				window.dispatchEvent(new CustomEvent('autoSaveSprite', {
					detail: { image: data.image, description, type: 'character', style: homm3Mode ? 'homm3' : 'custom' }
				}));
			}

			jobQueue.completeJob(jobId);
			step = 'review';
		} catch (err) {
			error = err.message;
			jobQueue.failJob(jobId, err.message);
			step = 'create';
		} finally {
			isGenerating = false;
		}
	}

	function approveCharacter() {
		// Move to Step 2: Pose generation
		step = 'pose-config';
		posePrompt = '';
		poseReference = null;
		poseReferencePreview = null;
		generatedPose = null;
		savedPoses = [];
		error = null;
	}

	function retryCharacter() {
		generatedCharacter = null;
		step = 'create';
	}

	// ═══════════════════════════════════════════════════
	// STEP 2: POSE GENERATION
	// ═══════════════════════════════════════════════════

	function handlePoseRefUpload(e) {
		const file = e.target.files?.[0];
		if (!file) return;
		const reader = new FileReader();
		reader.onload = () => {
			poseReference = reader.result;
			poseReferencePreview = reader.result;
		};
		reader.readAsDataURL(file);
	}

	function removePoseRef() {
		poseReference = null;
		poseReferencePreview = null;
		if (poseFileInput) poseFileInput.value = '';
	}

	async function generatePose() {
		if (!posePrompt.trim() && !poseReference) {
			error = 'Describe the pose or upload a pose reference image.';
			return;
		}

		isGenerating = true;
		error = null;
		step = 'pose-generating';

		const jobId = jobQueue.addJob({
			type: '🦴 Pose',
			name: `Pose — ${posePrompt.slice(0, 30) || 'Reference'}`,
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
					characterImage: generatedCharacter,
					poseReference: poseReference || null,
					prompt: posePrompt.trim() || undefined,
					characterName: description.slice(0, 30) || 'Character',
				}),
				signal: controller.signal,
			});

			clearTimeout(timeoutId);
			const data = await response.json();
			if (!response.ok) throw new Error(data.error || data.details || 'Pose generation failed');

			generatedPose = data.image;
			jobQueue.completeJob(jobId);
			step = 'pose-review';
		} catch (err) {
			error = err.name === 'AbortError' ? 'Generation timed out. Try again.' : err.message;
			jobQueue.failJob(jobId, error);
			step = 'pose-config';
		} finally {
			isGenerating = false;
		}
	}

	function approvePose() {
		savedPoses = [...savedPoses, { image: generatedPose, prompt: posePrompt }];

		if (browser) {
			window.dispatchEvent(new CustomEvent('autoSaveSprite', {
				detail: {
					image: generatedPose,
					description: `Pose — ${posePrompt || 'Custom'}`,
					type: 'pose',
					style: homm3Mode ? 'homm3' : 'custom'
				}
			}));
		}

		generatedPose = null;
		posePrompt = '';
		poseReference = null;
		poseReferencePreview = null;
		error = null;
		step = 'pose-config';
	}

	function rejectPose() {
		generatedPose = null;
		error = null;
		step = 'pose-config';
	}

	function backToReview() {
		step = 'review';
		error = null;
	}

	function startOver() {
		referenceImage = null;
		description = '';
		generatedCharacter = null;
		generatedPose = null;
		savedPoses = [];
		error = null;
		step = 'create';
		if (fileInput) fileInput.value = '';
	}

	function openPreview(src, label) {
		previewImage = src;
		previewLabel = label;
		showPreview = true;
	}

	function closePreview() {
		showPreview = false;
		previewImage = null;
		previewLabel = '';
	}

	// ── Style Swap ───────────────────────────────────
	function triggerStyleUpload() {
		styleFileInput?.click();
	}

	async function handleStyleUpload(event) {
		const file = event.target.files?.[0];
		if (!file) return;
		styleUploading = true;
		styleError = null;
		try {
			const dataUrl = await new Promise((resolve, reject) => {
				const reader = new FileReader();
				reader.onload = (e) => resolve(e.target.result);
				reader.onerror = reject;
				reader.readAsDataURL(file);
			});
			const res = await fetch('/api/style-anchor', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ imageData: dataUrl })
			});
			const data = await res.json();
			if (!res.ok) throw new Error(data.error || 'Style upload failed');
			await loadStyleAnchor();
		} catch (err) {
			styleError = err.message;
		} finally {
			styleUploading = false;
			if (styleFileInput) styleFileInput.value = '';
		}
	}

	// ── Derived ──────────────────────────────────────
	let currentStepNum = $derived(
		step === 'create' || step === 'creating' ? 1
		: step === 'review' ? 1
		: 2
	);
</script>

<div class="space-y-3 text-sm">

	<!-- Header + Progress -->
	<div class="flex items-center justify-between">
		<h3 class="text-sm font-bold text-gray-800">🧙 Character Wizard</h3>
		{#if generatedCharacter}
			<button class="text-[10px] text-gray-400 hover:text-red-500" onclick={startOver}>↩ Start Over</button>
		{/if}
	</div>

	<div class="flex items-center gap-1 text-[10px]">
		<span class="px-2 py-0.5 rounded-full {currentStepNum >= 1 ? 'bg-green-100 text-green-700 font-medium' : 'bg-gray-100 text-gray-400'}">
			1. Create
		</span>
		<span class="text-gray-300">→</span>
		<span class="px-2 py-0.5 rounded-full {currentStepNum >= 2 ? 'bg-purple-100 text-purple-700 font-medium' : 'bg-gray-100 text-gray-400'}">
			2. Poses
		</span>
	</div>

	<!-- Error -->
	{#if error}
		<div class="bg-red-50 border border-red-200 text-red-700 text-xs p-2 rounded">{error}</div>
	{/if}

	<!-- ═══════════════════════════════════════════════ -->
	<!-- STEP 1: CREATE CHARACTER                       -->
	<!-- ═══════════════════════════════════════════════ -->
	{#if step === 'create'}
		<!-- Hidden file input -->
		<input type="file" accept="image/*" class="hidden" bind:this={fileInput} onchange={handleFileUpload} />

		<!-- Reference Image -->
		<div class="border-2 border-dashed border-gray-300 rounded-lg p-2 bg-gray-50">
			{#if referenceImage}
				<div class="flex items-center gap-2">
					<button onclick={() => openPreview(referenceImage, 'Reference Image')}>
						<img src={referenceImage} alt="Reference" class="w-16 h-16 object-contain rounded border bg-white cursor-pointer" />
					</button>
					<div class="flex-1">
						<p class="text-xs font-medium text-green-700">📎 Reference uploaded</p>
						<p class="text-[10px] text-gray-500">Describe how to modify it below</p>
					</div>
					<button class="px-2 py-1 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200" onclick={clearReference}>✕</button>
				</div>
			{:else}
				<button
					class="w-full flex items-center justify-center gap-2 py-2 text-xs text-gray-600 hover:text-purple-600 hover:bg-purple-50 rounded transition-colors"
					onclick={() => fileInput?.click()}
				>
					<span class="text-lg">📤</span>
					<span>Upload reference image (optional)</span>
				</button>
				<p class="text-[10px] text-gray-400 text-center mt-1">Upload a character/sprite to generate variations</p>
			{/if}
		</div>

		<!-- HoMM3 Toggle -->
		<button
			class="w-full py-2 px-3 rounded-lg border-2 font-medium text-sm transition-all {homm3Mode
				? 'bg-amber-100 border-amber-400 text-amber-800'
				: 'bg-gray-50 border-gray-300 text-gray-600 hover:border-amber-300'}"
			onclick={() => homm3Mode = !homm3Mode}
		>
			{homm3Mode ? '⚔️ HoMM3 Style ACTIVE' : '⚔️ Enable HoMM3 Style'}
		</button>

		{#if homm3Mode}
			<div class="bg-amber-50 border border-amber-200 rounded p-2 text-[10px] text-amber-700">
				Prompt: "A high-fidelity pre-rendered 2D game sprite of <span class="font-bold">[your description]</span> in the style of Heroes of Might and Magic 3, soft painterly textures, rich shadows."
			</div>
		{/if}

		<!-- Description -->
		<div>
			<p class="text-xs text-gray-500 mb-1">{referenceImage ? 'Modification:' : 'Character Description:'}</p>
			<textarea
				bind:value={description}
				placeholder={homm3Mode
					? "e.g., 'a skeleton warrior', 'a fire elemental', 'a green dragon'..."
					: "Describe your sprite in detail..."}
				rows="3"
				class="w-full px-2 py-1.5 text-xs border rounded resize-none"
			></textarea>
		</div>

		<!-- Generate -->
		<button
			class="w-full px-3 py-2.5 bg-gradient-to-r from-purple-500 to-blue-500 text-white rounded-lg hover:from-purple-600 hover:to-blue-600 disabled:from-gray-400 disabled:to-gray-400 disabled:cursor-not-allowed font-medium"
			onclick={generateCharacter}
			disabled={isGenerating || (!description.trim() && !referenceImage)}
		>
			{#if referenceImage}
				✨ Generate Variation
			{:else}
				✨ Create Character
			{/if}
		</button>

	<!-- ═══════════════════════════════════════════════ -->
	<!-- CREATING (loading)                             -->
	<!-- ═══════════════════════════════════════════════ -->
	{:else if step === 'creating'}
		<div class="text-center py-8">
			<div class="text-5xl mb-4 animate-pulse">✨</div>
			<p class="text-lg font-bold text-gray-800">Creating Character</p>
			{#if referenceImage}
				<div class="mt-3 flex justify-center">
					<img src={referenceImage} alt="Reference" class="w-20 h-20 object-contain rounded border bg-gray-100" />
				</div>
			{/if}
			<div class="mt-4 flex items-center justify-center gap-2">
				<svg class="animate-spin h-5 w-5 text-purple-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
					<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
					<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
				</svg>
				<span class="text-sm text-purple-600">Generating with {homm3Mode ? 'HoMM3 style' : 'custom style'}...</span>
			</div>
		</div>

	<!-- ═══════════════════════════════════════════════ -->
	<!-- REVIEW CHARACTER                               -->
	<!-- ═══════════════════════════════════════════════ -->
	{:else if step === 'review'}
		<div class="text-center mb-2">
			<p class="text-xs font-medium text-gray-500">Step 1 Complete</p>
		</div>

		<!-- Generated character -->
		<div class="relative">
			<button class="w-full cursor-pointer" onclick={() => openPreview(generatedCharacter, 'Generated Character')}>
				<img
					src={generatedCharacter}
					alt="Generated character"
					class="w-full aspect-square object-contain rounded-lg border-2 border-green-400 bg-gray-100"
					style="image-rendering: pixelated;"
				/>
			</button>
			<span class="absolute top-2 left-2 bg-green-500 text-white text-[10px] px-2 py-0.5 rounded-full font-medium">✓ Generated</span>
		</div>

		<!-- Side by side if reference was used -->
		{#if referenceImage}
			<div class="grid grid-cols-2 gap-2 mt-2">
				<button class="text-left" onclick={() => openPreview(referenceImage, 'Reference')}>
					<img src={referenceImage} alt="Reference" class="w-full aspect-square object-contain rounded border bg-gray-100" />
					<p class="text-[10px] text-center text-gray-400 mt-1">Reference</p>
				</button>
				<button class="text-left" onclick={() => openPreview(generatedCharacter, 'Generated')}>
					<img src={generatedCharacter} alt="Generated" class="w-full aspect-square object-contain rounded border-2 border-green-400 bg-gray-100" />
					<p class="text-[10px] text-center text-green-600 font-medium mt-1">Generated</p>
				</button>
			</div>
		{/if}

		<div class="flex gap-2 mt-2">
			<button
				class="flex-1 px-3 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 text-xs font-medium"
				onclick={retryCharacter}
			>🔄 Retry</button>
			<button
				class="flex-1 px-3 py-2 bg-purple-500 text-white rounded-lg hover:bg-purple-600 text-xs font-medium"
				onclick={approveCharacter}
			>🦴 Generate Poses →</button>
		</div>

	<!-- ═══════════════════════════════════════════════ -->
	<!-- STEP 2: CONFIGURE POSE                        -->
	<!-- ═══════════════════════════════════════════════ -->
	{:else if step === 'pose-config'}
		<!-- Character bar -->
		<div class="flex items-center gap-2 border border-gray-200 rounded-lg p-2 bg-gray-50">
			<button class="flex-shrink-0" onclick={() => openPreview(generatedCharacter, 'Character')}>
				<img src={generatedCharacter} alt="Character" class="w-12 h-12 object-contain rounded border border-green-300 bg-white cursor-pointer" />
			</button>
			<div class="text-left text-[10px] text-gray-600 min-w-0 flex-1">
				<p class="font-medium text-gray-800 truncate">{description || 'Character'}</p>
				<p class="text-gray-400">IP-Adapter will lock this identity</p>
			</div>
			<button class="text-xs text-gray-400 hover:text-gray-600 px-2 py-1 rounded hover:bg-gray-200" onclick={backToReview}>← Back</button>
		</div>

		<!-- Saved poses so far -->
		{#if savedPoses.length > 0}
			<div>
				<p class="text-[10px] font-medium text-gray-500 mb-1">Saved poses ({savedPoses.length}):</p>
				<div class="flex gap-1.5 overflow-x-auto pb-1">
					{#each savedPoses as pose, i}
						<button class="flex-shrink-0" onclick={() => openPreview(pose.image, `Pose ${i + 1}: ${pose.prompt || 'Custom'}`)}>
							<img src={pose.image} alt="Pose {i + 1}" class="w-14 h-14 object-contain rounded border bg-gray-100 cursor-pointer hover:border-purple-400" />
						</button>
					{/each}
				</div>
			</div>
		{/if}

		<!-- Pose description -->
		<div class="border border-gray-200 rounded-lg p-3 bg-gray-50">
			<p class="text-xs font-semibold text-gray-700 mb-1">✏️ Describe the pose</p>
			<textarea
				bind:value={posePrompt}
				class="w-full px-3 py-2 border border-gray-300 rounded-lg text-xs focus:border-purple-500 focus:ring-1 focus:ring-purple-500 outline-none resize-none bg-white"
				rows="3"
				placeholder="e.g. attacking with sword raised overhead, 3/4 view facing right"
			></textarea>
		</div>

		<!-- Pose reference (optional) -->
		<div class="border border-gray-200 rounded-lg p-3 bg-gray-50">
			<p class="text-xs font-semibold text-gray-700 mb-1">📷 Pose reference <span class="font-normal text-gray-400">(optional)</span></p>
			<p class="text-[10px] text-gray-400 mb-2">Upload any image in the target pose. DWPose extracts the skeleton automatically.</p>

			{#if poseReferencePreview}
				<div class="relative inline-block">
					<button onclick={() => openPreview(poseReferencePreview, 'Pose Reference')}>
						<img src={poseReferencePreview} alt="Pose ref" class="w-28 h-28 object-contain rounded-lg border border-purple-300 bg-white cursor-pointer" />
					</button>
					<button
						class="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full text-xs flex items-center justify-center hover:bg-red-600 shadow"
						onclick={removePoseRef}
					>✕</button>
				</div>
			{:else}
				<button
					class="w-full py-3 border-2 border-dashed border-gray-300 rounded-lg text-gray-500 hover:border-purple-400 hover:text-purple-600 transition-colors text-xs"
					onclick={() => poseFileInput?.click()}
				>📤 Upload a pose reference</button>
				<input bind:this={poseFileInput} type="file" accept="image/*" class="hidden" onchange={handlePoseRefUpload} />
			{/if}
		</div>

		<button
			class="w-full px-4 py-2.5 bg-purple-500 text-white rounded-lg hover:bg-purple-600 font-medium text-xs disabled:bg-gray-400"
			onclick={generatePose}
			disabled={isGenerating}
		>🦴 Generate Pose</button>

	<!-- ═══════════════════════════════════════════════ -->
	<!-- POSE GENERATING (loading)                     -->
	<!-- ═══════════════════════════════════════════════ -->
	{:else if step === 'pose-generating'}
		<div class="text-center py-8">
			<div class="text-5xl mb-4 animate-pulse">🦴</div>
			<p class="text-lg font-bold text-gray-800">Generating Pose</p>
			<div class="mt-3 flex justify-center gap-2">
				<img src={generatedCharacter} alt="Character" class="w-20 h-20 object-contain rounded border border-green-300 bg-gray-100" />
				{#if poseReferencePreview}
					<img src={poseReferencePreview} alt="Pose ref" class="w-20 h-20 object-contain rounded border border-purple-300 bg-gray-100" />
				{/if}
			</div>
			<div class="mt-4 flex items-center justify-center gap-2">
				<svg class="animate-spin h-5 w-5 text-purple-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
					<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
					<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
				</svg>
				<span class="text-sm text-purple-600">
					{poseReference ? 'DWPose → ControlNet + IP-Adapter...' : 'IP-Adapter generating...'}
				</span>
			</div>
			<p class="text-[10px] text-gray-400 mt-3">First run may take 2-3 min (GPU cold start)</p>
		</div>

	<!-- ═══════════════════════════════════════════════ -->
	<!-- POSE REVIEW                                    -->
	<!-- ═══════════════════════════════════════════════ -->
	{:else if step === 'pose-review'}
		<div class="text-center mb-2">
			<p class="text-xs font-medium text-gray-500">Pose Generated</p>
		</div>

		<div class="grid grid-cols-2 gap-2">
			<button class="text-left" onclick={() => openPreview(generatedCharacter, 'Original Character')}>
				<img src={generatedCharacter} alt="Original" class="w-full aspect-square object-contain rounded border bg-gray-100" />
				<p class="text-[10px] text-center text-gray-400 mt-1">🎨 Original</p>
			</button>
			<button class="text-left" onclick={() => openPreview(generatedPose, 'Generated Pose')}>
				<img src={generatedPose} alt="Pose" class="w-full aspect-square object-contain rounded border-2 border-purple-400 bg-gray-100" />
				<p class="text-[10px] text-center font-medium text-purple-600 mt-1">🦴 New Pose</p>
			</button>
		</div>

		{#if posePrompt}
			<div class="bg-gray-50 border border-gray-200 rounded p-2">
				<p class="text-[10px] text-gray-500">Prompt: <span class="text-gray-700">{posePrompt}</span></p>
			</div>
		{/if}

		<div class="flex gap-2">
			<button
				class="flex-1 px-3 py-2 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 font-medium text-xs"
				onclick={rejectPose}
			>✕ Discard</button>
			<button
				class="px-3 py-2 bg-amber-100 text-amber-700 rounded-lg hover:bg-amber-200 font-medium text-xs"
				onclick={() => { rejectPose(); generatePose(); }}
			>🔄 Redo</button>
			<button
				class="flex-1 px-3 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 font-medium text-xs"
				onclick={approvePose}
			>✅ Save & Next</button>
		</div>
	{/if}

	<!-- ═══════════════════════════════════════════════ -->
	<!-- STYLE ANCHOR (always visible, collapsible)    -->
	<!-- ═══════════════════════════════════════════════ -->
	<div class="border-t pt-3 mt-2">
		<button
			class="w-full flex items-center justify-between text-xs font-medium text-gray-600 hover:text-gray-800"
			onclick={() => showStylePanel = !showStylePanel}
		>
			<span class="flex items-center gap-1">
				🎨 Style Anchor
				{#if styleAnchor}
					<span class="text-[10px] text-green-600 font-normal">({styleAnchor.source})</span>
				{/if}
			</span>
			<span>{showStylePanel ? '▲' : '▼'}</span>
		</button>

		{#if showStylePanel}
			<div class="mt-2 space-y-2 bg-gray-50 p-2 rounded border">
				{#if styleLoading}
					<p class="text-[10px] text-gray-400 text-center">Loading…</p>
				{:else if styleAnchor}
					<div class="text-[10px] text-gray-500 space-y-1">
						<p><strong>Source:</strong> {styleAnchor.source}</p>
						{#if styleAnchor.updatedAt}
							<p><strong>Updated:</strong> {new Date(styleAnchor.updatedAt).toLocaleDateString()}</p>
						{/if}
						{#if styleAnchor.publicUrl}
							<img src={styleAnchor.publicUrl} alt="Master Style" class="w-full max-h-28 object-contain rounded border bg-white" />
						{/if}
					</div>
				{:else}
					<p class="text-[10px] text-amber-600">Using local fallback from <code>static/Example images/</code>.</p>
				{/if}

				{#if styleError}
					<div class="bg-red-50 border border-red-200 text-red-600 text-[10px] p-1.5 rounded">{styleError}</div>
				{/if}

				<input type="file" accept="image/png,image/jpeg,image/webp" onchange={handleStyleUpload} bind:this={styleFileInput} class="hidden" />
				<button
					class="w-full px-3 py-1.5 bg-amber-500 text-white rounded text-xs font-medium hover:bg-amber-600 disabled:bg-gray-300 flex items-center justify-center gap-1"
					onclick={triggerStyleUpload}
					disabled={styleUploading}
				>
					{#if styleUploading}
						<span class="animate-spin">⏳</span> Uploading…
					{:else}
						🔄 Swap Master Style
					{/if}
				</button>
			</div>
		{/if}
	</div>
</div>

<!-- Full Image Preview Modal -->
{#if showPreview && previewImage}
	<div
		class="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-4"
		onclick={closePreview}
		onkeydown={(e) => { if (e.key === 'Escape') closePreview(); }}
		tabindex="0"
		role="dialog"
	>
		<div class="relative max-w-3xl max-h-[90vh]" onclick={(e) => e.stopPropagation()}>
			<button class="absolute -top-9 right-0 text-white hover:text-gray-300 text-2xl" onclick={closePreview}>✕</button>
			<img
				src={previewImage}
				alt={previewLabel}
				class="max-w-full max-h-[85vh] object-contain rounded-lg"
				style="image-rendering: pixelated;"
			/>
			{#if previewLabel}
				<p class="text-white text-sm font-medium text-center mt-2">{previewLabel}</p>
			{/if}
		</div>
	</div>
{/if}
