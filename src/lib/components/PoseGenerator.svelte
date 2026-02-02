<script>
	import { poseStore } from '$lib/stores/poses.js';
	import FrameUpload from './FrameUpload.svelte';
	
	let poses = $state({ referenceImage: null, poses: [] });
	
	poseStore.subscribe(value => {
		poses = value;
	});
	
	let poseDescription = $state('');
	let isGenerating = $state(false);
	let error = $state(null);
	let lastGenerated = $state(null);
	
	// Quick pose presets
	const posePresets = [
		{ name: 'Standing', prompt: 'standing upright, neutral pose, arms at sides' },
		{ name: 'Running', prompt: 'running pose, mid-stride, legs apart, arms pumping' },
		{ name: 'Jumping', prompt: 'jumping in the air, legs bent, arms raised' },
		{ name: 'Crouching', prompt: 'crouching low, knees bent, ready stance' },
		{ name: 'Attacking', prompt: 'attack pose, swinging weapon or punching forward' },
		{ name: 'Casting', prompt: 'casting spell, hands raised with magical energy' },
		{ name: 'Hurt', prompt: 'hurt pose, recoiling backward, pained expression' },
		{ name: 'Dead', prompt: 'lying on ground, defeated, collapsed' },
	];
	
	function handleReferenceUpload(dataUrl) {
		poseStore.setReference(dataUrl);
	}
	
	function selectPreset(preset) {
		poseDescription = preset.prompt;
	}
	
	async function generatePose() {
		if (!poses.referenceImage || !poseDescription.trim()) {
			error = 'Need reference image and pose description';
			return;
		}
		
		isGenerating = true;
		error = null;
		lastGenerated = null;
		
		try {
			const response = await fetch('/api/generate-pose', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					referenceImage: poses.referenceImage,
					poseDescription: poseDescription.trim()
				})
			});
			
			const data = await response.json();
			
			if (!response.ok) {
				const errorMsg = data.error || data.details || 'Generation failed';
				throw new Error(errorMsg);
			}
			
			lastGenerated = {
				image: data.image,
				prompt: poseDescription.trim()
			};
			
		} catch (err) {
			error = err.message;
		} finally {
			isGenerating = false;
		}
	}
	
	function savePose() {
		if (!lastGenerated) return;
		
		const name = prompt('Name this pose:', poseDescription.slice(0, 30));
		if (name) {
			poseStore.addPose({
				name: name,
				imageData: lastGenerated.image,
				prompt: lastGenerated.prompt
			});
			lastGenerated = null;
			poseDescription = '';
		}
	}
	
	function discardPose() {
		lastGenerated = null;
	}
	
	function deletePose(id) {
		poseStore.removePose(id);
	}
	
	function usePoseForAnimation(pose) {
		// TODO: Send pose to animation panel
		alert('Feature coming: Use this pose as a keyframe for animation');
	}
</script>

<div class="space-y-4">
	<div>
		<h2 class="text-lg font-bold">Pose Generator</h2>
		<p class="text-xs text-gray-500">Generate specific poses with Nano Banana (Gemini)</p>
	</div>

	<!-- Reference Image -->
	<div>
		<label class="block text-sm font-medium mb-2">Character Reference *</label>
		{#if poses.referenceImage}
			<div class="relative">
				<img src={poses.referenceImage} alt="Reference" class="w-full h-32 object-contain rounded border-2 border-blue-400 bg-gray-100" />
				<button 
					class="absolute top-1 right-1 bg-red-500 text-white text-xs px-2 py-1 rounded hover:bg-red-600"
					onclick={() => poseStore.setReference(null)}
				>✕</button>
			</div>
			<p class="text-xs text-blue-600 mt-1">✓ Reference set</p>
		{:else}
			<FrameUpload label="Upload character reference" onUpload={handleReferenceUpload} />
		{/if}
	</div>

	<!-- Pose Presets -->
	<div>
		<label class="block text-sm font-medium mb-2">Quick Presets</label>
		<div class="flex flex-wrap gap-1">
			{#each posePresets as preset}
				<button
					type="button"
					class="px-2 py-1 text-xs bg-gray-100 hover:bg-gray-200 rounded border"
					onclick={() => selectPreset(preset)}
				>
					{preset.name}
				</button>
			{/each}
		</div>
	</div>

	<!-- Pose Description -->
	<div>
		<label class="block text-sm font-medium mb-2">Pose Description</label>
		<textarea
			bind:value={poseDescription}
			placeholder="Describe the pose you want..."
			rows="2"
			class="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg resize-none"
		></textarea>
	</div>

	<!-- Generate Button -->
	<button
		class="w-full px-4 py-2 text-base bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
		onclick={generatePose}
		disabled={isGenerating || !poses.referenceImage || !poseDescription.trim()}
	>
		{isGenerating ? 'Generating Pose...' : 'Generate Pose'}
	</button>

	{#if error}
		<div class="p-2 text-sm bg-red-100 border border-red-400 text-red-700 rounded">
			{error}
		</div>
	{/if}

	<!-- Generated Result -->
	{#if lastGenerated}
		<div class="border-2 border-green-400 rounded-lg p-3 bg-green-50">
			<p class="text-sm font-medium text-green-800 mb-2">Generated Pose:</p>
			<img src={lastGenerated.image} alt="Generated pose" class="w-full h-40 object-contain bg-white rounded" />
			<p class="text-xs text-gray-500 mt-1 truncate">{lastGenerated.prompt}</p>
			<div class="flex gap-2 mt-2">
				<button
					class="flex-1 px-3 py-1 text-sm bg-green-600 text-white rounded hover:bg-green-700"
					onclick={savePose}
				>
					Save Pose
				</button>
				<button
					class="flex-1 px-3 py-1 text-sm bg-gray-300 text-gray-700 rounded hover:bg-gray-400"
					onclick={discardPose}
				>
					Discard
				</button>
			</div>
		</div>
	{/if}

	<!-- Saved Poses Library -->
	{#if poses.poses.length > 0}
		<div>
			<h3 class="text-sm font-medium mb-2">Saved Poses ({poses.poses.length})</h3>
			<div class="grid grid-cols-3 gap-2">
				{#each poses.poses as pose}
					<div class="relative group">
						<img 
							src={pose.imageData} 
							alt={pose.name} 
							class="w-full h-20 object-contain bg-gray-100 rounded border cursor-pointer hover:border-blue-400"
							onclick={() => usePoseForAnimation(pose)}
						/>
						<button
							class="absolute top-0 right-0 bg-red-500 text-white text-xs w-4 h-4 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
							onclick={() => deletePose(pose.id)}
						>×</button>
						<p class="text-xs text-center truncate mt-1">{pose.name}</p>
					</div>
				{/each}
			</div>
		</div>
	{/if}
</div>

