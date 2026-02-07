<script>
	import { browser } from '$app/environment';

	// ── Wizard state ─────────────────────────────────
	let step = $state(1); // 1=upload, 2=sheet, 3=styled
	let characterName = $state('');
	let referenceImage = $state(null);
	let characterSheet = $state(null);
	let styledCharacter = $state(null);
	let isGenerating = $state(false);
	let error = $state(null);
	let fileInput;

	// ── Style Anchor state ───────────────────────────
	let showStylePanel = $state(false);
	let styleAnchor = $state(null);    // { name, source, publicUrl, ... }
	let styleLoading = $state(false);
	let styleError = $state(null);
	let styleFileInput = $state(null);
	let styleUploading = $state(false);

	// ── Load style anchor info on mount ──────────────
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

	// ── File handling ────────────────────────────────
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

	function triggerUpload() {
		fileInput?.click();
	}

	function clearReference() {
		referenceImage = null;
		characterSheet = null;
		styledCharacter = null;
		step = 1;
		if (fileInput) fileInput.value = '';
	}

	// ── Step 2: Generate character sheet ─────────────
	async function generateSheet() {
		if (!referenceImage) {
			error = 'Upload a reference image first';
			return;
		}
		isGenerating = true;
		error = null;

		try {
			const res = await fetch('/api/generate-character-sheet', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					referenceImage,
					characterName: characterName || 'Character'
				})
			});
			const data = await res.json();
			if (!res.ok) throw new Error(data.error || 'Sheet generation failed');
			characterSheet = data.sheet;
			step = 2;
		} catch (err) {
			error = err.message;
		} finally {
			isGenerating = false;
		}
	}

	// ── Step 3: Generate styled character ────────────
	async function generateStyled() {
		if (!referenceImage) {
			error = 'Reference image missing';
			return;
		}
		isGenerating = true;
		error = null;

		try {
			const res = await fetch('/api/generate-styled-character', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					referenceImage,
					characterSheet,
					characterName: characterName || 'Character'
				})
			});
			const data = await res.json();
			if (!res.ok) throw new Error(data.error || 'Style transfer failed');
			styledCharacter = data.image;
			step = 3;
		} catch (err) {
			error = err.message;
		} finally {
			isGenerating = false;
		}
	}

	// ── Gallery & Animation ──────────────────────────
	function saveToGallery() {
		if (!styledCharacter || !browser) return;
		window.dispatchEvent(new CustomEvent('autoSaveSprite', {
			detail: {
				image: styledCharacter,
				description: characterName || 'Styled Character',
				type: 'character',
				style: 'styled'
			}
		}));
	}

	function useForAnimation() {
		if (!styledCharacter || !browser) return;
		window.dispatchEvent(new CustomEvent('useForAnimation', {
			detail: { image: styledCharacter }
		}));
	}

	function startOver() {
		referenceImage = null;
		characterSheet = null;
		styledCharacter = null;
		characterName = '';
		step = 1;
		error = null;
		if (fileInput) fileInput.value = '';
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
			// Read file as data-URL
			const dataUrl = await new Promise((resolve, reject) => {
				const reader = new FileReader();
				reader.onload = (e) => resolve(e.target.result);
				reader.onerror = reject;
				reader.readAsDataURL(file);
			});

			// Upload to backend
			const res = await fetch('/api/style-anchor', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ imageData: dataUrl })
			});
			const data = await res.json();
			if (!res.ok) throw new Error(data.error || 'Style upload failed');

			// Refresh style info
			await loadStyleAnchor();
		} catch (err) {
			styleError = err.message;
		} finally {
			styleUploading = false;
			if (styleFileInput) styleFileInput.value = '';
		}
	}
</script>

