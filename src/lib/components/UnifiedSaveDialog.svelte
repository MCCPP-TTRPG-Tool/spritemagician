<script>
	import FolderPicker from './FolderPicker.svelte';

	let {
		isOpen = false,
		title = 'Save File',
		initialFileName = '',
		initialFolderId = null,
		initialFolderPath = '',
		startFolderId = null,
		startFolderName = 'Asset',
		isSaving = false,
		errorMessage = '',
		onClose = () => {},
		onSubmit = () => {}
	} = $props();

	let fileName = $state(initialFileName);
	let folderId = $state(initialFolderId);
	let folderPath = $state(initialFolderPath || '');
	let showFolderPicker = $state(false);

	$effect(() => {
		if (!isOpen) return;
		fileName = initialFileName || '';
		folderId = initialFolderId || null;
		folderPath = initialFolderPath || '';
		showFolderPicker = false;
	});

	function handleFolderSelect(nextFolderId, nextFolderPath) {
		folderId = nextFolderId || null;
		folderPath = nextFolderPath || '';
		showFolderPicker = false;
	}

	function submit() {
		onSubmit?.({
			fileName: fileName.trim(),
			folderId,
			folderPath
		});
	}
</script>

{#if isOpen}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
		onclick={onClose}
		onkeydown={(e) => { if (e.key === 'Escape') onClose?.(); }}
		tabindex="0"
		role="dialog"
		aria-modal="true"
	>
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="bg-white rounded-xl shadow-2xl w-full max-w-md" onclick={(e) => e.stopPropagation()}>
			<div class="flex items-center justify-between px-4 py-3 border-b">
				<h3 class="text-sm font-bold text-gray-800">💾 {title}</h3>
				<button class="text-gray-400 hover:text-gray-600 text-lg" onclick={onClose}>✕</button>
			</div>

			<div class="px-4 py-3 space-y-3">
				<div>
					<label class="block text-xs font-medium text-gray-700 mb-1.5">Filename</label>
					<input
						type="text"
						class="w-full px-2 py-1.5 text-xs border rounded focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
						bind:value={fileName}
						placeholder="image_result.png"
						onkeydown={(e) => { if (e.key === 'Enter') submit(); }}
					/>
				</div>

				<div>
					<label class="block text-xs font-medium text-gray-700 mb-1.5">Destination folder</label>
					{#if folderPath}
						<div class="flex items-center justify-between px-2 py-1.5 bg-blue-50 rounded border border-blue-200">
							<span class="text-xs font-medium text-blue-700 truncate">{folderPath}</span>
							<button
								class="ml-2 shrink-0 text-xs text-blue-600 hover:text-blue-800"
								onclick={() => showFolderPicker = true}
							>
								Change
							</button>
						</div>
					{:else}
						<button
							class="w-full px-2 py-1.5 text-xs bg-gray-100 hover:bg-gray-200 rounded border text-left text-gray-600"
							onclick={() => showFolderPicker = true}
						>
							📁 Choose folder...
						</button>
					{/if}
				</div>

				{#if errorMessage}
					<p class="text-[11px] text-red-600">{errorMessage}</p>
				{/if}
			</div>

			<div class="flex justify-end gap-2 px-4 py-3 border-t bg-gray-50 rounded-b-xl">
				<button
					class="px-4 py-1.5 text-xs text-gray-600 hover:bg-gray-200 rounded-lg"
					onclick={onClose}
					disabled={isSaving}
				>
					Cancel
				</button>
				<button
					class="px-4 py-1.5 text-xs bg-blue-500 text-white rounded-lg hover:bg-blue-600 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
					onclick={submit}
					disabled={isSaving}
				>
					{isSaving ? '⏳ Saving...' : '💾 Save'}
				</button>
			</div>
		</div>
	</div>
{/if}

{#if isOpen && showFolderPicker}
	<FolderPicker
		onSelect={handleFolderSelect}
		onClose={() => showFolderPicker = false}
		startFolderId={startFolderId}
		startFolderName={startFolderName}
	/>
{/if}

