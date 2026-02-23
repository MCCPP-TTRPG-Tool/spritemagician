<script>
	import { createFile } from '$lib/firebase/firestore.js';
	import { completedJobs } from '$lib/stores/completedJobs.js';
	import { jobQueue } from '$lib/stores/jobQueue.js';
	import { userFiles } from '$lib/stores/userFiles.js';
	import FolderPicker from './FolderPicker.svelte';

	let poseImage = $state(null);
	let referenceImage = $state(null);
	let depthImage = $state(null);
	let prompt = $state('');
	let negativePrompt = $state('');
	let workflowFile = $state('');
	let seed = $state(0);
	let width = $state(1024);
	let height = $state(1024);
	let generating = $state(false);
	let statusText = $state('');
	let error = $state('');
	let resultImage = $state(null);
	let runpodId = $state(null);
	let lastSeedUsed = $state(null);
	let lastWorkflowHash = $state('');

	let showFolderPicker = $state(false);
	let saveFolderId = $state(null);
	let saveFolderPath = $state('Root');

	function readAsDataUrl(file) {
		return new Promise((resolve, reject) => {
			const r = new FileReader();
			r.onload = () => resolve(r.result);
			r.onerror = () => reject(r.error);
			r.readAsDataURL(file);
		});
	}

	async function onImagePicked(event, target) {
		const file = event.target.files?.[0];
		if (!file) return;
		const dataUrl = await readAsDataUrl(file);
		if (target === 'pose') poseImage = dataUrl;
		if (target === 'reference') referenceImage = dataUrl;
		if (target === 'depth') depthImage = dataUrl;
	}

	function onFolderSelect(folderId, folderPath) {
		saveFolderId = folderId;
		saveFolderPath = folderPath || 'Root';
		showFolderPicker = false;
	}

	async function saveResultToFiles(imageData, sourceRunpodId) {
		const uid = userFiles.getUid();
		if (!uid || !imageData) return;

		const baseName = `keyframe_${Date.now()}`;
		const filename = `${baseName}.png`;
		const uploadRes = await fetch('/api/upload-file', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				imageData,
				filename,
				folder: saveFolderId
			})
		});
		if (!uploadRes.ok) {
			const data = await uploadRes.json().catch(() => ({}));
			throw new Error(data.error || 'Upload failed');
		}

		const { url } = await uploadRes.json();
		await createFile(uid, saveFolderId, filename, url, 'image', {
			sourceType: 'runpod-keyframe',
			prompt,
			runpodId: sourceRunpodId || null
		});

		userFiles.refreshCurrentFolder();
	}

	async function proxyImageToDataUrl(url) {
		const res = await fetch('/api/proxy-image', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ url })
		});
		const data = await res.json().catch(() => ({}));
		if (!res.ok) throw new Error(data.error || 'Failed to proxy generated image');
		return data.dataUrl;
	}

	async function pollUntilDone(localJobId) {
		for (let attempt = 0; attempt < 150; attempt++) {
			await new Promise((resolve) => setTimeout(resolve, 2000));
			const res = await fetch(`/api/generate-keyframe-status?runpodId=${encodeURIComponent(runpodId)}`);
			const data = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(data.error || 'Status check failed');

			if (data.status === 'processing' || data.status === 'pending') {
				statusText = `RunPod: ${data.runpodStatus || 'IN_PROGRESS'}`;
				jobQueue.updateJob(localJobId, {
					status: 'processing',
					message: statusText
				});
				continue;
			}

			if (data.status === 'failed') {
				throw new Error(data.error || 'RunPod job failed');
			}

			if (data.status === 'completed') {
				const dataUrl = data.imageDataUrl
					? data.imageDataUrl
					: data.imageUrl
						? await proxyImageToDataUrl(data.imageUrl)
						: null;
				if (!dataUrl) {
					throw new Error('RunPod completed but no image data was returned');
				}
				resultImage = dataUrl;
				await saveResultToFiles(dataUrl, runpodId);

				await completedJobs.addSprite({
					name: 'RunPod Keyframe',
					image: dataUrl,
					description: prompt
				});
				jobQueue.completeJob(localJobId, { image: dataUrl });
				statusText = 'Completed and saved to file tree';
				return;
			}
		}

		throw new Error('Timed out waiting for RunPod result');
	}

	async function generateKeyframe() {
		error = '';
		resultImage = null;
		if (!poseImage || !referenceImage || !prompt.trim()) {
			error = 'Pose image, reference image, and prompt are required';
			return;
		}

		generating = true;
		statusText = 'Submitting to RunPod...';

		const localJobId = jobQueue.addJob({
			type: 'sprite',
			name: 'RunPod Keyframe',
			description: prompt,
			status: 'processing',
			progress: 5
		});

		try {
			const res = await fetch('/api/generate-keyframe', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					poseImage,
					referenceImage,
					depthImage,
					workflowFile: workflowFile.trim(),
					prompt: prompt.trim(),
					negativePrompt: negativePrompt.trim(),
					seed,
					width,
					height
				})
			});
			const data = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(data.error || 'Failed to submit RunPod job');

			runpodId = data.runpodId;
			if (typeof data.seedUsed === 'number' && Number.isFinite(data.seedUsed)) {
				seed = data.seedUsed;
				lastSeedUsed = data.seedUsed;
			}
			lastWorkflowHash = data.workflowHash || '';
			statusText = `RunPod job submitted: ${data.runpodId}`;
			jobQueue.updateJob(localJobId, {
				status: 'processing',
				progress: 15,
				message: statusText
			});

			await pollUntilDone(localJobId);
		} catch (e) {
			error = e.message || 'Keyframe generation failed';
			jobQueue.failJob(localJobId, error);
		} finally {
			generating = false;
		}
	}
