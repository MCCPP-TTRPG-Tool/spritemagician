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
	let selectedPose = $state(null); // For preview
	
	// Listen for when center panel saves/discards the generated pose
	if (typeof window !== 'undefined') {
		window.addEventListener('poseSavedOrDiscarded', () => {
			lastGenerated = null;
		});
	}
	
	// Quick pose presets - specific poses that maintain character identity
	const posePresets = [
		{ name: 'Standing', prompt: 'standing upright in neutral idle pose, weight evenly distributed, relaxed stance' },
		{ name: 'Running', prompt: 'dynamic running pose, one leg forward mid-stride, arms in running motion, leaning forward slightly' },
		{ name: 'Jumping', prompt: 'airborne jumping pose, legs tucked or extended, arms up for balance' },
		{ name: 'Crouching', prompt: 'low crouching stance, knees deeply bent, body compact, ready to spring' },
		{ name: 'Attacking', prompt: 'aggressive attack pose, body twisted in striking motion, weight forward' },
		{ name: 'Casting', prompt: 'mystical casting pose, arms extended outward channeling energy, dramatic stance' },
		{ name: 'Hurt', prompt: 'recoiling in pain, body arched backward, defensive posture' },
		{ name: 'Dead', prompt: 'collapsed on ground, body limp, completely fallen over' },
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
			
			// Show in the center viewer
			showGeneratedInViewer();
			
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
	
	function previewPose(pose) {
		selectedPose = pose;
		// Dispatch event to show pose in PoseViewer
		if (typeof window !== 'undefined') {
			window.dispatchEvent(new CustomEvent('poseSelected', { detail: pose }));
		}
	}
	
	function showGeneratedInViewer() {
		if (lastGenerated && typeof window !== 'undefined') {
			window.dispatchEvent(new CustomEvent('poseGenerated', { 
				detail: { 
					id: 'preview',
					name: 'Generated Preview',
					imageData: lastGenerated.image,
					prompt: lastGenerated.prompt
				} 
			}));
		}
	}
	
	function usePoseForAnimation(pose) {
		// TODO: Send pose to animation panel
		alert('Feature coming: Use this pose as a keyframe for animation');
	}
</script>

<div class="space-y-2">
	<!-- Reference Preview -->
	{#if poses.referenceImage}
		<div class="relative w-3/4 mx-auto">
			<img src={poses.referenceImage} alt="Reference" class="w-full aspect-square object-contain rounded-lg border-2 border-purple-400 bg-gray-100" />
			<button 
				class="absolute top-1 right-1 bg-red-500 text-white text-xs w-5 h-5 rounded-full hover:bg-red-600 flex items-center justify-center"
				onclick={() => poseStore.setReference(null)}
			>×</button>
		</div>
	{:else}
		<div class="w-3/4 mx-auto aspect-square">
			<FrameUpload label="Upload Reference" onUpload={handleReferenceUpload} />
		</div>
	{/if}

	<!-- Pose Presets -->
	<div class="flex flex-wrap gap-1 justify-center">
		{#each posePresets as preset}
			<button
				type="button"
				class="px-2 py-0.5 text-[10px] bg-gray-100 hover:bg-purple-100 rounded border hover:border-purple-300"
				onclick={() => selectPreset(preset)}
			>
				{preset.name}
			</button>
		{/each}
	</div>

	<!-- Pose Description + Generate -->
	<div class="flex gap-2">
		<input
			type="text"
			bind:value={poseDescription}
			placeholder="Describe pose..."
			class="flex-1 px-2 py-1.5 text-sm border border-gray-300 rounded"
		/>
		<button
			class="px-3 py-1.5 text-sm bg-purple-600 text-white rounded hover:bg-purple-700 disabled:bg-gray-400 disabled:cursor-not-allowed whitespace-nowrap"
			onclick={generatePose}
			disabled={isGenerating || !poses.referenceImage || !poseDescription.trim()}
		>
			{isGenerating ? '...' : 'Generate'}
		</button>
	</div>

	<!-- Status messages -->
	{#if error}
		<p class="text-xs text-red-600 bg-red-50 px-2 py-1 rounded">{error}</p>
	{/if}

	{#if lastGenerated}
		<p class="text-xs text-green-700 bg-green-50 px-2 py-1 rounded">✓ Generated! See Poses tab →</p>
	{/if}
</div>

