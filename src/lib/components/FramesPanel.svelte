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
	<!-- Header -->
	<div class="flex items-center justify-between px-2 py-1.5 bg-gray-100 border-b rounded-t flex-shrink-0">
		<div class="flex items-center gap-2 font-medium text-gray-700">
			<span>🎞️</span>
			<span>Frames</span>
			<span class="px-1.5 py-0.5 bg-blue-200 text-blue-800 text-[10px] rounded-full">{project.frames.length}</span>
		</div>
		<div class="flex items-center gap-2">
			<span class="text-[10px] text-gray-500">{project.fps} FPS</span>
			{#if project.frames.length > 0}
				<button class="px-2 py-1 bg-green-100 text-green-700 rounded hover:bg-green-200 font-medium text-[10px]"
					onclick={saveAsAnimation}>💾 Save</button>
			{/if}
		</div>
	</div>

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
			<div class="grid grid-cols-5 gap-2">
				{#each project.frames as frame, index (index)}
					<div
						class="relative border rounded overflow-hidden cursor-move transition-all aspect-square
							{dragIdx === index ? 'opacity-50 scale-95' : ''}
							{overIdx === index ? 'border-blue-500 scale-105' : 'border-gray-300'}"
						draggable="true"
						ondragstart={() => onDragStart(index)}
						ondragover={(e) => onDragOver(e, index)}
						ondrop={(e) => onDrop(e, index)}
						ondragend={onDragEnd}
						role="listitem"
					>
						<img src={frame} alt="Frame {index + 1}" class="w-full h-full object-contain" />
						<div class="absolute top-1 left-1 bg-black/70 text-white text-[10px] px-1 py-0.5 rounded">{index + 1}</div>
						<button
							class="absolute top-1 right-1 bg-red-500 text-white rounded-full w-4 h-4 flex items-center justify-center text-[10px] hover:bg-red-600"
							onclick={() => removeFrame(index)}
						>×</button>
					</div>
				{/each}
			</div>
		{/if}
	</div>
</div>