</script>

<div class="space-y-3">
	<h2 class="text-sm font-bold">RunPod Keyframes</h2>

	<div class="grid grid-cols-3 gap-2">
		<label class="text-[11px]">
			<span class="block mb-1 font-medium text-gray-700">Pose Image</span>
			<input type="file" accept="image/*" onchange={(e) => onImagePicked(e, 'pose')} class="w-full text-[11px]" />
		</label>
		<label class="text-[11px]">
			<span class="block mb-1 font-medium text-gray-700">Reference Image</span>
			<input type="file" accept="image/*" onchange={(e) => onImagePicked(e, 'reference')} class="w-full text-[11px]" />
		</label>
		<label class="text-[11px]">
			<span class="block mb-1 font-medium text-gray-700">Depth (optional)</span>
			<input type="file" accept="image/*" onchange={(e) => onImagePicked(e, 'depth')} class="w-full text-[11px]" />
		</label>
	</div>

	<div>
		<label class="block text-xs font-medium text-gray-700 mb-1">Prompt</label>
		<textarea bind:value={prompt} rows="3" class="w-full px-2 py-1.5 text-xs border rounded resize-none" />
	</div>

	<div>
		<label class="block text-xs font-medium text-gray-700 mb-1">Negative Prompt</label>
		<textarea bind:value={negativePrompt} rows="2" class="w-full px-2 py-1.5 text-xs border rounded resize-none" />
	</div>

	<div>
		<label class="block text-xs font-medium text-gray-700 mb-1">Workflow File (optional)</label>
		<input
			type="text"
			bind:value={workflowFile}
			placeholder="static/qwen_image_edit_2509_pose_api.json"
			class="w-full px-2 py-1.5 text-xs border rounded"
		/>
	</div>

	<div class="grid grid-cols-3 gap-2">
		<label class="text-[11px]">
			<span class="block mb-1 font-medium text-gray-700">Seed</span>
			<input type="number" bind:value={seed} class="w-full px-2 py-1.5 border rounded text-xs" />
		</label>
		<label class="text-[11px]">
			<span class="block mb-1 font-medium text-gray-700">Width</span>
			<input type="number" bind:value={width} min="256" step="64" class="w-full px-2 py-1.5 border rounded text-xs" />
		</label>
		<label class="text-[11px]">
			<span class="block mb-1 font-medium text-gray-700">Height</span>
			<input type="number" bind:value={height} min="256" step="64" class="w-full px-2 py-1.5 border rounded text-xs" />
		</label>
	</div>

	<div class="flex items-center gap-2">
		<button
			class="px-2 py-1 text-xs rounded border bg-gray-50 hover:bg-gray-100"
			onclick={() => showFolderPicker = true}
		>
			📁 Save Folder
		</button>
		<span class="text-[11px] text-gray-600 truncate">{saveFolderPath || 'Root'}</span>
	</div>

	<button
		onclick={generateKeyframe}
		disabled={generating}
		class="w-full px-3 py-2 text-sm font-medium text-white rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
	>
		{generating ? 'Generating...' : 'Generate Keyframe'}
	</button>

	{#if statusText}
		<p class="text-[11px] text-blue-700">{statusText}</p>
	{/if}
	{#if lastSeedUsed !== null || lastWorkflowHash}
		<p class="text-[11px] text-gray-600">
			Seed: {lastSeedUsed ?? 'n/a'} | Workflow: {lastWorkflowHash || 'n/a'}
		</p>
	{/if}
	{#if error}
		<p class="text-[11px] text-red-600">{error}</p>
	{/if}

	{#if resultImage}
		<div class="border rounded p-2 bg-gray-50">
			<p class="text-[11px] text-gray-700 mb-1 font-medium">Latest result</p>
			<img src={resultImage} alt="RunPod keyframe result" class="w-full max-h-56 object-contain rounded bg-gray-500" />
		</div>
	{/if}
</div>

{#if showFolderPicker}
	<FolderPicker
		onSelect={onFolderSelect}
		onClose={() => showFolderPicker = false}
	/>
{/if}
