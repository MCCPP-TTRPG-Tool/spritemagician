<script>
	import { poseStore } from '$lib/stores/poses.js';
	import { projectStore } from '$lib/stores/project.js';
	
	let poses = $state({ referenceImage: null, poses: [] });
	let selectedPose = $state(null);
	let showFullSize = $state(false);
	let pickingMode = $state(false); // When true, clicking a pose uses it for animation
	
	poseStore.subscribe(value => {
		poses = value;
	});
	
	// Listen for pose selection from PoseGenerator
	if (typeof window !== 'undefined') {
		window.addEventListener('poseSelected', (e) => {
			selectedPose = e.detail;
		});
		
		window.addEventListener('poseGenerated', (e) => {
			selectedPose = e.detail;
		});
		
		// Listen for pick mode activation from GenerationPanel
		window.addEventListener('startPosePicking', () => {
			pickingMode = true;
		});
	}
	
	function selectPose(pose) {
		// Always use for animation when clicked
		usePoseForAnimation(pose);
	}
	
	function previewPose(pose, event) {
		event.stopPropagation();
		selectedPose = pose;
		showFullSize = true;
	}
	
	function usePoseForAnimation(pose) {
		// Set as first frame in project
		projectStore.update(p => ({ ...p, firstFrame: pose.imageData }));
		pickingMode = false;
		// Notify to switch back to animation tab
		if (typeof window !== 'undefined') {
			window.dispatchEvent(new CustomEvent('posePickedForAnimation', { detail: pose }));
		}
	}
	
	function cancelPicking() {
		pickingMode = false;
		if (typeof window !== 'undefined') {
			window.dispatchEvent(new CustomEvent('posePickingCancelled'));
		}
	}
	
	function deletePose(id, name) {
		if (confirm(`Delete pose "${name}"? This cannot be undone.`)) {
			poseStore.removePose(id);
			if (selectedPose?.id === id) {
				selectedPose = null;
			}
		}
	}
	
	function closeFullSize() {
		showFullSize = false;
		selectedPose = null;
	}
</script>

<div class="h-full flex flex-col">
	<!-- Picking Mode Header -->
	{#if pickingMode}
		<div class="bg-blue-100 border-2 border-blue-400 rounded-lg p-3 mb-3">
			<div class="flex items-center justify-between">
				<div>
					<p class="text-sm font-bold text-blue-800">🎯 Select a Pose for Animation</p>
					<p class="text-xs text-blue-600">Click a pose to use it as your starting frame</p>
				</div>
				<button
					class="px-3 py-1 text-sm bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
					onclick={cancelPicking}
				>
					Cancel
				</button>
			</div>
		</div>
	{:else}
		<h3 class="text-sm font-semibold mb-2">Pose Library</h3>
	{/if}
	
	
	<!-- Saved Poses Grid -->
	{#if poses.poses.length > 0}
		<div class="flex-1 overflow-y-auto">
			{#if pickingMode}
				<p class="text-xs text-blue-600 mb-2 font-medium">Available Poses ({poses.poses.length}) - Click to select</p>
			{:else}
				<p class="text-xs text-gray-500 mb-2">Saved Poses ({poses.poses.length}) - Click to use for animation</p>
			{/if}
			<div class="grid grid-cols-4 gap-3">
				{#each poses.poses as pose}
					<div class="relative group">
						<img 
							src={pose.imageData} 
							alt={pose.name} 
							class="w-full aspect-square object-contain rounded border-2 cursor-pointer transition-all {pickingMode ? 'bg-blue-50 border-blue-200 hover:border-blue-500 hover:ring-2 hover:ring-blue-300 hover:scale-105' : 'bg-gray-100 border-gray-200 hover:border-purple-400 hover:ring-2 hover:ring-purple-200'}"
							onclick={() => selectPose(pose)}
							onkeydown={(e) => { if (e.key === 'Enter') selectPose(pose); }}
							tabindex="0"
							role="button"
							title="Click to use for animation"
						/>
						<!-- Magnifying glass for preview -->
						<button
							class="absolute top-1 left-1 bg-white/90 text-gray-700 text-xs w-6 h-6 rounded-full opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center shadow hover:bg-white hover:scale-110"
							onclick={(e) => previewPose(pose, e)}
							title="Preview full size"
						>🔍</button>
						<!-- Delete button -->
						{#if !pickingMode}
							<button
								class="absolute -top-1 -right-1 bg-red-500 text-white text-xs w-5 h-5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center shadow"
								onclick={(e) => {
									e.stopPropagation();
									deletePose(pose.id, pose.name);
								}}
								title="Delete pose"
							>×</button>
						{/if}
						<p class="text-xs text-center truncate mt-1 {pickingMode ? 'font-medium' : ''}">{pose.name}</p>
					</div>
				{/each}
			</div>
		</div>
	{:else}
		<div class="flex-1 flex items-center justify-center text-gray-400">
			<div class="text-center">
				<p class="text-4xl mb-2">🎭</p>
				<p class="text-sm">No poses saved yet</p>
				<p class="text-xs mt-1">Generate poses using the panel on the left</p>
			</div>
		</div>
	{/if}
</div>

<!-- Full Size Modal -->
{#if showFullSize && selectedPose}
	<div 
		class="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
		onclick={closeFullSize}
		onkeydown={(e) => { if (e.key === 'Escape') closeFullSize(); }}
		tabindex="0"
		role="dialog"
	>
		<div class="relative max-w-full max-h-full">
			<button
				onclick={closeFullSize}
				class="absolute -top-10 right-0 text-white hover:text-gray-300 text-2xl"
				title="Close"
			>
				✕
			</button>
			<img 
				src={selectedPose.imageData} 
				alt={selectedPose.name}
				class="max-w-full max-h-[90vh] object-contain bg-gray-900 border-2 border-gray-700 rounded"
				onclick={(e) => e.stopPropagation()}
			/>
			<p class="text-center text-white text-sm mt-2">{selectedPose.name}</p>
			{#if selectedPose.prompt}
				<p class="text-center text-gray-400 text-xs mt-1">"{selectedPose.prompt}"</p>
			{/if}
		</div>
	</div>
{/if}
