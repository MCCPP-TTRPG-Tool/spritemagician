<script>
	import { onMount } from 'svelte';

	let { minScale = 0.68 } = $props();

	let containerEl;
	let contentEl;
	let scale = $state(1);
	let resizeObserver;
	let mutationObserver;

	function recomputeScale() {
		if (!containerEl || !contentEl) return;
		const containerWidth = containerEl.clientWidth || 1;
		const containerHeight = containerEl.clientHeight || 1;
		const contentWidth = contentEl.scrollWidth || 1;
		const contentHeight = contentEl.scrollHeight || 1;

		const widthFit = containerWidth / contentWidth;
		const heightFit = containerHeight / contentHeight;
		const nextScale = Math.min(1, widthFit, heightFit);
		scale = Math.max(minScale, nextScale);
	}

	onMount(() => {
		resizeObserver = new ResizeObserver(() => {
			recomputeScale();
		});
		resizeObserver.observe(containerEl);
		resizeObserver.observe(contentEl);

		mutationObserver = new MutationObserver(() => {
			recomputeScale();
		});
		mutationObserver.observe(contentEl, { childList: true, subtree: true, attributes: true });

		requestAnimationFrame(recomputeScale);
		return () => {
			resizeObserver?.disconnect();
			mutationObserver?.disconnect();
		};
	});
</script>

<div class="h-full w-full overflow-hidden" bind:this={containerEl}>
	<div
		class="origin-top-left"
		bind:this={contentEl}
		style="transform: scale({scale}); width: {100 / scale}%;"
	>
		<slot />
	</div>
</div>
