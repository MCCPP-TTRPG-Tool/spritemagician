<script>
	import { projectStore } from '$lib/stores/project.js';
	import { onMount } from 'svelte';

	let leftTab3D = $state('generate');
	let generationType = $state('image');
	let prompt = $state('');
	let referenceImageUrl = $state('');
	let rigProvider = $state('meshy');
	let modelUrl = $state('');
	let animationPreset = $state('idle');
	let status = $state('');
	let isGenerating = $state(false);
	let isRigging = $state(false);
	let isAnimating = $state(false);

	onMount(() => {
		if (typeof window === 'undefined') return;
		const onOpen3DLeftTab = (event) => {
			const tab = event?.detail?.tab;
			if (tab === 'generate' || tab === 'rigging' || tab === 'animation') {
				leftTab3D = tab;
			}
		};
		// Keep backward compatibility with earlier event naming.
		window.addEventListener('open3DLeftTab', onOpen3DLeftTab);
		window.addEventListener('open3DRightTab', onOpen3DLeftTab);
		return () => {
			window.removeEventListener('open3DLeftTab', onOpen3DLeftTab);
			window.removeEventListener('open3DRightTab', onOpen3DLeftTab);
		};
	});

	$effect(() => {
		if ($projectStore.threeDReferenceImage) {
			referenceImageUrl = $projectStore.threeDReferenceImage;
			status = 'Loaded reference image from File Tree.';
		}
	});

	$effect(() => {
		if ($projectStore.threeDModelUrl) {
			modelUrl = $projectStore.threeDModelUrl;
			status = 'Loaded model from File Tree.';
		}
	});

	function useModelForPreview() {
		const src = modelUrl.trim();
		if (!src) {
			status = 'Select a model file from File Tree first.';
			return;
		}
		projectStore.update((p) => ({ ...p, threeDModelUrl: src }));
		status = 'Model sent to preview panel.';
	}

	async function generateModel() {
		if (isGenerating) return;
		isGenerating = true;
		status = '';
		try {
			const res = await fetch('/api/3d/generate', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					inputType: generationType,
					prompt: prompt.trim(),
					referenceImageUrl: referenceImageUrl.trim()
				})
			});
			const data = await res.json();
			if (!res.ok) throw new Error(data.error || '3D generation request failed.');
			status = data.message || '3D generation job queued.';
		} catch (err) {
			status = err.message || '3D generation failed.';
		} finally {
			isGenerating = false;
		}
	}

	async function runRigging() {
		if (isRigging) return;
		isRigging = true;
		status = '';
		try {
			const res = await fetch('/api/3d/rig', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					provider: rigProvider,
					modelUrl: modelUrl.trim()
				})
			});
			const data = await res.json();
			if (!res.ok) throw new Error(data.error || 'Rigging request failed.');
			status = data.message || 'Rigging job queued.';
		} catch (err) {
			status = err.message || 'Rigging failed.';
		} finally {
			isRigging = false;
		}
	}

	async function runAnimation() {
		if (isAnimating) return;
		isAnimating = true;
		status = '';
		try {
			const res = await fetch('/api/3d/animate', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					provider: rigProvider,
					modelUrl: modelUrl.trim(),
					preset: animationPreset
				})
			});
			const data = await res.json();
			if (!res.ok) throw new Error(data.error || 'Animation request failed.');
			status = data.message || 'Animation job queued.';
		} catch (err) {
			status = err.message || 'Animation failed.';
		} finally {
			isAnimating = false;
		}
	}
</script>

