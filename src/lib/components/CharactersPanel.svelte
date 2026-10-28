<script>
	/**
	 * Characters — one reference image, a locked style, and a batch of actions.
	 * Every action is generated with the same seed and post-processed with
	 * the same settings, then filed under Characters/<name>/ in the library.
	 */
	import { onMount } from 'svelte';
	import { projectStore } from '$lib/stores/project.js';
	import { jobQueue } from '$lib/stores/jobQueue.js';
	import { createFile, notifyLibraryChanged } from '$lib/library/client.js';
	import { POSE_PRESETS, CHARACTER_ACTION_IDS, presetById } from '$lib/animation/presets.js';
	import { finalizeVideo, waitForJob, buildWanPrompt } from '$lib/animation/pipeline.js';
	import { prepareWanInput } from '$lib/animation/wanCanvas.js';
	import { clampImageLongEdge } from '$lib/utils/imagePrep.js';
	import { CHROMA_KEY_HEX } from '$lib/constants/chromaKey.js';

	let characters = $state([]);
	let selectedId = $state(null);
	let newName = $state('');
	let creating = $state(false);
	let error = $state('');
	let running = $state(false);
	let checked = $state(new Set(CHARACTER_ACTION_IDS));
	let project = $state({ firstFrame: null, fps: 12 });
	projectStore.subscribe((v) => (project = v));

	const selected = $derived(characters.find((c) => c.id === selectedId) || null);
	const actionPresets = POSE_PRESETS.filter((p) => p.id !== 'custom');

	async function api(action, payload = {}) {
		const res = await fetch('/api/characters', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ action, ...payload })
		});
		const data = await res.json().catch(() => ({}));
		if (!res.ok) throw new Error(data.error || `${action} failed`);
		return data;
	}

	async function load() {
		try {
			const res = await fetch('/api/characters');
			const data = await res.json();
			characters = data.characters || [];
			if (!selectedId && characters[0]) selectedId = characters[0].id;
		} catch (err) {
			error = err.message;
		}
	}

	function replaceCharacter(c) {
		characters = characters.map((x) => (x.id === c.id ? c : x));
	}

	async function createFromReference() {
		if (!project.firstFrame) {
			error = 'Load a reference sprite in Animate (or pick one from the File Tree) first.';
			return;
		}
		creating = true;
		error = '';
		try {
			const name = newName.trim() || `Character ${characters.length + 1}`;
			const { character } = await api('create', { character: { name, style: { fps: project.fps } } });
			// Store the reference image inside the character's folder.
			const up = await fetch('/api/upload-file', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ imageData: project.firstFrame, filename: 'reference.png', folder: character.folderId })
			});
			const uploaded = await up.json();
			if (!up.ok) throw new Error(uploaded.error || 'Reference upload failed');
			const fileId = await createFile('local', character.folderId, 'reference.png', uploaded.url, 'image', { source: 'character-reference' });
			const { character: updated } = await api('update', { id: character.id, character: { referenceUrl: uploaded.url, referenceFileId: fileId } });
			characters = [updated, ...characters];
			selectedId = updated.id;
			newName = '';
		} catch (err) {
			error = err.message;
		} finally {
			creating = false;
		}
	}

	async function updateStyle(patch) {
		if (!selected) return;
		const { character } = await api('update', { id: selected.id, character: { style: patch } });
		replaceCharacter(character);
	}

	async function rerollSeed() {
		if (!selected) return;
		const { character } = await api('update', { id: selected.id, character: { seed: Math.floor(Math.random() * 2147483647) } });
		replaceCharacter(character);
	}

	async function remove(c) {
		if (!confirm(`Delete character "${c.name}"? Files in its folder are kept.`)) return;
		await api('delete', { id: c.id });
		characters = characters.filter((x) => x.id !== c.id);
		if (selectedId === c.id) selectedId = characters[0]?.id || null;
	}

	function toggle(id) {
		const next = new Set(checked);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		checked = next;
	}

	async function setAction(actionId, patch) {
		const { character } = await api('setAction', { id: selected.id, actionId, patch });
		replaceCharacter(character);
	}

	function actionState(id) {
		return selected?.actions?.find((a) => a.id === id) || null;
	}

	/** Generate one action for the selected character with its locked settings. */
	async function generateAction(c, preset) {
		const style = c.style;
		const qid = jobQueue.addJob({ type: 'Animation', kind: 'animation', origin: 'character', name: `${c.name} · ${preset.name}`, status: 'processing', message: 'Preparing...' });
		await setAction(preset.id, { status: 'running', error: null });
		try {
			const source = await clampImageLongEdge(c.referenceUrl, 1024);
			const wanInput = await prepareWanInput(source, { chromaHex: CHROMA_KEY_HEX });
			const targetFrameCount = Math.max(8, Math.round(style.duration * style.fps));
			const perfect = style.loopMode === 'perfect';
			const res = await fetch('/api/generate-animation', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					referenceImage: wanInput.dataUrl,
					endImage: perfect ? wanInput.dataUrl : null,
					prompt: buildWanPrompt(preset.description, CHROMA_KEY_HEX),
					pose: preset.id,
					frameCount: targetFrameCount,
					duration: style.duration,
					fps: style.fps,
					loop: style.loopMode !== 'none',
					perfectLoop: perfect,
					model: perfect ? 'wan27' : 'wan22',
					seed: c.seed
				})
			});
			const data = await res.json();
			if (!res.ok) throw new Error(data.error || 'Generation failed');
			const { videoUrl } = await waitForJob(data.jobId, {
				onProgress: (pr) => jobQueue.updateJob(qid, { message: pr.message || 'Generating...', progress: pr.totalFrames ? Math.round((pr.currentFrame / pr.totalFrames) * 100) : 0 })
			});
			const frames = await finalizeVideo({
				videoUrl,
				targetFrameCount,
				crop: wanInput.crop,
				original: wanInput.original,
				loopMode: style.loopMode,
				removeBackground: style.removeBackground,
				pixelate: { enabled: style.pixelate, pixelSize: style.pixelSize, colorLevels: style.colorLevels },
				canvasPadding: style.canvasPadding,
				onProgress: (m) => jobQueue.updateJob(qid, { message: m })
			});
			const save = await fetch('/api/save-animation', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: preset.id, frames, fps: style.fps, prompt: preset.description })
			});
			const saved = await save.json();
			if (!save.ok) throw new Error(saved.error || 'Save failed');
			const fileId = await createFile('local', c.folderId, `${preset.id}.anim.json`, saved.url, 'animation', {
				thumbnailUrl: saved.thumbnailUrl, frameCount: frames.length, fps: style.fps, seed: c.seed, pose: preset.id
			});
			notifyLibraryChanged();
			await setAction(preset.id, { status: 'done', fileId, frameCount: frames.length, thumbnailUrl: saved.thumbnailUrl, error: null });
			jobQueue.completeJob(qid, { frameCount: frames.length });
		} catch (err) {
			await setAction(preset.id, { status: 'failed', error: err.message });
			jobQueue.failJob(qid, err.message);
		}
	}

	async function generateChecked() {
		if (!selected || running) return;
		if (!selected.referenceUrl) {
			error = 'This character has no reference image.';
			return;
		}
		running = true;
		error = '';
		const todo = actionPresets.filter((p) => checked.has(p.id));
		// Two at a time keeps the provider happy and the UI responsive.
		const queue = [...todo];
		const workers = Array.from({ length: Math.min(2, queue.length) }, async () => {
			while (queue.length) {
				const preset = queue.shift();
				await generateAction(selected, preset);
			}
		});
		await Promise.all(workers);
		running = false;
	}

	onMount(load);
