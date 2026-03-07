<script>
	import { projectStore } from '$lib/stores/project.js';
	import { onMount } from 'svelte';

const RIG_MARKERS = [
	'pelvis',
	'spine',
	'neck',
	'head',
	'shoulder_L',
	'elbow_L',
	'wrist_L',
	'shoulder_R',
	'elbow_R',
	'wrist_R',
	'hip_L',
	'knee_L',
	'ankle_L',
	'hip_R',
	'knee_R',
	'ankle_R'
];

	let leftTab3D = $state('generate');
	let generationType = $state('image');
	let prompt = $state('');
	let referenceImageUrl = $state('');
	let modelUrl = $state('');
	let animationPreset = $state('idle');
	let status = $state('');
	let isGenerating = $state(false);
	let isRigging = $state(false);
	let isAnimating = $state(false);
	let uploadingModel = $state(false);
	let modelUploadInputEl = null;
	let rigJobId = $state('');
	let riggingProgress = $state(0);
let rigActiveMarker = $state('pelvis');
let rigMarkerSize = $state(1.4);

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
		const onRigSpecSaved = (event) => {
			const count = Number(event?.detail?.markerCount || 0);
			status = `RigSpec saved (${count}/16 markers).`;
		};
		window.addEventListener('threeDRigSpecSaved', onRigSpecSaved);
		return () => {
			stopGeneratePolling();
			window.removeEventListener('open3DLeftTab', onOpen3DLeftTab);
			window.removeEventListener('open3DRightTab', onOpen3DLeftTab);
			window.removeEventListener('threeDRigSpecSaved', onRigSpecSaved);
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

	$effect(() => {
		const ui = $projectStore.threeDRigUI || {};
		rigActiveMarker = typeof ui.activeMarker === 'string' ? ui.activeMarker : 'pelvis';
		rigMarkerSize = Number.isFinite(Number(ui.markerSizeMult)) ? Number(ui.markerSizeMult) : 1.4;
	});

	function useModelForPreview() {
		const src = modelUrl.trim();
		if (!src) {
			status = 'Select a model file from File Tree first.';
			return;
		}
		projectStore.update((p) => ({ ...p, threeDModelUrl: src }));
		requestRigViewportAction('load_model_url', { url: src });
		status = 'Model sent to preview panel.';
	}

	function stopGeneratePolling() {}

	function markerCoverageCount() {
		return Object.keys($projectStore?.threeDRigSpec?.markers || {}).length;
	}

	function updateRigUI(patch) {
		projectStore.update((p) => ({
			...p,
			threeDRigUI: {
				activeMarker: p?.threeDRigUI?.activeMarker || 'pelvis',
				markerSizeMult: Number.isFinite(Number(p?.threeDRigUI?.markerSizeMult))
					? Number(p.threeDRigUI.markerSizeMult)
					: 1.4,
				...patch
			}
		}));
	}

function requestRigViewportAction(type, extra = {}) {
		if (typeof window === 'undefined') return;
	window.dispatchEvent(new CustomEvent('threeDRigViewportAction', { detail: { type, ...extra } }));
	}

function markerIsSet(markerName) {
	return !!$projectStore?.threeDRigSpec?.markers?.[markerName];
}

function missingMarkers() {
	return RIG_MARKERS.filter((name) => !markerIsSet(name));
}

function focusNextMissingMarker() {
	const next = missingMarkers()[0] || 'pelvis';
	rigActiveMarker = next;
	updateRigUI({ activeMarker: next });
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
			status = data.message || '3D generation local-first mode is active.';
		} catch (err) {
			status = err.message || '3D generation failed.';
		} finally {
			isGenerating = false;
		}
	}

	function openModelUploadPicker() {
		modelUploadInputEl?.click();
	}

	async function readFileAsDataUrl(file) {
		return new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onerror = () => reject(new Error('Failed to read model file.'));
			reader.onload = () => resolve(String(reader.result || ''));
			reader.readAsDataURL(file);
		});
	}

	async function onModelPicked(event) {
		const file = event?.target?.files?.[0];
		event.target.value = '';
		if (!file) return;
		const safeName = String(file.name || '').toLowerCase();
	const extMatch = safeName.match(/\.(glb|gltf|fbx|obj)$/);
	if (!extMatch) {
			status = 'Supported model formats: .glb, .gltf, .fbx, .obj';
			return;
		}
	const formatHint = extMatch[1];
	const localUrl = URL.createObjectURL(file);
	modelUrl = localUrl;
	projectStore.update((p) => ({ ...p, threeDModelUrl: localUrl }));
	requestRigViewportAction('load_model_url', { url: localUrl, formatHint });
		uploadingModel = true;
	status = 'Loading local model and uploading...';
		try {
			const dataUrl = await readFileAsDataUrl(file);
			const uploadRes = await fetch('/api/upload-3d-model', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					modelData: dataUrl,
					filename: file.name,
					folder: '3d_models'
				})
			});
			const uploadData = await uploadRes.json().catch(() => ({}));
			if (!uploadRes.ok) {
				throw new Error(uploadData.error || 'Model upload failed.');
			}
			modelUrl = uploadData.url;
			projectStore.update((p) => ({ ...p, threeDModelUrl: uploadData.url }));
		requestRigViewportAction('load_model_url', { url: uploadData.url, formatHint });
		URL.revokeObjectURL(localUrl);
			status = 'Model uploaded and loaded. You can start placing rig markers.';
			if (typeof window !== 'undefined') {
				window.dispatchEvent(new CustomEvent('open3DRightTab', { detail: { tab: 'rigging' } }));
				window.dispatchEvent(new CustomEvent('open3DLeftTab', { detail: { tab: 'rigging' } }));
			}
		} catch (err) {
		status = `${err.message || 'Model upload failed.'} Local model is still loaded in viewport.`;
		} finally {
			uploadingModel = false;
		}
	}

	async function runRigging() {
		if (isRigging) return;
		isRigging = true;
		status = '';
		try {
			const rigSpec = $projectStore.threeDRigSpec;
			if (!rigSpec || typeof rigSpec !== 'object') {
				throw new Error('Place rig markers first and click Save RigSpec in the right 3D workspace.');
			}
			const markerCount = Object.keys(rigSpec?.markers || {}).length;
			if (markerCount < 8) {
				throw new Error(
					`RigSpec only has ${markerCount}/16 markers. Place more markers, then click Save RigSpec.`
				);
			}
			const resolvedModelUrl = String(modelUrl || $projectStore.threeDModelUrl || '').trim();
			if (!resolvedModelUrl) {
				throw new Error('Load a model into the viewport before submitting rigging.');
			}
			const res = await fetch('/api/3d/rig', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					modelUrl: resolvedModelUrl,
					rigSpec,
					modelPreflight: $projectStore.threeDModelPreflight || null
				})
			});
			const data = await res.json();
			if (!res.ok) throw new Error(data.error || 'Rigging request failed.');
			rigJobId = String(data.jobId || '').trim();
			riggingProgress = Number(data.progress || 0);
			status = data.message || 'Rigging job queued.';
		} catch (err) {
			status = err.message || 'Rigging failed.';
		} finally {
			isRigging = false;
		}
	}

	async function refreshRigStatus() {
		if (!rigJobId) {
			status = 'No rig job yet. Submit Run Rigging first.';
			return;
		}
		try {
			const res = await fetch(`/api/3d/rig-status?jobId=${encodeURIComponent(rigJobId)}`);
			const data = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(data.error || 'Failed to read rig status.');
			riggingProgress = Number(data.progress || 0);
			status = data.message || `Rig status: ${data.status}`;
		} catch (err) {
			status = err.message || 'Failed to read rig status.';
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
	<input
		class="hidden"
		type="file"
		accept=".glb,.gltf,.fbx,.obj"
		bind:this={modelUploadInputEl}
		onchange={onModelPicked}
	/>

	{#if leftTab3D === 'generate'}
		<div class="space-y-2">
			<p class="text-xs text-gray-600">Input Type</p>
			<select class="w-full border rounded px-2 py-1.5 text-xs" bind:value={generationType}>
				<option value="image">Image to 3D</option>
				<option value="text">Text to 3D</option>
			</select>
		</div>
		<div class="space-y-2">
			<p class="text-xs text-gray-600">Prompt</p>
			<textarea
				class="w-full border rounded px-2 py-1.5 text-xs h-20"
				placeholder="Describe the 3D model you want..."
				bind:value={prompt}
			></textarea>
		</div>
		<div class="space-y-2">
			<p class="text-xs text-gray-600">Reference Image URL (from File Tree)</p>
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
		<div class="space-y-2 border rounded p-2 bg-gray-50">
			<p class="text-xs font-medium text-gray-700">Rigging Controls</p>
			<p class="text-[11px] text-gray-500">
				Place all required joints in the viewport. Missing joints are listed below.
			</p>
			<div class="text-[11px] border rounded p-2 bg-white">
				<p class="font-medium text-gray-700">Rigged So Far: {markerCoverageCount()}/16</p>
				{#if missingMarkers().length === 0}
					<p class="text-emerald-600 mt-1">All required markers are set.</p>
				{:else}
					<p class="text-amber-700 mt-1">
						Missing: {missingMarkers().slice(0, 6).join(', ')}{missingMarkers().length > 6 ? '...' : ''}
					</p>
				{/if}
			</div>
			<div class="flex items-center gap-2">
				<p class="text-xs text-gray-600">Active Marker</p>
				<select
					class="flex-1 border rounded px-2 py-1.5 text-xs"
					bind:value={rigActiveMarker}
					onchange={() => updateRigUI({ activeMarker: rigActiveMarker })}
				>
					{#each RIG_MARKERS as marker}
						<option value={marker}>{marker}</option>
					{/each}
				</select>
			</div>
			<div class="flex items-center gap-2">
				<p class="text-xs text-gray-600 whitespace-nowrap">Marker Size</p>
				<input
					type="range"
					min="0.7"
					max="3"
					step="0.1"
					class="flex-1"
					bind:value={rigMarkerSize}
					oninput={() => updateRigUI({ markerSizeMult: Number(rigMarkerSize) })}
				/>
			</div>
			<div class="flex flex-wrap items-center gap-2">
				<button class="px-2 py-1.5 text-xs rounded bg-indigo-600 text-white" onclick={openModelUploadPicker} disabled={uploadingModel}>
					{uploadingModel ? 'Uploading...' : 'Upload Model'}
				</button>
				<button class="px-2 py-1.5 text-xs rounded bg-sky-600 text-white disabled:bg-gray-400" onclick={useModelForPreview} disabled={!modelUrl.trim()}>
					Load In Viewport
				</button>
				<button class="px-2 py-1.5 text-xs rounded bg-sky-600 text-white" onclick={() => requestRigViewportAction('open_model')}>
					Open Local
				</button>
				<button class="px-2 py-1.5 text-xs rounded bg-indigo-600 text-white" onclick={() => requestRigViewportAction('save_rigspec')}>
					Save RigSpec
				</button>
				<button class="px-2 py-1.5 text-xs rounded bg-gray-600 text-white" onclick={() => requestRigViewportAction('clear_markers')}>
					Clear
				</button>
				<span class="text-[11px] text-gray-500">Coverage: {markerCoverageCount()}/16</span>
			</div>
			<div class="flex flex-wrap items-center gap-2">
				<button class="px-2 py-1 text-[11px] rounded bg-amber-500 text-white" onclick={focusNextMissingMarker}>
					Focus Next Missing
				</button>
				<button class="px-2 py-1 text-[11px] rounded bg-cyan-600 text-white" onclick={() => requestRigViewportAction('view_front')}>
					Front View
				</button>
				<button class="px-2 py-1 text-[11px] rounded bg-cyan-700 text-white" onclick={() => requestRigViewportAction('view_side')}>
					Side View
				</button>
				<input
					type="text"
					class="flex-1 min-w-[10rem] border rounded px-2 py-1 text-[11px]"
					placeholder="Paste model URL from File Tree"
					bind:value={modelUrl}
				/>
			</div>
			<div class="grid grid-cols-2 gap-1 max-h-32 overflow-auto border rounded p-2 bg-white">
				{#each RIG_MARKERS as marker}
					<div class="flex items-center justify-between text-[11px]">
						<span class="truncate">{marker}</span>
						<span class={markerIsSet(marker) ? 'text-emerald-600' : 'text-gray-400'}>
							{markerIsSet(marker) ? 'set' : 'missing'}
						</span>
					</div>
				{/each}
			</div>
		</div>
		{#if $projectStore?.threeDModelPreflight}
			<div class="text-[11px] border rounded p-2 bg-white">
				<p class="font-medium text-gray-700 mb-1">Model Preflight</p>
				<p class={$projectStore.threeDModelPreflight.grounded ? 'text-emerald-600' : 'text-amber-600'}>
					{$projectStore.threeDModelPreflight.grounded ? 'Grounded' : 'Not Grounded'}
				</p>
				<p class={$projectStore.threeDModelPreflight.centeredXZ ? 'text-emerald-600' : 'text-amber-600'}>
					{$projectStore.threeDModelPreflight.centeredXZ ? 'Centered XZ' : 'Off-Center XZ'}
				</p>
				<p class={$projectStore.threeDModelPreflight.scaledReasonably ? 'text-emerald-600' : 'text-amber-600'}>
					{$projectStore.threeDModelPreflight.scaledReasonably ? 'Scale OK' : 'Scale Normalize Needed'}
				</p>
			</div>
		{/if}
		<button
			class="px-3 py-2 text-xs rounded bg-purple-600 text-white disabled:bg-gray-400"
			onclick={runRigging}
			disabled={isRigging}
		>
			{isRigging ? 'Submitting...' : 'Run Rigging'}
		</button>
		<div class="flex items-center gap-2">
			<button
				class="px-3 py-1.5 text-xs rounded bg-gray-700 text-white disabled:bg-gray-400"
				onclick={refreshRigStatus}
				disabled={!rigJobId}
			>
				Refresh Rig Status
			</button>
			{#if rigJobId}
				<span class="text-[11px] text-gray-500">Job: {rigJobId}</span>
			{/if}
		</div>
		<div class="w-full h-2 rounded bg-gray-200 overflow-hidden">
			<div class="h-full bg-purple-500" style={`width:${Math.max(0, Math.min(100, riggingProgress))}%`}></div>
		</div>
	{:else if leftTab3D === 'animation'}
		<div class="space-y-2">
			<p class="text-xs text-gray-600">Animation Preset</p>
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