<div class="h-full flex flex-col gap-3">
	<div class="border-b pb-2">
		<p class="text-sm font-semibold text-gray-800">3D Model Generation</p>
		<p class="text-xs text-gray-500">Provider: Hunyuan 3D 3.1 (Replicate)</p>
	</div>

	<div class="flex border rounded overflow-hidden">
		<button
			class="flex-1 px-2 py-2 text-xs font-medium transition-colors {leftTab3D === 'generate' ? 'bg-blue-50 text-blue-600 border-b-2 border-blue-600' : 'text-gray-600 hover:bg-gray-50'}"
			onclick={() => leftTab3D = 'generate'}
		>
			Generate
		</button>
		<button
			class="flex-1 px-2 py-2 text-xs font-medium transition-colors {leftTab3D === 'rigging' ? 'bg-purple-50 text-purple-600 border-b-2 border-purple-600' : 'text-gray-600 hover:bg-gray-50'}"
			onclick={() => leftTab3D = 'rigging'}
		>
			Rigging
		</button>
		<button
			class="flex-1 px-2 py-2 text-xs font-medium transition-colors {leftTab3D === 'animation' ? 'bg-emerald-50 text-emerald-600 border-b-2 border-emerald-600' : 'text-gray-600 hover:bg-gray-50'}"
			onclick={() => leftTab3D = 'animation'}
		>
			Animate
		</button>
	</div>

	<div class="space-y-2">
		<label class="text-xs text-gray-600">Model URL (from File Tree)</label>
		<input
			type="text"
			class="w-full border rounded px-2 py-1.5 text-xs"
			placeholder="Choose a model using File Tree > 3D Model"
			bind:value={modelUrl}
		/>
		<button
			class="px-3 py-1.5 text-xs rounded bg-sky-600 text-white disabled:bg-gray-400"
			onclick={useModelForPreview}
			disabled={!modelUrl.trim()}
		>
			Send To Preview
		</button>
	</div>

	{#if leftTab3D === 'generate'}
		<div class="space-y-2">
			<label class="text-xs text-gray-600">Input Type</label>
			<select class="w-full border rounded px-2 py-1.5 text-xs" bind:value={generationType}>
				<option value="image">Image to 3D</option>
				<option value="text">Text to 3D</option>
			</select>
		</div>
		<div class="space-y-2">
			<label class="text-xs text-gray-600">Prompt</label>
			<textarea
				class="w-full border rounded px-2 py-1.5 text-xs h-20"
				placeholder="Describe the 3D model you want..."
				bind:value={prompt}
			/>
		</div>
		<div class="space-y-2">
			<label class="text-xs text-gray-600">Reference Image URL (from File Tree)</label>
			<input
				type="text"
				class="w-full border rounded px-2 py-1.5 text-xs"
				placeholder="Choose an image using File Tree > 3D Generate"
				bind:value={referenceImageUrl}
			/>
		</div>
		<button
			class="px-3 py-2 text-xs rounded bg-blue-600 text-white disabled:bg-gray-400"
			onclick={generateModel}
			disabled={isGenerating}
		>
			{isGenerating ? 'Submitting...' : 'Generate 3D Model'}
		</button>
	{:else if leftTab3D === 'rigging'}
		<div class="space-y-2">
			<label class="text-xs text-gray-600">Rigging Provider</label>
			<select class="w-full border rounded px-2 py-1.5 text-xs" bind:value={rigProvider}>
				<option value="meshy">Meshy</option>
				<option value="unirig">UniRig (Replicate)</option>
			</select>
		</div>
		<button
			class="px-3 py-2 text-xs rounded bg-purple-600 text-white disabled:bg-gray-400"
			onclick={runRigging}
			disabled={isRigging}
		>
			{isRigging ? 'Submitting...' : 'Run Rigging'}
		</button>
	{:else if leftTab3D === 'animation'}
		<div class="space-y-2">
			<label class="text-xs text-gray-600">Animation Preset</label>
			<select class="w-full border rounded px-2 py-1.5 text-xs" bind:value={animationPreset}>
				<option value="idle">Idle</option>
				<option value="walk">Walk</option>
				<option value="run">Run</option>
			</select>
		</div>
		<button
			class="px-3 py-2 text-xs rounded bg-emerald-600 text-white disabled:bg-gray-400"
			onclick={runAnimation}
			disabled={isAnimating}
		>
			{isAnimating ? 'Submitting...' : 'Apply Animation'}
		</button>
	{/if}

	{#if status}
		<p class="text-xs text-gray-500">{status}</p>
	{/if}
</div>