</script>

<div class="h-full overflow-y-auto p-2 space-y-3 text-xs">
	{#if error}
		<div class="rounded border border-red-200 bg-red-50 px-2 py-1 text-red-700">{error}</div>
	{/if}

	<div class="rounded-lg border border-gray-200 bg-white p-2 space-y-2">
		<p class="font-semibold text-gray-800">New character</p>
		<div class="flex gap-2">
			<input type="text" bind:value={newName} placeholder="Name (e.g. Knight)" class="flex-1 px-2 py-1 border rounded" />
			<button class="px-2 py-1 rounded bg-amber-600 text-white hover:bg-amber-700 disabled:bg-gray-400" onclick={createFromReference} disabled={creating || !project.firstFrame}>
				{creating ? '…' : 'Create from reference'}
			</button>
		</div>
		<p class="text-[10px] text-gray-500">Uses the sprite currently loaded in Animate as the reference. Each character gets its own folder under Characters/.</p>
	</div>

	{#if characters.length > 0}
		<div class="flex gap-1 flex-wrap">
			{#each characters as c (c.id)}
				<button class="px-2 py-1 rounded border {selectedId === c.id ? 'bg-amber-100 border-amber-400 text-amber-900' : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'}" onclick={() => (selectedId = c.id)}>
					{c.name}
				</button>
			{/each}
		</div>
	{/if}

	{#if selected}
		<div class="rounded-lg border border-gray-200 bg-white p-2 space-y-2">
			<div class="flex items-start gap-3">
				{#if selected.referenceUrl}
					<img src={selected.referenceUrl} alt={selected.name} class="w-20 h-20 object-contain rounded border bg-gray-50" style="image-rendering: pixelated;" />
				{/if}
				<div class="flex-1 min-w-0">
					<p class="font-semibold text-gray-900 truncate">{selected.name}</p>
					<p class="text-[10px] text-gray-500">Seed {selected.seed} <button class="text-blue-600 underline ml-1" onclick={rerollSeed} disabled={running}>reroll</button></p>
					<p class="text-[10px] text-gray-500">{(selected.actions || []).filter((a) => a.status === 'done').length} actions done</p>
				</div>
				<button class="text-red-600 hover:underline text-[10px]" onclick={() => remove(selected)} disabled={running}>Delete</button>
			</div>

			<div class="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-gray-700">
				<label class="flex items-center justify-between gap-2">Loop
					<select class="border rounded px-1 py-0.5" value={selected.style.loopMode} onchange={(e) => updateStyle({ loopMode: e.currentTarget.value })}>
						<option value="perfect">Perfect (FLF)</option>
						<option value="pingpong">Ping-pong</option>
						<option value="none">None</option>
					</select>
				</label>
				<label class="flex items-center justify-between gap-2">FPS
					<select class="border rounded px-1 py-0.5" value={selected.style.fps} onchange={(e) => updateStyle({ fps: Number(e.currentTarget.value) })}>
						{#each [6, 8, 10, 12, 16] as f}<option value={f}>{f}</option>{/each}
					</select>
				</label>
				<label class="flex items-center justify-between gap-2">Seconds
					<input type="number" min="1" max="7" step="0.5" class="w-14 border rounded px-1 py-0.5" value={selected.style.duration} onchange={(e) => updateStyle({ duration: Number(e.currentTarget.value) })} />
				</label>
				<label class="flex items-center gap-1"><input type="checkbox" checked={selected.style.removeBackground} onchange={(e) => updateStyle({ removeBackground: e.currentTarget.checked })} /> Remove background</label>
				<label class="flex items-center gap-1"><input type="checkbox" checked={selected.style.pixelate} onchange={(e) => updateStyle({ pixelate: e.currentTarget.checked })} /> Pixel-art pass</label>
				{#if selected.style.pixelate}
					<label class="flex items-center justify-between gap-2">Pixel size
						<input type="number" min="1" max="16" class="w-14 border rounded px-1 py-0.5" value={selected.style.pixelSize} onchange={(e) => updateStyle({ pixelSize: Number(e.currentTarget.value) })} />
					</label>
					<label class="flex items-center justify-between gap-2">Colors
						<select class="border rounded px-1 py-0.5" value={selected.style.colorLevels} onchange={(e) => updateStyle({ colorLevels: Number(e.currentTarget.value) })}>
							{#each [4, 8, 16, 32, 64] as n}<option value={n}>{n}</option>{/each}
						</select>
					</label>
				{/if}
				<label class="flex items-center justify-between gap-2">Padding px
					<input type="number" min="0" max="256" class="w-14 border rounded px-1 py-0.5" value={selected.style.canvasPadding} onchange={(e) => updateStyle({ canvasPadding: Number(e.currentTarget.value) })} />
				</label>
			</div>
		</div>

		<div class="rounded-lg border border-gray-200 bg-white p-2 space-y-2">
			<div class="flex items-center justify-between">
				<p class="font-semibold text-gray-800">Actions</p>
				<button class="px-2 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:bg-gray-400" onclick={generateChecked} disabled={running || checked.size === 0}>
					{running ? '⏳ Generating…' : `🚀 Generate ${checked.size} selected`}
				</button>
			</div>
			<div class="space-y-1">
				{#each actionPresets as preset (preset.id)}
					{@const st = actionState(preset.id)}
					<div class="flex items-center gap-2 rounded px-1 py-0.5 hover:bg-gray-50">
						<input type="checkbox" checked={checked.has(preset.id)} onchange={() => toggle(preset.id)} disabled={running} />
						{#if st?.thumbnailUrl}
							<img src={st.thumbnailUrl} alt="" class="w-6 h-6 object-contain rounded border bg-gray-50" style="image-rendering: pixelated;" />
						{:else}
							<span class="w-6 h-6 inline-block"></span>
						{/if}
						<span class="flex-1 truncate" title={preset.description}>{preset.name}</span>
						{#if st?.status === 'done'}
							<span class="text-green-700 text-[10px]">✓ {st.frameCount} frames</span>
						{:else if st?.status === 'running'}
							<span class="text-blue-700 text-[10px]">running…</span>
						{:else if st?.status === 'failed'}
							<span class="text-red-700 text-[10px]" title={st.error}>failed</span>
						{/if}
					</div>
				{/each}
			</div>
			<p class="text-[10px] text-gray-500">Each action uses the same seed, canvas prep and post-processing, and lands in Characters/{selected.name}/ as an .anim.json you can open from the File Tree.</p>
		</div>
	{:else if characters.length === 0}
		<p class="text-gray-500">No characters yet. Load a sprite in Animate, then create one here to batch-generate idle, walk, run, attack, cast, hit and death.</p>
	{/if}
</div>
