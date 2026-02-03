<script>
	import { projectStore, reorderFrames, removeFrame } from '$lib/stores/project.js';
	import { poseStore } from '$lib/stores/poses.js';
	import { animationStore } from '$lib/stores/animations.js';
	import { assetStore } from '$lib/stores/assets.js';
	import { unsavedAnimations } from '$lib/stores/unsavedAnimations.js';
	import { completedJobs } from '$lib/stores/completedJobs.js';
	import { browser } from '$app/environment';
	import JobQueue from './JobQueue.svelte';
	import CompletedJobsViewer from './CompletedJobsViewer.svelte';
	
	let activeTab = $state('assets'); // 'assets', 'frames', 'poses', 'animations'
	let showCompletedJobs = $state(true); // Always show by default
	
	let project = $state({ frames: [], fps: 12 });
	let completedJobsState = $state({ jobs: [], activeIndex: 0, loaded: false });
	completedJobs.subscribe(value => { completedJobsState = value; });
	let poses = $state({ poses: [] });
	let animations = $state({ animations: [] });
	let assets = $state({ categories: [] });
	let unsaved = $state({ animations: [], activeIndex: 0 });
	
	projectStore.subscribe(value => { project = value; });
	poseStore.subscribe(value => { poses = value; });
	animationStore.subscribe(value => { animations = value; });
	assetStore.subscribe(value => { assets = value; });
	unsavedAnimations.subscribe(value => { unsaved = value; });
	
	// Switch to an unsaved animation
	function switchToUnsavedAnimation(index) {
		unsavedAnimations.setActiveIndex(index);
		const anim = unsaved.animations[index];
		if (anim) {
			projectStore.update(p => ({
				...p,
				frames: anim.frames,
				prompt: anim.pose
			}));
		}
	}
	
	// Discard an unsaved animation
	function discardUnsavedAnimation(id) {
		unsavedAnimations.removeAnimation(id);
		// If there are still animations, switch to the active one
		const remaining = unsaved.animations.filter(a => a.id !== id);
		if (remaining.length > 0) {
			const newIndex = Math.min(unsaved.activeIndex, remaining.length - 1);
			const anim = remaining[newIndex];
			if (anim) {
				projectStore.update(p => ({
					...p,
					frames: anim.frames,
					prompt: anim.pose
				}));
			}
		} else {
			// No more unsaved, clear frames
			projectStore.update(p => ({ ...p, frames: [] }));
		}
	}
	
	// Keep current animation (remove from unsaved buffer, keep in project)
	function keepCurrentAnimation() {
		const anim = unsaved.animations[unsaved.activeIndex];
		if (anim) {
			unsavedAnimations.removeAnimation(anim.id);
		}
	}
	
	// Assets tab state
	let currentCategory = $state(null); // null = show folders, object = show assets in folder
	let showNewCategoryModal = $state(false);
	let newCategoryName = $state('');
	let newCategoryIcon = $state('📁');
	let movingAsset = $state(null); // { categoryId, assetId }
	
	// Hover preview for folders
	let hoverPreview = $state(null); // { category, x, y }
	let hoverTimeout = $state(null);
	
	function startHoverPreview(category, event) {
		// Clear any existing timeout
		if (hoverTimeout) clearTimeout(hoverTimeout);
		
		// Start a new timeout for 400ms delay
		hoverTimeout = setTimeout(() => {
			const rect = event.target.getBoundingClientRect();
			hoverPreview = {
				category,
				x: rect.left + rect.width / 2,
				y: rect.top - 10
			};
		}, 400);
	}
	
	function endHoverPreview() {
		if (hoverTimeout) {
			clearTimeout(hoverTimeout);
			hoverTimeout = null;
		}
		hoverPreview = null;
	}
	
	// Get total asset count
	$effect(() => {
		// This will re-run when assets changes
	});
	
	function getTotalAssetCount() {
		return assets.categories.reduce((sum, cat) => sum + cat.assets.length, 0);
	}
	
	// Frame dragging
	let draggedIndex = $state(null);
	let dragOverIndex = $state(null);
	
	// Animation preview
	let previewingAnim = $state(null);
	let previewFrame = $state(0);
	let previewInterval = $state(null);
	
	// Generated pose preview
	let generatedPose = $state(null);
	
	// Listen for pose picking mode
	let pickingMode = $state(false);
	
	// Generated sprite for saving
	let pendingSpriteToSave = $state(null);
	let showSaveAssetModal = $state(false);
	let saveAssetName = $state('');
	let saveAssetCategory = $state('characters');
	
	if (browser) {
		window.addEventListener('startPosePicking', () => {
			pickingMode = true;
			activeTab = 'poses';
		});
		window.addEventListener('posePickedForAnimation', () => {
			pickingMode = false;
			// Stay on poses tab - don't switch to frames
		});
		window.addEventListener('posePickingCancelled', () => {
			pickingMode = false;
		});
		// Auto-switch to frames tab when animation completes
		window.addEventListener('animationCompleted', (e) => {
			console.log('Animation completed:', e.detail);
			activeTab = 'frames';
		});
		// Listen for newly generated poses
		window.addEventListener('poseGenerated', (e) => {
			generatedPose = e.detail;
			activeTab = 'poses';
		});
		// Listen for sprite save request - show category picker
		window.addEventListener('saveSpriteToGallery', (e) => {
			const { image, description, type, style } = e.detail;
			pendingSpriteToSave = { image, description, type, style };
			saveAssetName = description?.slice(0, 30) || 'New Sprite';
			// Try to auto-select category based on type
			if (type === 'character') saveAssetCategory = 'characters';
			else if (type === 'creature' || type === 'monster' || type === 'animal') saveAssetCategory = 'creatures';
			else if (type === 'item' || type === 'object') saveAssetCategory = 'items';
			else if (type === 'building' || type === 'plant') saveAssetCategory = 'scenery';
			else if (type === 'effect') saveAssetCategory = 'effects';
			else saveAssetCategory = 'props';
			showSaveAssetModal = true;
		});
	}
	
	// === FRAMES ===
	function handleDragStart(index) { draggedIndex = index; }
	function handleDragOver(event, index) { event.preventDefault(); dragOverIndex = index; }
	function handleDrop(event, dropIndex) {
		event.preventDefault();
		if (draggedIndex !== null && draggedIndex !== dropIndex) {
			reorderFrames(draggedIndex, dropIndex);
		}
		draggedIndex = null;
		dragOverIndex = null;
	}
	function handleDragEnd() { draggedIndex = null; dragOverIndex = null; }
	
	// === POSES ===
	function usePoseForAnimation(pose) {
		projectStore.update(p => ({ ...p, firstFrame: pose.imageData }));
		pickingMode = false;
		if (browser) {
			window.dispatchEvent(new CustomEvent('posePickedForAnimation', { detail: pose }));
		}
	}
	
	function deletePose(id, name) {
		if (confirm(`Delete pose "${name}"? This cannot be undone.`)) {
			poseStore.removePose(id);
		}
	}
	
	// Pose preview modal
	let previewingPose = $state(null);
	
	function previewPoseFull(pose) {
		previewingPose = pose;
	}
	
	function closePosePreview() {
		previewingPose = null;
	}
	
	function saveGeneratedPose() {
		if (!generatedPose) return;
		const name = prompt('Name this pose:', generatedPose.prompt?.slice(0, 30) || 'New Pose');
		if (name) {
			poseStore.addPose({
				name: name,
				imageData: generatedPose.imageData,
				prompt: generatedPose.prompt
			});
		}
		generatedPose = null;
		// Notify PoseGenerator to clear its state
		if (browser) {
			window.dispatchEvent(new CustomEvent('poseSavedOrDiscarded'));
		}
	}
	
	function discardGeneratedPose() {
		generatedPose = null;
		// Notify PoseGenerator to clear its state
		if (browser) {
			window.dispatchEvent(new CustomEvent('poseSavedOrDiscarded'));
		}
	}
	
	// === ANIMATIONS ===
	function saveCurrentAnimation() {
		if (project.frames.length === 0) {
			alert('No frames to save. Generate an animation first.');
			return;
		}
		const name = prompt('Name this animation:', `Animation ${animations.animations.length + 1}`);
		if (name) {
			animationStore.addAnimation({
				name,
				frames: [...project.frames],
				fps: project.fps,
				prompt: project.prompt || '',
				frameCount: project.frames.length
			});
		}
	}
	
	function loadAnimation(anim) {
		projectStore.update(p => ({
			...p,
			frames: [...anim.frames],
			fps: anim.fps,
			prompt: anim.prompt
		}));
		activeTab = 'frames';
	}
	
	function deleteAnimation(id, name) {
		if (confirm(`Delete animation "${name}"? This cannot be undone.`)) {
			animationStore.removeAnimation(id);
		}
	}
	
	function startAnimPreview(anim, e) {
		e.stopPropagation();
		previewingAnim = anim;
		previewFrame = 0;
		if (previewInterval) clearInterval(previewInterval);
		previewInterval = setInterval(() => {
			if (previewingAnim) {
				previewFrame = (previewFrame + 1) % previewingAnim.frames.length;
			}
		}, 1000 / (anim.fps || 12));
	}
	
	function stopAnimPreview() {
		if (previewInterval) clearInterval(previewInterval);
		previewInterval = null;
		previewingAnim = null;
	}
	
	// === ASSETS ===
	let previewingAsset = $state(null);
	
	function openCategory(category) {
		currentCategory = category;
	}
	
	function goBackToFolders() {
		currentCategory = null;
		movingAsset = null;
	}
	
	function useAssetForAnimation(asset) {
		// Set as animation reference
		projectStore.update(p => ({ ...p, firstFrame: asset.imageData }));
		// Also set as pose generator reference
		poseStore.setReference(asset.imageData);
	}
	
	function deleteAsset(categoryId, assetId, name) {
		if (confirm(`Delete "${name}"? This cannot be undone.`)) {
			assetStore.removeAsset(categoryId, assetId);
		}
	}
	
	function previewAssetFull(asset) {
		previewingAsset = asset;
	}
	
	function closeAssetPreview() {
		previewingAsset = null;
	}
	
	function startMoveAsset(categoryId, assetId) {
		movingAsset = { categoryId, assetId };
		goBackToFolders(); // Go back to folder view to select destination
	}
	
	function moveAssetToCategory(targetCategoryId) {
		if (movingAsset && movingAsset.categoryId !== targetCategoryId) {
			assetStore.moveAsset(movingAsset.categoryId, targetCategoryId, movingAsset.assetId);
		}
		movingAsset = null;
	}
	
	function createNewCategory() {
		if (newCategoryName.trim()) {
			assetStore.addCategory(newCategoryName.trim(), newCategoryIcon);
			newCategoryName = '';
			newCategoryIcon = '📁';
			showNewCategoryModal = false;
		}
	}
	
	function deleteCategory(categoryId, name) {
		const category = assets.categories.find(c => c.id === categoryId);
		if (category && category.assets.length > 0) {
			if (!confirm(`Delete "${name}" and all ${category.assets.length} assets inside? This cannot be undone.`)) {
				return;
			}
		} else if (!confirm(`Delete "${name}"?`)) {
			return;
		}
		assetStore.removeCategory(categoryId);
		if (currentCategory?.id === categoryId) {
			currentCategory = null;
		}
	}
	
	function renameCategory(categoryId) {
		const category = assets.categories.find(c => c.id === categoryId);
		if (category) {
			const newName = prompt('Rename category:', category.name);
			if (newName && newName.trim()) {
				assetStore.renameCategory(categoryId, newName.trim());
			}
		}
	}
	
	function renameAsset(categoryId, assetId) {
		const category = assets.categories.find(c => c.id === categoryId);
		if (category) {
			const asset = category.assets.find(a => a.id === assetId);
			if (asset) {
				const newName = prompt('Rename asset:', asset.name);
				if (newName && newName.trim()) {
					assetStore.renameAsset(categoryId, assetId, newName.trim());
				}
			}
		}
	}
	
	function setAsThumbnail(categoryId, imageData) {
		assetStore.setCategoryThumbnail(categoryId, imageData);
	}
	
	function saveAssetToCategory() {
		if (pendingSpriteToSave && saveAssetName.trim()) {
			assetStore.addAsset(saveAssetCategory, {
				name: saveAssetName.trim(),
				imageData: pendingSpriteToSave.image,
				description: pendingSpriteToSave.description,
				type: pendingSpriteToSave.type,
				style: pendingSpriteToSave.style
			});
			pendingSpriteToSave = null;
			showSaveAssetModal = false;
			saveAssetName = '';
			activeTab = 'assets';
		}
	}
	
	function cancelSaveAsset() {
		pendingSpriteToSave = null;
		showSaveAssetModal = false;
		saveAssetName = '';
	}
	
	const categoryIcons = ['📁', '🧙', '🐉', '⚔️', '🏔️', '✨', '🪑', '🎯', '👹', '🦊', '💎', '🏰', '🚀', '🌳', '🎭', '🎨', '🔮', '⚡', '🛡️', '👑'];