<div class="space-y-4">
	<h3 class="text-sm font-bold text-gray-800 flex items-center gap-2">
		🧙 Character Wizard
	</h3>

	<!-- Progress Steps -->
	<div class="flex items-center gap-1 text-[10px]">
		<span class="px-2 py-0.5 rounded-full {step >= 1 ? 'bg-green-100 text-green-700 font-medium' : 'bg-gray-100 text-gray-400'}">1. Upload</span>
		<span class="text-gray-300">→</span>
		<span class="px-2 py-0.5 rounded-full {step >= 2 ? 'bg-green-100 text-green-700 font-medium' : 'bg-gray-100 text-gray-400'}">2. Sheet</span>
		<span class="text-gray-300">→</span>
		<span class="px-2 py-0.5 rounded-full {step >= 3 ? 'bg-green-100 text-green-700 font-medium' : 'bg-gray-100 text-gray-400'}">3. Style</span>
	</div>

	<!-- Error -->
	{#if error}
		<div class="bg-red-50 border border-red-200 text-red-700 text-xs p-2 rounded">
			{error}
		</div>
	{/if}

	<!-- Step 1: Upload Reference -->
	<div class="space-y-2">
		<label class="block text-xs font-medium text-gray-600">Character Name</label>
		<input
			type="text"
			bind:value={characterName}
			placeholder="e.g. Fire Wizard, Shadow Dragon..."
			class="w-full px-3 py-1.5 border rounded text-sm"
		/>

		<label class="block text-xs font-medium text-gray-600">Reference Image</label>
		<input
			type="file"
			accept="image/*"
			onchange={handleFileUpload}
			bind:this={fileInput}
			class="hidden"
		/>

		{#if referenceImage}
			<div class="relative inline-block">
				<img src={referenceImage} alt="Reference" class="w-32 h-32 object-contain rounded border bg-gray-100" />
				<button
					class="absolute -top-1 -right-1 bg-red-500 text-white w-5 h-5 rounded-full text-xs flex items-center justify-center"
					onclick={clearReference}
				>×</button>
			</div>
		{:else}
			<button
				class="w-full py-6 border-2 border-dashed border-gray-300 rounded-lg text-gray-400 hover:border-green-400 hover:text-green-600 transition-colors text-sm"
				onclick={triggerUpload}
			>
				📷 Upload reference image
			</button>
		{/if}
	</div>

	<!-- Action Buttons -->
	<div class="space-y-2">
		{#if !characterSheet}
			<!-- Generate Sheet -->
			<button
				class="w-full px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed text-sm font-medium flex items-center justify-center gap-2"
				onclick={generateSheet}
				disabled={!referenceImage || isGenerating}
			>
				{#if isGenerating && !characterSheet}
					<span class="animate-spin">⏳</span> Generating Sheet...
				{:else}
					📐 Generate Character Sheet
				{/if}
			</button>
		{/if}

		{#if characterSheet}
			<div class="space-y-2">
				<p class="text-xs font-medium text-gray-600">Character Sheet:</p>
				<img src={characterSheet} alt="Character Sheet" class="w-full rounded border bg-gray-100" />

				<button
					class="w-full px-4 py-2 bg-purple-500 text-white rounded-lg hover:bg-purple-600 disabled:bg-gray-300 disabled:cursor-not-allowed text-sm font-medium flex items-center justify-center gap-2"
					onclick={generateStyled}
					disabled={isGenerating}
				>
					{#if isGenerating && !styledCharacter}
						<span class="animate-spin">⏳</span> Styling Character...
					{:else}
						🎨 Generate Styled Character
					{/if}
				</button>
			</div>
		{/if}

		{#if styledCharacter}
			<div class="space-y-2">
				<p class="text-xs font-medium text-gray-600">Styled Character:</p>
				<img src={styledCharacter} alt="Styled Character" class="w-full rounded border bg-gray-100" />

				<div class="flex gap-2">
					<button
						class="flex-1 px-3 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 text-xs font-medium"
						onclick={saveToGallery}
					>💾 Save to Gallery</button>
					<button
						class="flex-1 px-3 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 text-xs font-medium"
						onclick={useForAnimation}
					>🎬 Use for Animation</button>
				</div>
			</div>
		{/if}

		{#if step > 1}
			<button
				class="w-full px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded"
				onclick={startOver}
			>↩ Start Over</button>
		{/if}
	</div>

	<!-- ── Style Anchor Panel ─────────────────────── -->
	<div class="border-t pt-3 mt-3">
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
					<p class="text-[10px] text-gray-400 text-center">Loading style info…</p>
				{:else if styleAnchor}
					<div class="text-[10px] text-gray-500 space-y-1">
						<p><strong>Name:</strong> {styleAnchor.name || '—'}</p>
						<p><strong>Source:</strong> {styleAnchor.source}</p>
						{#if styleAnchor.updatedAt}
							<p><strong>Updated:</strong> {new Date(styleAnchor.updatedAt).toLocaleDateString()}</p>
						{/if}
						{#if styleAnchor.publicUrl}
							<img
								src={styleAnchor.publicUrl}
								alt="Master Style"
								class="w-full max-h-32 object-contain rounded border bg-white"
							/>
						{/if}
					</div>
				{:else}
					<p class="text-[10px] text-amber-600">
						No master style configured. Using local fallback from <code>static/Example images/</code>.
					</p>
				{/if}

				{#if styleError}
					<div class="bg-red-50 border border-red-200 text-red-600 text-[10px] p-1.5 rounded">
						{styleError}
					</div>
				{/if}

				<input
					type="file"
					accept="image/png,image/jpeg,image/webp"
					onchange={handleStyleUpload}
					bind:this={styleFileInput}
					class="hidden"
				/>

				<button
					class="w-full px-3 py-1.5 bg-amber-500 text-white rounded text-xs font-medium hover:bg-amber-600 disabled:bg-gray-300 disabled:cursor-not-allowed flex items-center justify-center gap-1"
					onclick={triggerStyleUpload}
					disabled={styleUploading}
				>
					{#if styleUploading}
						<span class="animate-spin">⏳</span> Uploading…
					{:else}
						🔄 Swap Master Style
					{/if}
				</button>

				<p class="text-[9px] text-gray-400 leading-tight">
					The master style image is attached to every generation request as a latent-space anchor.
					Swapping it changes the visual target for all future generations.
				</p>
			</div>
		{/if}
	</div>
</div>
