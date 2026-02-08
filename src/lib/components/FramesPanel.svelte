<script>
	import { projectStore, reorderFrames, removeFrame } from '$lib/stores/project.js';
	import { animationStore } from '$lib/stores/animations.js';
	import { unsavedAnimations } from '$lib/stores/unsavedAnimations.js';

	let project = $state({ frames: [], fps: 12 });
	let unsaved = $state({ animations: [], activeIndex: 0 });

	projectStore.subscribe(v => { project = v; });
	unsavedAnimations.subscribe(v => { unsaved = v; });

	// ── drag state ──────────────────────────────────────────
	let dragIdx   = $state(null);
	let overIdx   = $state(null);

	function onDragStart(i) { dragIdx = i; }
	function onDragOver(e, i) { e.preventDefault(); overIdx = i; }
	function onDrop(e, i) {
		e.preventDefault();
		if (dragIdx !== null && dragIdx !== i) reorderFrames(dragIdx, i);
		dragIdx = null; overIdx = null;
	}
	function onDragEnd() { dragIdx = null; overIdx = null; }

	// ── unsaved animations ──────────────────────────────────
	function switchUnsaved(index) {
		unsavedAnimations.setActiveIndex(index);
		const a = unsaved.animations[index];
		if (a) projectStore.update(p => ({ ...p, frames: a.frames, prompt: a.pose }));
	}
	function discardUnsaved(id) {
		unsavedAnimations.removeAnimation(id);
		const remaining = unsaved.animations.filter(a => a.id !== id);
		if (remaining.length > 0) {
			const ni = Math.min(unsaved.activeIndex, remaining.length - 1);
			const a = remaining[ni];
			if (a) projectStore.update(p => ({ ...p, frames: a.frames, prompt: a.pose }));
		} else {
			projectStore.update(p => ({ ...p, frames: [] }));
		}
	}

	// ── save ────────────────────────────────────────────────
	function saveAsAnimation() {
		if (project.frames.length === 0) return alert('No frames to save.');
		const name = prompt('Name this animation:', `Animation ${Date.now() % 10000}`);
		if (name) {
			animationStore.addAnimation({
				name, frames: [...project.frames], fps: project.fps,
				prompt: project.prompt || '', frameCount: project.frames.length
			});
		}
	}
</script>

<div class="flex flex-col h-full text-xs">
	<!-- Unsaved animations tabs -->
	{#if unsaved.animations.length > 0}
		<div class="flex gap-1 px-2 py-1.5 bg-orange-50 border-b overflow-x-auto flex-shrink-0">
			{#each unsaved.animations as anim, i (anim.id)}
				<div class="flex items-center gap-1 flex-shrink-0">
					<button
						class="px-2 py-0.5 text-[10px] rounded {i === unsaved.activeIndex ? 'bg-orange-500 text-white font-bold' : 'bg-white border border-orange-200 text-orange-700 hover:border-orange-400'}"
						onclick={() => switchUnsaved(i)}
					>{anim.pose?.slice(0, 15) || `Anim ${i + 1}`} ({anim.frames?.length}f)</button>
					<button class="text-[10px] text-gray-400 hover:text-red-500"
						onclick={() => discardUnsaved(anim.id)}>✕</button>
				</div>
			{/each}
		</div>
	{/if}

	<!-- Frame grid -->
	<div class="flex-1 overflow-y-auto p-2">
		{#if project.frames.length === 0}
			<div class="flex flex-col items-center justify-center h-full text-gray-400 gap-2">
				<span class="text-4xl">🎞️</span>
				<p class="text-sm">No frames yet</p>
				<p class="text-[10px]">Generate an animation to see frames here</p>
			</div>
		{:else}
			<div class="grid grid-cols-4 gap-2">
				{#each project.frames as frame, index (index)}
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div
						class="relative group rounded-lg border-2 cursor-move transition-all aspect-square bg-gray-100
							{dragIdx === index ? 'opacity-50 scale-95 border-blue-400' : ''}
							{overIdx === index ? 'border-blue-500 scale-105' : project.currentFrame === index ? 'border-blue-500 ring-1 ring-blue-300' : 'border-transparent hover:border-gray-300'}"
						draggable="true"
						onclick={() => projectStore.update(p => ({ ...p, currentFrame: index }))}
						ondragstart={() => onDragStart(index)}
						ondragover={(e) => onDragOver(e, index)}
						ondrop={(e) => onDrop(e, index)}
						ondragend={onDragEnd}
						role="listitem"
					>
						<div class="aspect-square flex items-center justify-center overflow-hidden rounded-t-md">
							<img src={frame} alt="Frame {index + 1}" class="w-full h-full object-contain" />
						</div>
						
						<!-- Frame number badge -->
						<div class="absolute top-1 left-1 bg-black/70 text-white text-[10px] px-1.5 py-0.5 rounded font-bold">
							{index + 1}
						</div>

						<!-- Delete button -->
						<button
							class="absolute top-1 right-1 w-6 h-6 rounded-full bg-red-500/80 text-white text-xs flex items-center justify-center
								opacity-0 group-hover:opacity-100 hover:bg-red-600 transition-all z-10"
							onclick={(e) => { e.stopPropagation(); removeFrame(index); }}
							title="Remove frame"
						>×</button>

						<!-- Frame label -->
						<div class="px-1.5 py-1">
							<p class="text-[11px] truncate text-center font-medium">Frame {index + 1}</p>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</div>

	<!-- Status bar -->
	<div class="flex items-center justify-between px-2 py-1 bg-gray-50 border-t text-[10px] text-gray-500 flex-shrink-0">
		<span>{project.frames.length} frame{project.frames.length !== 1 ? 's' : ''} @ {project.fps} FPS</span>
		{#if project.frames.length > 0}
			<button class="px-2 py-1 bg-green-100 text-green-700 rounded hover:bg-green-200 font-medium text-[10px]"
				onclick={saveAsAnimation}>💾 Save Animation</button>
		{/if}
	</div>
</div>