</script>

<div class="h-full flex flex-col">
	<!-- Tab Bar -->
	<div class="flex border-b mb-3 flex-shrink-0">
		<button
			class="flex-1 px-1 py-2 text-[10px] font-medium transition-colors {activeTab === 'assets' ? 'bg-green-50 text-green-600 border-b-2 border-green-600' : 'text-gray-500 hover:bg-gray-50'}"
			onclick={() => { activeTab = 'assets'; currentCategory = null; }}
		>
			📁 Assets ({getTotalAssetCount()})
		</button>
		<button
			class="flex-1 px-1 py-2 text-[10px] font-medium transition-colors {activeTab === 'frames' ? 'bg-blue-50 text-blue-600 border-b-2 border-blue-600' : 'text-gray-500 hover:bg-gray-50'}"
			onclick={() => activeTab = 'frames'}
		>
			🎞️ Frames ({project.frames.length})
		</button>
		<button
			class="flex-1 px-1 py-2 text-[10px] font-medium transition-colors {activeTab === 'poses' ? 'bg-purple-50 text-purple-600 border-b-2 border-purple-600' : 'text-gray-500 hover:bg-gray-50'} {pickingMode ? 'ring-2 ring-blue-400' : ''}"
			onclick={() => activeTab = 'poses'}
		>
			🎭 Poses ({poses.poses.length})
		</button>
		<button
			class="flex-1 px-1 py-2 text-[10px] font-medium transition-colors {activeTab === 'animations' ? 'bg-orange-50 text-orange-600 border-b-2 border-orange-600' : 'text-gray-500 hover:bg-gray-50'}"
			onclick={() => activeTab = 'animations'}
		>
			🎬 Anims ({animations.animations.length})
		</button>
	</div>
	
	<!-- Content -->
	<div class="flex-1 overflow-y-auto">
		<!-- Completed Jobs Viewer - toggleable -->
		{#if showCompletedJobs}
			<CompletedJobsViewer />
		{/if}
		
		<!-- ASSETS TAB -->
		{#if activeTab === 'assets'}
			{#if movingAsset}
				<!-- Moving mode - select destination folder -->
				<div class="bg-blue-50 border-2 border-blue-300 rounded-lg p-3 mb-3">
					<p class="text-sm font-bold text-blue-800">📦 Select destination folder</p>
					<p class="text-xs text-blue-600">Click a folder to move the asset there</p>
					<button
						class="mt-2 px-3 py-1 text-xs bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
						onclick={() => movingAsset = null}
					>Cancel</button>
				</div>
			{/if}
			
			{#if !currentCategory}
				<!-- FOLDER VIEW -->
				<div class="flex items-center justify-between mb-2">
					<p class="text-xs text-gray-500">Categories ({assets.categories.length})</p>
					<button
						class="px-2 py-1 text-xs bg-green-100 text-green-700 rounded hover:bg-green-200"
						onclick={() => showNewCategoryModal = true}
					>+ New</button>
				</div>
				
				<div class="grid grid-cols-3 gap-3">
					{#each assets.categories as category}
						<div 
							class="relative group border-2 rounded-lg overflow-hidden cursor-pointer transition-all bg-gray-50 {movingAsset ? 'border-blue-300 hover:border-blue-500 hover:bg-blue-50' : 'border-gray-200 hover:border-green-400'}"
							onclick={() => movingAsset ? moveAssetToCategory(category.id) : openCategory(category)}
							onmouseenter={(e) => startHoverPreview(category, e)}
							onmouseleave={endHoverPreview}
						>
							<div class="aspect-square bg-gray-100 relative flex items-center justify-center">
								{#if category.thumbnail && category.thumbnail !== 'stored' && category.thumbnail.startsWith('data:')}
									<img src={category.thumbnail} alt={category.name} class="w-full h-full object-contain" />
								{:else}
									<span class="text-4xl">{category.icon}</span>
								{/if}
								<!-- Asset count badge -->
								<span class="absolute bottom-1 right-1 bg-black/70 text-white text-[9px] px-1.5 rounded">
									{category.assets.length}
								</span>
								<!-- Edit buttons (not in moving mode) -->
								{#if !movingAsset}
									<button
										class="absolute top-1 left-1 bg-white/90 text-gray-700 w-5 h-5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center shadow text-[10px] hover:scale-110"
										onclick={(e) => { e.stopPropagation(); renameCategory(category.id); }}
										title="Rename"
									>✏️</button>
									{#if category.id.startsWith('custom-')}
										<button
											class="absolute -top-1 -right-1 bg-red-500 text-white w-5 h-5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center shadow text-xs z-10"
											onclick={(e) => { e.stopPropagation(); deleteCategory(category.id, category.name); }}
											title="Delete"
										>×</button>
									{/if}
								{/if}
							</div>
							<div class="p-2">
								<p class="text-xs font-medium truncate text-center">{category.icon} {category.name}</p>
							</div>
						</div>
					{/each}
				</div>
			{:else}
				<!-- INSIDE A FOLDER - Show assets -->
				<div class="flex items-center gap-2 mb-3">
					<button
						class="px-2 py-1 text-xs bg-gray-200 text-gray-700 rounded hover:bg-gray-300 flex items-center gap-1"
						onclick={goBackToFolders}
					>← Back</button>
					<span class="text-sm font-medium">{currentCategory.icon} {currentCategory.name}</span>
					<span class="text-xs text-gray-400">({currentCategory.assets.length} assets)</span>
				</div>
				
				{#if currentCategory.assets.length === 0}
					<div class="flex items-center justify-center h-48 text-gray-400">
						<div class="text-center">
							<p class="text-3xl mb-2">{currentCategory.icon}</p>
							<p class="text-sm">No assets in this category</p>
							<p class="text-xs mt-1">Save sprites here from the Create tab</p>
						</div>
					</div>
				{:else}
					<div class="grid grid-cols-4 gap-3">
						{#each currentCategory.assets as asset}
							<div class="relative group">
								{#if asset.imageData && asset.imageData !== 'stored' && asset.imageData.startsWith('data:')}
									<img 
										src={asset.imageData} 
										alt={asset.name}
										class="w-full aspect-square object-contain rounded border-2 cursor-pointer transition-all bg-gray-100 border-gray-200 hover:border-green-400"
										onclick={() => useAssetForAnimation(asset)}
										title="Click to use for animation"
									/>
								{:else}
									<div class="w-full aspect-square flex items-center justify-center rounded border-2 bg-gray-100 border-gray-200">
										<span class="text-gray-400 text-xs">Loading...</span>
									</div>
								{/if}
								<!-- Preview -->
								<button
									class="absolute top-1 left-1 bg-white/90 text-gray-700 w-5 h-5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center shadow text-[10px] hover:scale-110"
									onclick={(e) => { e.stopPropagation(); previewAssetFull(asset); }}
									title="View full size"
								>🔍</button>
								<!-- Move -->
								<button
									class="absolute top-1 left-7 bg-white/90 text-gray-700 w-5 h-5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center shadow text-[10px] hover:scale-110"
									onclick={(e) => { e.stopPropagation(); startMoveAsset(currentCategory.id, asset.id); }}
									title="Move to folder"
								>📦</button>
								<!-- Set as thumbnail -->
								<button
									class="absolute top-1 right-6 bg-white/90 text-gray-700 w-5 h-5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center shadow text-[10px] hover:scale-110"
									onclick={(e) => { e.stopPropagation(); setAsThumbnail(currentCategory.id, asset.imageData); }}
									title="Set as folder thumbnail"
								>📌</button>
								<!-- Delete -->
								<button
									class="absolute -top-1 -right-1 bg-red-500 text-white w-5 h-5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center shadow text-xs z-10"
									onclick={(e) => { e.stopPropagation(); deleteAsset(currentCategory.id, asset.id, asset.name); }}
									title="Delete"
								>×</button>
								<p class="text-xs text-center truncate mt-1">{asset.name}</p>
							</div>
						{/each}
					</div>
				{/if}
			{/if}
		
		<!-- FRAMES TAB -->
		{:else if activeTab === 'frames'}
			{#if project.frames.length === 0}
				<div class="flex items-center justify-center h-full text-gray-400">
					<div class="text-center">
						<p class="text-4xl mb-2">🎞️</p>
						<p class="text-sm">No frames yet</p>
						<p class="text-xs mt-1">Generate an animation to see frames here</p>
					</div>
				</div>
			{:else}
				<div class="grid grid-cols-5 gap-2">
					{#each project.frames as frame, index}
						<div
							class="relative border rounded overflow-hidden cursor-move transition-all aspect-square {draggedIndex === index ? 'opacity-50 scale-95' : ''} {dragOverIndex === index ? 'border-blue-500 scale-105' : 'border-gray-300'}"
							draggable="true"
							ondragstart={() => handleDragStart(index)}
							ondragover={(e) => handleDragOver(e, index)}
							ondrop={(e) => handleDrop(e, index)}
							ondragend={handleDragEnd}
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
		
		<!-- POSES TAB -->
		{:else if activeTab === 'poses'}
			{#if pickingMode}
				<div class="bg-blue-100 border-2 border-blue-400 rounded-lg p-3 mb-3">
					<p class="text-sm font-bold text-blue-800">🎯 Select a Pose for Animation</p>
					<p class="text-xs text-blue-600">Click a pose to use it as your starting frame</p>
				</div>
			{/if}
			
			<!-- Generated Pose Preview -->
			{#if generatedPose}
				<div class="bg-green-50 border-2 border-green-400 rounded-lg p-4 mb-4">
					<p class="text-sm font-bold text-green-800 mb-3">✨ New Pose Generated!</p>
					<div class="flex gap-4">
						<img 
							src={generatedPose.imageData} 
							alt="Generated pose"
							class="w-48 h-48 object-contain bg-white rounded-lg border shadow"
						/>
						<div class="flex-1 flex flex-col justify-between">
							{#if generatedPose.prompt}
								<p class="text-xs text-gray-600 italic mb-2">"{generatedPose.prompt}"</p>
							{/if}
							<div class="space-y-2">
								<button
									class="w-full px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 font-medium text-sm flex items-center justify-center gap-2"
									onclick={saveGeneratedPose}
								>
									💾 Save Pose
								</button>
								<button
									class="w-full px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 text-sm"
									onclick={discardGeneratedPose}
								>
									Discard
								</button>
							</div>
						</div>
					</div>
				</div>
			{/if}
			
			<!-- Saved Poses -->
			{#if poses.poses.length === 0 && !generatedPose}
				<div class="flex items-center justify-center h-full text-gray-400">
					<div class="text-center">
						<p class="text-4xl mb-2">🎭</p>
						<p class="text-sm">No poses saved yet</p>
						<p class="text-xs mt-1">Generate poses in the Poses tab</p>
					</div>
				</div>
			{:else if poses.poses.length > 0}
				<p class="text-xs text-gray-500 mb-2">Saved Poses ({poses.poses.length}) - Click to use for animation</p>
				<div class="grid grid-cols-4 gap-3">
					{#each poses.poses as pose}
						<div class="relative group">
							<img 
								src={pose.imageData} 
								alt={pose.name}
								class="w-full aspect-square object-contain rounded border-2 cursor-pointer transition-all bg-gray-100 {pickingMode ? 'border-blue-200 hover:border-blue-500 hover:ring-2 hover:ring-blue-300' : 'border-gray-200 hover:border-purple-400'}"
								onclick={() => usePoseForAnimation(pose)}
								title="Click to use for animation"
							/>
							<!-- Preview -->
							<button
								class="absolute top-1 left-1 bg-white/90 text-gray-700 w-6 h-6 rounded-full opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center shadow text-xs hover:scale-110"
								onclick={(e) => { e.stopPropagation(); previewPoseFull(pose); }}
								title="View full size"
							>🔍</button>
							<!-- Delete -->
							<button
								class="absolute -top-1 -right-1 bg-red-500 text-white w-5 h-5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center shadow text-xs"
								onclick={(e) => { e.stopPropagation(); deletePose(pose.id, pose.name); }}
								title="Delete"
							>×</button>
							<p class="text-xs text-center truncate mt-1">{pose.name}</p>
						</div>
					{/each}
				</div>
			{/if}
		
		<!-- ANIMATIONS TAB -->
		{:else if activeTab === 'animations'}
			<!-- Save button -->
			{#if project.frames.length > 0}
				<button
					class="w-full mb-3 px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 flex items-center justify-center gap-2 text-sm font-medium"
					onclick={saveCurrentAnimation}
				>
					💾 Save Current Animation
				</button>
			{/if}
			
			{#if animations.animations.length === 0}
				<div class="flex items-center justify-center h-64 text-gray-400">
					<div class="text-center">
						<p class="text-4xl mb-2">🎬</p>
						<p class="text-sm">No animations saved yet</p>
						<p class="text-xs mt-1">Generate an animation and save it here</p>
					</div>
				</div>
			{:else}
				<p class="text-xs text-gray-500 mb-2">Click to load • ▶ to preview</p>
				<div class="grid grid-cols-3 gap-3">
					{#each animations.animations as anim}
						<div 
							class="relative group border-2 border-gray-200 rounded-lg overflow-hidden hover:border-green-400 transition-all cursor-pointer bg-gray-50"
							onclick={() => loadAnimation(anim)}
							title="Click to load"
						>
							<div class="aspect-square bg-gray-100 relative">
								{#if previewingAnim?.id === anim.id}
									<img src={anim.frames[previewFrame]} alt="Preview" class="w-full h-full object-contain" />
								{:else if anim.frames?.length > 0}
									<img src={anim.frames[0]} alt={anim.name} class="w-full h-full object-contain" />
								{:else}
									<div class="w-full h-full flex items-center justify-center text-2xl text-gray-400">🎬</div>
								{/if}
								
								<!-- Frame count -->
								<span class="absolute bottom-1 right-1 bg-black/70 text-white text-[9px] px-1.5 rounded">
									{anim.frames?.length || 0}f • {anim.fps || 12}fps
								</span>
								
								<!-- Preview button -->
								<button
									class="absolute top-1 left-1 bg-white/90 text-green-600 w-7 h-7 rounded-full opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center shadow text-sm hover:scale-110"
									onclick={(e) => previewingAnim?.id === anim.id ? (e.stopPropagation(), stopAnimPreview()) : startAnimPreview(anim, e)}
									title={previewingAnim?.id === anim.id ? 'Stop' : 'Preview'}
								>{previewingAnim?.id === anim.id ? '⏹' : '▶'}</button>
								
								<!-- Delete -->
								<button
									class="absolute -top-1 -right-1 bg-red-500 text-white w-5 h-5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center shadow text-xs z-10"
									onclick={(e) => { e.stopPropagation(); deleteAnimation(anim.id, anim.name); }}
									title="Delete"
								>×</button>
							</div>
							<div class="p-2">
								<p class="text-xs font-medium truncate">{anim.name}</p>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		{/if}
	</div>
	
	<!-- Completed Jobs Toggle Button -->
	<button
		class="w-full py-2 px-3 flex items-center justify-between text-sm font-medium transition-colors {showCompletedJobs ? 'bg-purple-100 text-purple-700 hover:bg-purple-200' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}"
		onclick={() => showCompletedJobs = !showCompletedJobs}
	>
		<span class="flex items-center gap-2">
			<span>📦</span>
			<span>Completed Jobs</span>
			{#if completedJobsState.jobs.length > 0}
				<span class="px-1.5 py-0.5 bg-purple-500 text-white text-[10px] rounded-full">{completedJobsState.jobs.length}</span>
			{/if}
		</span>
		<span class="text-xs">{showCompletedJobs ? '▲ Hide' : '▼ Show'}</span>
	</button>
	
	<!-- Job Queue at bottom -->
	<JobQueue />
</div>

<!-- Pose Preview Modal -->
{#if previewingPose}
	<div 
		class="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
		onclick={closePosePreview}
		onkeydown={(e) => { if (e.key === 'Escape') closePosePreview(); }}
		tabindex="0"
		role="dialog"
	>
		<div class="relative max-w-2xl max-h-[90vh]" onclick={(e) => e.stopPropagation()}>
			<button
				onclick={closePosePreview}
				class="absolute -top-10 right-0 text-white hover:text-gray-300 text-2xl"
				title="Close"
			>✕</button>
			<img 
				src={previewingPose.imageData} 
				alt={previewingPose.name}
				class="max-w-full max-h-[80vh] object-contain bg-gray-900 rounded-lg border-2 border-gray-700"
			/>
			<div class="text-center mt-3">
				<p class="text-white font-medium">{previewingPose.name}</p>
				{#if previewingPose.prompt}
					<p class="text-gray-400 text-sm mt-1">"{previewingPose.prompt}"</p>
				{/if}
			</div>
		</div>
	</div>
{/if}

<!-- Asset Preview Modal -->
{#if previewingAsset}
	<div 
		class="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
		onclick={closeAssetPreview}
		onkeydown={(e) => { if (e.key === 'Escape') closeAssetPreview(); }}
		tabindex="0"
		role="dialog"
	>
		<div class="relative max-w-2xl max-h-[90vh]" onclick={(e) => e.stopPropagation()}>
			<button
				onclick={closeAssetPreview}
				class="absolute -top-10 right-0 text-white hover:text-gray-300 text-2xl"
				title="Close"
			>✕</button>
			<img 
				src={previewingAsset.imageData} 
				alt={previewingAsset.name}
				class="max-w-full max-h-[80vh] object-contain bg-gray-900 rounded-lg border-2 border-gray-700"
			/>
			<div class="text-center mt-3">
				<p class="text-white font-medium">{previewingAsset.name}</p>
				{#if previewingAsset.description}
					<p class="text-gray-400 text-sm mt-1">"{previewingAsset.description}"</p>
				{/if}
				{#if previewingAsset.type || previewingAsset.style}
					<p class="text-gray-500 text-xs mt-1">{previewingAsset.type} • {previewingAsset.style}</p>
				{/if}
			</div>
		</div>
	</div>
{/if}

<!-- Save Asset to Category Modal -->
{#if showSaveAssetModal}
	<div 
		class="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
		onclick={cancelSaveAsset}
		onkeydown={(e) => { if (e.key === 'Escape') cancelSaveAsset(); }}
		tabindex="0"
		role="dialog"
	>
		<div class="bg-white rounded-lg p-4 w-80 shadow-xl" onclick={(e) => e.stopPropagation()}>
			<h3 class="text-lg font-bold mb-3">💾 Save Asset</h3>
			
			{#if pendingSpriteToSave}
				<img src={pendingSpriteToSave.image} alt="Preview" class="w-24 h-24 object-contain mx-auto mb-3 rounded border bg-gray-100" />
			{/if}
			
			<div class="mb-3">
				<label class="block text-sm font-medium mb-1">Name</label>
				<input 
					type="text" 
					bind:value={saveAssetName}
					class="w-full px-3 py-2 border rounded text-sm"
					placeholder="Asset name..."
				/>
			</div>
			
			<div class="mb-4">
				<label class="block text-sm font-medium mb-1">Category</label>
				<select bind:value={saveAssetCategory} class="w-full px-3 py-2 border rounded text-sm bg-white">
					{#each assets.categories as cat}
						<option value={cat.id}>{cat.icon} {cat.name}</option>
					{/each}
				</select>
			</div>
			
			<div class="flex gap-2">
				<button
					class="flex-1 px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600 font-medium"
					onclick={saveAssetToCategory}
				>Save</button>
				<button
					class="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
					onclick={cancelSaveAsset}
				>Cancel</button>
			</div>
		</div>
	</div>
{/if}

<!-- New Category Modal -->
{#if showNewCategoryModal}
	<div 
		class="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
		onclick={() => showNewCategoryModal = false}
		onkeydown={(e) => { if (e.key === 'Escape') showNewCategoryModal = false; }}
		tabindex="0"
		role="dialog"
	>
		<div class="bg-white rounded-lg p-4 w-80 shadow-xl" onclick={(e) => e.stopPropagation()}>
			<h3 class="text-lg font-bold mb-3">📁 New Category</h3>
			
			<div class="mb-3">
				<label class="block text-sm font-medium mb-1">Name</label>
				<input 
					type="text" 
					bind:value={newCategoryName}
					class="w-full px-3 py-2 border rounded text-sm"
					placeholder="Category name..."
				/>
			</div>
			
			<div class="mb-4">
				<label class="block text-sm font-medium mb-1">Icon</label>
				<div class="flex flex-wrap gap-1">
					{#each categoryIcons as icon}
						<button
							class="w-8 h-8 rounded border text-lg transition-colors {newCategoryIcon === icon ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'}"
							onclick={() => newCategoryIcon = icon}
						>{icon}</button>
					{/each}
				</div>
			</div>
			
			<div class="flex gap-2">
				<button
					class="flex-1 px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600 font-medium disabled:bg-gray-400"
					onclick={createNewCategory}
					disabled={!newCategoryName.trim()}
				>Create</button>
				<button
					class="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
					onclick={() => showNewCategoryModal = false}
				>Cancel</button>
			</div>
		</div>
	</div>
{/if}

<!-- Hover Preview Bubble -->
{#if hoverPreview && hoverPreview.category}
	<div 
		class="fixed z-50 pointer-events-none"
		style="left: {hoverPreview.x}px; top: {hoverPreview.y}px; transform: translate(-50%, -100%);"
	>
		<div class="bg-white rounded-lg shadow-xl border-2 border-gray-300 p-2 animate-fade-in">
			{#if hoverPreview.category.thumbnail && hoverPreview.category.thumbnail !== 'stored' && hoverPreview.category.thumbnail.startsWith('data:')}
				<img 
					src={hoverPreview.category.thumbnail} 
					alt={hoverPreview.category.name}
					class="w-32 h-32 object-contain bg-gray-100 rounded"
				/>
			{:else}
				<div class="w-32 h-32 flex items-center justify-center bg-gray-100 rounded">
					<span class="text-5xl">{hoverPreview.category.icon}</span>
				</div>
			{/if}
			<p class="text-xs font-medium text-center mt-1 truncate max-w-32">
				{hoverPreview.category.icon} {hoverPreview.category.name}
			</p>
			<p class="text-[10px] text-gray-500 text-center">
				{hoverPreview.category.assets.length} asset{hoverPreview.category.assets.length !== 1 ? 's' : ''}
			</p>
		</div>
		<!-- Arrow pointing down -->
		<div class="w-0 h-0 mx-auto border-l-8 border-r-8 border-t-8 border-l-transparent border-r-transparent border-t-white" style="margin-top: -1px;"></div>
	</div>
{/if}

<style>
	@keyframes fade-in {
		from { opacity: 0; transform: translate(-50%, -90%); }
		to { opacity: 1; transform: translate(-50%, -100%); }
	}
	.animate-fade-in {
		animation: fade-in 0.15s ease-out forwards;
	}
</style>
