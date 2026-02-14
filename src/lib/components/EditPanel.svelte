<script>
	import { projectStore } from '$lib/stores/project.js';
	import { userFiles } from '$lib/stores/userFiles.js';
	import { createFile } from '$lib/firebase/firestore.js';
	import FolderPicker from './FolderPicker.svelte';

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
	
	// Save to folder
	let showFolderPicker = $state(false);
	let saveFolderId = $state(null);
	let saveFolderPath = $state(null);

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

	// Load image from parent (wizard or store) whenever the prop changes
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

	async function generate() {
		if (!sourceImage) {
			error = 'Upload an image first';
			return;
		}
		if (!editPrompt.trim()) {
			error = 'Describe what you want';
			return;
		}

		generating = true;
		error = null;
		resultImage = null;

		try {
			let imageToSend = sourceImage;
			let promptToSend = editPrompt;

			if (mode === 'expand') {
				try {
					imageToSend = await buildExpandedImage();
				} catch (expandError) {
					error = `Failed to build expanded image: ${expandError.message}. Make sure the image is from the same origin or has CORS enabled.`;
					generating = false;
					return;
				}
				promptToSend = `OUTPAINTING: The provided image has gray (#C0C0C0) border areas where the canvas was expanded. The original artwork is intact in its position. Generate new content ONLY in the gray areas to seamlessly extend the scene. Keep the original pixels untouched. Expansion direction: ${expandDirection}. What to generate in the new space: ${editPrompt}`;
			} else {
				// Use user's prompt directly - don't override with background instructions
				promptToSend = `Edit this image according to these instructions: ${editPrompt}. Keep everything not explicitly mentioned unchanged. Maintain the same art style, lighting, and quality.`;
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

			resultImage = data.image;
			onChange?.(data.image);
		} catch (e) {
			error = e.message;
		} finally {
			generating = false;
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

	async function performSave() {
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

			alert('Image saved successfully!');
		} catch (err) {
			console.error('Save error:', err);
			alert('Failed to save image: ' + err.message);
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

<div class="space-y-3">
	<h2 class="text-sm font-bold">Image Editor</h2>

	<!-- Mode Toggle -->
	<div class="flex gap-1 bg-gray-100 rounded-lg p-0.5">
		<button
			class="flex-1 px-2 py-1.5 text-xs font-medium rounded-md transition-colors {mode === 'edit' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-600 hover:text-gray-800'}"
			onclick={() => mode = 'edit'}
		>
			✏️ Edit
		</button>
		<button
			class="flex-1 px-2 py-1.5 text-xs font-medium rounded-md transition-colors {mode === 'expand' ? 'bg-white text-orange-600 shadow-sm' : 'text-gray-600 hover:text-gray-800'}"
			onclick={() => mode = 'expand'}
		>
			🔲 Expand
		</button>
	</div>

	<!-- Upload Area -->
	{#if !sourceImage}
		<label
			class="block border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors {isDragging ? 'border-blue-400 bg-blue-50' : 'border-gray-300 hover:border-gray-400'}"
			ondragover={(e) => { e.preventDefault(); isDragging = true; }}
			ondragleave={() => isDragging = false}
			ondrop={handleDrop}
		>
			<input type="file" accept="image/*" class="hidden" onchange={handleFileChange} />
			<div class="text-3xl mb-2">{isDragging ? '📥' : '🖼️'}</div>
			<p class="text-sm text-gray-600 font-medium">Drop an image or click to upload</p>
			<p class="text-xs text-gray-400 mt-1">PNG, JPG, WebP supported</p>
		</label>
	{:else}
		<!-- Source Image Preview -->
		<div class="relative">
			<button class="w-full bg-gray-300 rounded-lg p-1 cursor-zoom-in" onclick={() => lightboxSrc = sourceImage}>
				<div class="w-full bg-gray-300 rounded flex items-center justify-center">
					<img
						src={sourceImage}
						alt="Source"
						class="w-full max-h-48 object-contain rounded"
						style="image-rendering: pixelated; background-color: #808080;"
					/>
				</div>
			</button>
			<button
				onclick={clearImage}
				class="absolute top-2 right-2 w-6 h-6 bg-red-500 text-white rounded-full text-xs flex items-center justify-center hover:bg-red-600"
				title="Remove image"
			>✕</button>
			<p class="text-xs text-gray-500 mt-1 text-center">{imgWidth}×{imgHeight}px</p>
		</div>
	{/if}

	<!-- Expand Controls -->
	{#if mode === 'expand' && sourceImage}
		<div class="space-y-2 bg-orange-50 rounded-lg p-2.5">
			<div>
				<label for="expand-dir" class="block text-xs font-medium text-gray-700 mb-1">Direction</label>
				<select
					id="expand-dir"
					bind:value={expandDirection}
					class="w-full px-2 py-1 text-xs border rounded bg-white"
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
				<p class="text-xs text-orange-700">
					{imgWidth}×{imgHeight} → {expandedWidth}×{expandedHeight}px
				</p>
			{/if}
		</div>
	{/if}

	<!-- Prompt & Generate -->
	{#if sourceImage}
		<!-- Quick Actions -->
		<div class="space-y-2">
			{#if mode === 'edit'}
				<button
					onclick={() => { editPrompt = 'remove the background and objects, show the full character at 3/4 view facing to the right'; generate(); }}
					disabled={generating}
					class="w-full px-2 py-1.5 text-xs font-medium text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-lg hover:bg-indigo-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
				>
					🎭 Isolate Character (3/4 view, no background)
				</button>
				<button
					onclick={() => { 
						editPrompt = 'Cinematic game sprite, character in a staggered hit-reaction pose, body recoiling backwards from impact, torso arched slightly, head snapped back, eyes wide and gritted teeth, one arm raised defensively, feet planted but skidding slightly, subtle motion blur on limbs to indicate force, particles of impact sparks, maintain identical character features and clothing.';
						generate();
					}}
					disabled={generating}
					class="w-full px-2 py-1.5 text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
				>
					💥 Taking Damage (hit reaction pose)
				</button>
				<button
					onclick={() => { 
						mode = 'expand';
						expandDirection = 'all';
						expandAmount = 128;
						editPrompt = 'increase padding around character';
						generate();
					}}
					disabled={generating}
					class="w-full px-2 py-1.5 text-xs font-medium text-orange-700 bg-orange-50 border border-orange-200 rounded-lg hover:bg-orange-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
				>
					🔲 Expand Canvas (add padding around character)
				</button>
			{/if}
		</div>

		<div>
			<label for="edit-prompt" class="block text-xs font-medium text-gray-700 mb-1">
				{mode === 'edit' ? 'Edit Instructions' : 'What to generate in the expanded area'}
			</label>
			<textarea
				id="edit-prompt"
				bind:value={editPrompt}
				placeholder={mode === 'edit'
					? 'e.g. "Add a cape flowing behind the character"'
					: 'e.g. "Show the full body with legs and feet on a stone floor"'}
				class="w-full px-2 py-1.5 text-xs border rounded resize-none"
				rows="3"
			></textarea>
		</div>

		<button
			onclick={generate}
			disabled={generating || !editPrompt.trim()}
			class="w-full px-3 py-2 text-sm font-medium text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed {mode === 'edit' ? 'bg-blue-500 hover:bg-blue-600' : 'bg-orange-500 hover:bg-orange-600'}"
		>
			{#if generating}
				<span class="inline-flex items-center gap-1.5">
					<span class="animate-spin">⏳</span> Generating...
				</span>
			{:else}
				{mode === 'edit' ? '✏️ Apply Edit' : '🔲 Expand Image'}
			{/if}
		</button>
	{/if}

	<!-- Error -->
	{#if error}
		<p class="text-xs text-red-600 bg-red-50 rounded p-2">{error}</p>
	{/if}

	<!-- Result -->
	{#if resultImage}
		<div class="space-y-2">
			<p class="text-xs font-medium text-green-700">✅ Result</p>
			<button class="w-full bg-gray-300 rounded-lg p-1 cursor-zoom-in" onclick={() => lightboxSrc = resultImage}>
				<div class="w-full bg-gray-300 rounded flex items-center justify-center">
					<img
						src={resultImage}
						alt="Edited result"
						class="w-full max-h-64 object-contain rounded"
						style="image-rendering: pixelated; background-color: #808080;"
					/>
				</div>
			</button>

			<div class="space-y-2">
				<!-- Save to folder selector -->
				<div class="flex items-center gap-2 p-2 bg-gray-50 rounded-lg border border-gray-200">
					<span class="text-[10px] text-gray-500 font-medium whitespace-nowrap">Save to:</span>
					<button
						class="flex-1 text-left px-2 py-1 text-[11px] rounded border transition-colors truncate
							{saveFolderPath
								? 'bg-white border-blue-300 text-blue-700 hover:bg-blue-50 font-medium'
								: 'bg-white border-gray-300 text-gray-400 hover:bg-gray-100'}"
						onclick={() => showFolderPicker = true}
					>
						{saveFolderPath || '📁 Choose folder…'}
					</button>
					{#if saveFolderPath}
						<button
							class="text-[10px] text-gray-400 hover:text-red-500"
							onclick={() => { saveFolderId = null; saveFolderPath = null; }}
							title="Clear"
						>✕</button>
					{/if}
				</div>

				<!-- Action buttons -->
				<div class="grid grid-cols-2 gap-2">
					<button
						onclick={saveToFiles}
						disabled={!resultImage}
						class="px-2 py-1.5 text-xs bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
					>
						💾 Save to Files
					</button>
					<button
						onclick={moveToStyle}
						disabled={!resultImage}
						class="px-2 py-1.5 text-xs bg-purple-500 text-white rounded hover:bg-purple-600 disabled:opacity-50 disabled:cursor-not-allowed"
					>
						✨ Move to Style
					</button>
					<button
						onclick={downloadResult}
						class="px-2 py-1.5 text-xs bg-green-500 text-white rounded hover:bg-green-600"
					>
						📥 Download
					</button>
					<button
						onclick={useResultAsSource}
						class="px-2 py-1.5 text-xs bg-gray-500 text-white rounded hover:bg-gray-600"
					>
						🔄 Edit Again
					</button>
				</div>
			</div>
		</div>
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
