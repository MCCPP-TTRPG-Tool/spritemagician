<script>
	let { onUpload, label = 'Upload Frame', accept = 'image/*', compact = false } = $props();
	
	let fileInput;
	let isDragging = $state(false);

	function handleFileSelect(event) {
		const file = event.target.files?.[0];
		if (file) {
			processFile(file);
		}
	}

	function handleDrop(event) {
		event.preventDefault();
		isDragging = false;
		const file = event.dataTransfer?.files?.[0];
		if (file && file.type.startsWith('image/')) {
			processFile(file);
		}
	}

	function handleDragOver(event) {
		event.preventDefault();
		isDragging = true;
	}

	function handleDragLeave() {
		isDragging = false;
	}

	async function processFile(file) {
		const reader = new FileReader();
		reader.onload = (e) => {
			onUpload(e.target.result);
		};
		reader.readAsDataURL(file);
	}
</script>

{#if compact}
	<div
		class="w-full h-full border-2 border-dashed rounded flex items-center justify-center transition-colors cursor-pointer {isDragging
			? 'border-purple-500 bg-purple-50'
			: 'border-gray-300 hover:border-purple-400 hover:bg-purple-50'}"
		ondrop={handleDrop}
		ondragover={handleDragOver}
		ondragleave={handleDragLeave}
		role="button"
		tabindex="0"
		onclick={() => fileInput?.click()}
		onkeydown={(e) => e.key === 'Enter' && fileInput?.click()}
	>
		<input
			bind:this={fileInput}
			type="file"
			accept={accept}
			class="hidden"
			onchange={handleFileSelect}
		/>
		<span class="text-2xl text-gray-400">+</span>
	</div>
{:else}
	<div
		class="border-2 border-dashed rounded-lg p-6 text-center transition-colors cursor-pointer h-40 flex flex-col items-center justify-center {isDragging
			? 'border-blue-500 bg-blue-50'
			: 'border-gray-300 hover:border-gray-400 hover:bg-gray-50'}"
		ondrop={handleDrop}
		ondragover={handleDragOver}
		ondragleave={handleDragLeave}
		role="button"
		tabindex="0"
		onclick={() => fileInput?.click()}
		onkeydown={(e) => e.key === 'Enter' && fileInput?.click()}
	>
		<input
			bind:this={fileInput}
			type="file"
			accept={accept}
			class="hidden"
			onchange={handleFileSelect}
		/>
		<svg
			class="mx-auto h-10 w-10 text-gray-400"
			fill="none"
			stroke="currentColor"
			viewBox="0 0 24 24"
		>
			<path
				stroke-linecap="round"
				stroke-linejoin="round"
				stroke-width="2"
				d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
			/>
		</svg>
		<p class="mt-2 text-sm text-gray-600">{label}</p>
	</div>
{/if}

