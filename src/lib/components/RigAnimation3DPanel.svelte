<script>
	import { onMount } from 'svelte';
	import { projectStore } from '$lib/stores/project.js';

	let viewerSrc = $state('');
	let viewerStatus = $state('');

	onMount(() => {
		if (typeof window === 'undefined') return;
		if (window.customElements?.get('model-viewer')) return;

		const existing = document.querySelector('script[data-model-viewer="true"]');
		if (existing) return;

		const script = document.createElement('script');
		script.type = 'module';
		script.src = 'https://unpkg.com/@google/model-viewer/dist/model-viewer.min.js';
		script.dataset.modelViewer = 'true';
		document.head.appendChild(script);
	});

	$effect(() => {
		if ($projectStore.threeDModelUrl) {
			viewerSrc = $projectStore.threeDModelUrl;
			viewerStatus = 'Preview loaded from File Tree selection.';
		}
	});
</script>

<div class="h-full flex flex-col gap-3 p-3">
	<div class="border-b pb-2">
		<p class="text-sm font-semibold text-gray-800">3D Preview</p>
		<p class="text-xs text-gray-500">Preview-only panel (controls are in left 3D workflow tabs)</p>
	</div>

	<div class="space-y-2">
		<p class="text-xs text-gray-600">3D Preview</p>
		<div class="w-full h-[28rem] border rounded bg-gray-100 overflow-hidden">
			{#if viewerSrc}
				<model-viewer
					src={viewerSrc}
					class="w-full h-full"
					camera-controls
					auto-rotate
					shadow-intensity="1"
					environment-image="neutral"
					exposure="1"
					tone-mapping="aces"
				/>
			{:else}
				<div class="w-full h-full flex items-center justify-center text-xs text-gray-400">
					Select a file in File Tree and choose 3D Model to preview
				</div>
			{/if}
		</div>
	</div>

	{#if viewerStatus}
		<p class="text-xs text-gray-500">{viewerStatus}</p>
	{/if}
</div>
