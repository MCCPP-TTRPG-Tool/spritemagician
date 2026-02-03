<script>
	import { projectStore } from '$lib/stores/project.js';
	import { jobQueue } from '$lib/stores/jobQueue.js';
	import { completedJobs } from '$lib/stores/completedJobs.js';
	
	let isGenerating = $state(false);
	let error = $state(null);
	let generatedSprite = $state(null);
	let currentJobId = $state(null);
	let showPreviewModal = $state(false);
	
	// Reference image for "generate like X" feature
	let referenceImage = $state(null);
	let fileInput;
	
	function handleFileUpload(event) {
		const file = event.target.files?.[0];
		if (!file) return;
		
		const reader = new FileReader();
		reader.onload = (e) => {
			referenceImage = e.target.result;
		};
		reader.readAsDataURL(file);
	}
	
	function clearReference() {
		referenceImage = null;
		if (fileInput) fileInput.value = '';
	}
	
	function triggerUpload() {
		fileInput?.click();
	}
	
	// === TOOLBOX OPTIONS ===
	
	// Subject Type
	let subjectType = $state('character');
	const subjectTypes = [
		{ id: 'character', name: 'Character', icon: '🧙' },
		{ id: 'creature', name: 'Creature', icon: '🐉' },
		{ id: 'monster', name: 'Monster', icon: '👹' },
		{ id: 'animal', name: 'Animal', icon: '🦊' },
		{ id: 'object', name: 'Object', icon: '⚔️' },
		{ id: 'item', name: 'Item', icon: '💎' },
		{ id: 'building', name: 'Building', icon: '🏰' },
		{ id: 'vehicle', name: 'Vehicle', icon: '🚀' },
		{ id: 'plant', name: 'Plant', icon: '🌳' },
		{ id: 'effect', name: 'Effect/VFX', icon: '✨' },
	];
	
	// Art Style
	let artStyle = $state('fantasy');
	const artStyles = [
		{ id: 'fantasy', name: 'Fantasy RPG' },
		{ id: 'homm3', name: 'HoMM3 Style' },
		{ id: 'pixel', name: 'Pixel Art' },
		{ id: 'anime', name: 'Anime/JRPG' },
		{ id: 'realistic', name: 'Realistic' },
		{ id: 'cartoon', name: 'Cartoon' },
		{ id: 'chibi', name: 'Chibi' },
		{ id: 'dark', name: 'Dark Fantasy' },
		{ id: 'retro', name: 'Retro 16-bit' },
		{ id: 'painterly', name: 'Painterly' },
		{ id: 'minimalist', name: 'Minimalist' },
	];
	
	// View Angle
	let viewAngle = $state('side');
	const viewAngles = [
		{ id: 'side', name: 'Side View' },
		{ id: 'front', name: 'Front View' },
		{ id: 'threequarter', name: '3/4 View' },
		{ id: 'isometric', name: 'Isometric' },
		{ id: 'topdown', name: 'Top-Down' },
	];
	
	// Size/Detail
	let detailLevel = $state('medium');
	const detailLevels = [
		{ id: 'simple', name: 'Simple' },
		{ id: 'medium', name: 'Medium' },
		{ id: 'detailed', name: 'Detailed' },
		{ id: 'complex', name: 'Complex' },
	];
	
	// Color Palette
	let colorPalette = $state('vibrant');
	const colorPalettes = [
		{ id: 'vibrant', name: 'Vibrant' },
		{ id: 'muted', name: 'Muted' },
		{ id: 'dark', name: 'Dark' },
		{ id: 'pastel', name: 'Pastel' },
		{ id: 'monochrome', name: 'Monochrome' },
		{ id: 'warm', name: 'Warm' },
		{ id: 'cool', name: 'Cool' },
		{ id: 'neon', name: 'Neon' },
	];
	
	// Custom Description
	let description = $state('');
	
	// HoMM3 mode toggle
	let homm3Mode = $state(false);
	
	function toggleHoMM3() {
		homm3Mode = !homm3Mode;
		if (homm3Mode) {
			artStyle = 'homm3';
		}
	}
	
	function buildPrompt() {
		const typeInfo = subjectTypes.find(t => t.id === subjectType);
		const styleInfo = artStyles.find(s => s.id === artStyle);
		const viewInfo = viewAngles.find(v => v.id === viewAngle);
		const detailInfo = detailLevels.find(d => d.id === detailLevel);
		const paletteInfo = colorPalettes.find(p => p.id === colorPalette);
		
		// If we have a reference image
		if (referenceImage) {
			const baseDesc = description.trim() || 'the same character';
			
			// HoMM3 mode with reference
			if (artStyle === 'homm3' || homm3Mode) {
				return `Create a pixel art sprite of ${baseDesc} in the style of Heroes of Might and Magic 3, facing to the right, with a blank background. Base it on the reference image provided.`;
			}
			
			// Custom mode with reference
			return `Generate a sprite variation based on the reference image: ${baseDesc}. Keep the same character but apply the requested changes. Clean game sprite, transparent background.`;
		}
		
		// HoMM3 style - EXTREMELY precise prompt for high quality
		if (artStyle === 'homm3' || homm3Mode) {
			return `Create pixel art of ${description || 'a fantasy character'}.

CRITICAL STYLE REQUIREMENTS:
- Style: Heroes of Might and Magic 3, late 1990s PC game art
- Resolution: High pixel density with HUNDREDS of tiny pixels, NOT chunky 16-bit style
- Shading: Complex multi-step color gradients, rich shadows and highlights
- Colors: 32+ color palette, vibrant and saturated, smooth color transitions
- Details: Intricate textures visible (fabric weave, metal scratches, skin pores)
- Outlines: Clean dark outlines defining shapes
- Quality: Professional game studio quality, museum-worthy pixel craftsmanship

DO NOT:
- Use chunky/blocky large pixels
- Use flat colors without shading
- Make it look like 8-bit or 16-bit retro games
- Use limited color palettes
- Make it look amateur or simple

Background: Transparent/none
View: Side view facing right, full body visible`;
		}
		
		// Build aggressive view-specific instructions
		let viewInstructions = '';
		switch (viewAngle) {
			case 'isometric':
				viewInstructions = `⚠️ MANDATORY ISOMETRIC VIEW - THIS IS THE MOST IMPORTANT REQUIREMENT ⚠️

ISOMETRIC CAMERA SETUP:
- Camera angle: 30-45 degrees from above, looking DOWN at the subject
- You MUST see the TOP of the object (roof, head top, upper surface)
- You MUST see TWO SIDES of the object simultaneously (front-right and front-left)
- The object has visible HEIGHT, WIDTH, and DEPTH - it looks 3D

VISUAL REFERENCE - Think of these games:
- Diablo 1 & 2 (classic isometric RPG)
- Age of Empires / StarCraft buildings
- SimCity / Cities Skylines buildings  
- Clash of Clans / mobile strategy games
- Pokemon stadium overworld

WHAT ISOMETRIC LOOKS LIKE:
- A cube would show 3 faces (top + 2 sides)
- The "ground" is a diamond/rhombus shape, not a horizontal line
- Vertical lines stay vertical, horizontal lines angle at 30 degrees
- Objects have visible depth and appear 3-dimensional

❌ WRONG - DO NOT DO THESE:
- Side view (seeing only one side, no top visible)
- Front view (flat, facing camera directly)
- Top-down view (only seeing the top, no sides)
- 2D flat sprite with no depth

✅ CORRECT:
- Bird's eye view angled downward
- Can see the top AND two adjacent sides
- Appears 3-dimensional with depth`;
				break;
			case 'front':
				viewInstructions = `CRITICAL VIEW REQUIREMENT - FRONT VIEW:
- Object faces DIRECTLY toward the camera
- Perfectly symmetrical left-to-right
- No rotation or angle - pure frontal view
- Like a character select screen portrait`;
				break;
			case 'threequarter':
				viewInstructions = `CRITICAL VIEW REQUIREMENT - 3/4 VIEW:
- Object is rotated 45 degrees from front
- You can see the front AND one side
- Classic RPG character view
- Slight depth visible, not flat`;
				break;
			case 'topdown':
				viewInstructions = `CRITICAL VIEW REQUIREMENT - TOP-DOWN VIEW:
- Camera is DIRECTLY above looking straight DOWN
- You see the TOP of the object only
- Like looking at a map or board game piece from above
- No sides visible, only the top surface`;
				break;
			default: // side
				viewInstructions = `CRITICAL VIEW REQUIREMENT - SIDE VIEW:
- Pure profile view, object facing RIGHT
- Flat 2D side perspective
- Like a classic platformer sprite
- No depth or 3D angle`;
		}
		
		// For isometric, put the view requirement FIRST and make it prominent
		let prompt;
		if (viewAngle === 'isometric') {
			prompt = `${viewInstructions}

NOW CREATE: An isometric game sprite of "${description || typeInfo.name}"

STYLE: ${styleInfo.name} style, ${detailInfo.name} detail, ${paletteInfo.name} colors

REQUIREMENTS:
- Isometric 3D perspective (see top + two sides)
- Clean game asset quality
- Centered, full object visible
- Plain white/transparent background
- No ground shadows, no scenery, no text

Remember: ISOMETRIC means you can see the TOP of the object and TWO SIDES. Like Diablo or Age of Empires buildings.`;
		} else {
			prompt = `Create a 2D game sprite: ${description || typeInfo.name}

${viewInstructions}

STYLE REQUIREMENTS:
- Art style: ${styleInfo.name}
- Detail level: ${detailInfo.name}
- Color palette: ${paletteInfo.name} colors
- Type: Game ${typeInfo.name.toLowerCase()} sprite

TECHNICAL REQUIREMENTS:
- Clean lines and clear silhouette
- Game asset quality
- Centered composition
- Full ${typeInfo.name.toLowerCase()} visible in frame
- Plain white or transparent background ONLY
- No ground, no shadows on ground, no scenery
- No text or labels
- Consistent lighting from top-left
- Ready for game engine use

The sprite should look professional and suitable for a 2D video game. Remember: THE VIEW ANGLE IS CRITICAL - follow the view instructions exactly.`;
		}

		return prompt;
	}
	
	async function generateSprite() {
		if (!description.trim() && !referenceImage) {
			error = 'Please describe what you want to create or upload a reference image';
			return;
		}
		
		isGenerating = true;
		error = null;
		generatedSprite = null;
		
		// Add job to queue
		const jobName = description.substring(0, 30) || 'Sprite';
		currentJobId = jobQueue.addJob({
			type: '✨ Sprite',
			name: jobName + (description.length > 30 ? '...' : ''),
			status: 'processing',
			message: 'Generating sprite...'
		});
		
		try {
			const prompt = buildPrompt();
			console.log('Generating sprite with prompt:', prompt);
			console.log('Reference image:', referenceImage ? 'provided' : 'none');
			
			const response = await fetch('/api/generate-sprite', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ 
					prompt,
					referenceImage: referenceImage || null
				})
			});
			
			const data = await response.json();
			
			if (!response.ok) {
				throw new Error(data.error || data.details || 'Generation failed');
			}
			
			generatedSprite = data.image;
			
			// Add to completed jobs for user to review
			await completedJobs.addSprite({
				name: description.substring(0, 30) || 'Sprite',
				image: data.image,
				description: description
			});
			
			// Mark job complete
			if (currentJobId) {
				jobQueue.completeJob(currentJobId);
			}
			
		} catch (err) {
			error = err.message;
			// Mark job failed
			if (currentJobId) {
				jobQueue.failJob(currentJobId, err.message);
			}
		} finally {
			isGenerating = false;
		}
	}
	
	function useAsReference() {
		if (generatedSprite) {
			projectStore.update(p => ({ ...p, firstFrame: generatedSprite }));
			// Dispatch event to switch to animation tab
			if (typeof window !== 'undefined') {
				window.dispatchEvent(new CustomEvent('spriteCreated', { detail: { image: generatedSprite } }));
			}
		}
	}
	
	function saveToGallery() {
		if (generatedSprite && typeof window !== 'undefined') {
			window.dispatchEvent(new CustomEvent('saveSpriteToGallery', { 
				detail: { 
					image: generatedSprite, 
					description: description,
					type: subjectType,
					style: artStyle
				} 
			}));
		}
	}
	
	function downloadSprite() {
		if (!generatedSprite) return;
		const link = document.createElement('a');
		link.href = generatedSprite;
		link.download = `sprite-${Date.now()}.png`;
		link.click();
	}
	
	function saveSprite() {
		if (generatedSprite && typeof window !== 'undefined') {
			window.dispatchEvent(new CustomEvent('saveSpriteToGallery', { 
				detail: { 
					image: generatedSprite, 
					description: description,
					type: subjectType,
					style: artStyle
				} 
			}));
		}
	}
	
	function discardSprite() {
		generatedSprite = null;
	}
</script>

<div class="space-y-3 text-sm">
	<!-- Generated Sprite Preview -->
	{#if generatedSprite}
		<div class="relative w-3/4 mx-auto mb-3">
			<img src={generatedSprite} alt="Generated sprite" class="w-full aspect-square object-contain rounded-lg border-2 border-green-400 bg-gray-100" />
			<!-- Full size preview button -->
			<button
				class="absolute top-2 right-2 px-2 py-1 bg-black/70 text-white text-xs rounded hover:bg-black/90"
				onclick={() => showPreviewModal = true}
			>🔍 Full Size</button>
		</div>
		<div class="grid grid-cols-3 gap-2 mb-2">
			<button
				class="px-2 py-1.5 text-xs bg-blue-500 text-white rounded hover:bg-blue-600"
				onclick={useAsReference}
			>🎬 Animate</button>
			<button
				class="px-2 py-1.5 text-xs bg-green-500 text-white rounded hover:bg-green-600"
				onclick={saveSprite}
			>💾 Save</button>
			<button
				class="px-2 py-1.5 text-xs bg-purple-500 text-white rounded hover:bg-purple-600"
				onclick={downloadSprite}
			>📥 Download</button>
		</div>
		<button
			class="w-full px-2 py-1 text-xs bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
			onclick={discardSprite}
		>✨ Create Another</button>
	{:else}
		<!-- Hidden file input -->
		<input 
			type="file" 
			accept="image/*" 
			class="hidden" 
			bind:this={fileInput}
			onchange={handleFileUpload}
		/>
		
		<!-- Reference Image Upload -->
		<div class="border-2 border-dashed border-gray-300 rounded-lg p-2 bg-gray-50">
			{#if referenceImage}
				<div class="flex items-center gap-2">
					<img src={referenceImage} alt="Reference" class="w-16 h-16 object-contain rounded border bg-white" />
					<div class="flex-1">
						<p class="text-xs font-medium text-green-700">📎 Reference uploaded</p>
						<p class="text-[10px] text-gray-500">Describe how to modify it below</p>
					</div>
					<button
						class="px-2 py-1 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200"
						onclick={clearReference}
					>✕</button>
				</div>
			{:else}
				<button
					class="w-full flex items-center justify-center gap-2 py-2 text-xs text-gray-600 hover:text-purple-600 hover:bg-purple-50 rounded transition-colors"
					onclick={triggerUpload}
				>
					<span class="text-lg">📤</span>
					<span>Upload reference image (optional)</span>
				</button>
				<p class="text-[10px] text-gray-400 text-center mt-1">Upload a character/sprite to generate variations</p>
			{/if}
		</div>

		<!-- HoMM3 Mode Toggle -->
		<button
			class="w-full py-2 px-3 rounded-lg border-2 font-medium text-sm transition-all {homm3Mode 
				? 'bg-amber-100 border-amber-400 text-amber-800' 
				: 'bg-gray-50 border-gray-300 text-gray-600 hover:border-amber-300'}"
			onclick={toggleHoMM3}
		>
			{#if homm3Mode}
				⚔️ HoMM3 Style ACTIVE
			{:else}
				⚔️ Enable HoMM3 Style
			{/if}
		</button>
		
		{#if homm3Mode}
			<div class="bg-amber-50 border border-amber-200 rounded p-2 text-[10px] text-amber-700">
				Prompt: "Create a pixel art sprite of <span class="font-bold">[your description]</span> in the style of Heroes of Might and Magic 3, facing to the right, with a blank background."
			</div>
		{/if}

		<!-- Description -->
		<div>
			<p class="text-xs text-gray-500 mb-1">{referenceImage ? 'Modification:' : 'Character Description:'}</p>
			<textarea
				bind:value={description}
				placeholder={homm3Mode 
					? "e.g., 'a skeleton warrior', 'a fire elemental', 'a green dragon'..." 
					: "Describe your sprite in detail..."}
				rows="3"
				class="w-full px-2 py-1.5 text-xs border rounded resize-none"
			></textarea>
		</div>
		
		{#if !homm3Mode}
			<!-- Advanced Options (only when NOT in HoMM3 mode) -->
			<details class="text-xs">
				<summary class="cursor-pointer text-gray-500 hover:text-gray-700">Advanced Options</summary>
				<div class="mt-2 space-y-2 p-2 bg-gray-50 rounded">
					<div class="flex gap-2">
						<div class="flex-1">
							<p class="text-gray-500 mb-1">Style:</p>
							<select bind:value={artStyle} class="w-full px-2 py-1 text-xs border rounded bg-white">
								{#each artStyles as style}
									<option value={style.id}>{style.name}</option>
								{/each}
							</select>
						</div>
						<div class="flex-1">
							<p class="text-gray-500 mb-1">View:</p>
							<select bind:value={viewAngle} class="w-full px-2 py-1 text-xs border rounded bg-white">
								{#each viewAngles as view}
									<option value={view.id}>{view.name}</option>
								{/each}
							</select>
						</div>
					</div>
				</div>
			</details>
		{/if}

		<!-- Generate Button -->
		<button
			class="w-full px-3 py-2 bg-gradient-to-r from-purple-500 to-blue-500 text-white rounded-lg hover:from-purple-600 hover:to-blue-600 disabled:from-gray-400 disabled:to-gray-400 disabled:cursor-not-allowed font-medium"
			onclick={generateSprite}
			disabled={isGenerating || (!description.trim() && !referenceImage)}
		>
			{#if isGenerating}
				✨ Creating...
			{:else if referenceImage}
				✨ Generate Variation
			{:else}
				✨ Create Sprite
			{/if}
		</button>

		{#if error}
			<p class="text-xs text-red-600 bg-red-50 px-2 py-1 rounded">{error}</p>
		{/if}
	{/if}
</div>

<!-- Full Size Preview Modal -->
{#if showPreviewModal && generatedSprite}
	<div
		class="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-4"
		onclick={() => showPreviewModal = false}
		onkeydown={(e) => { if (e.key === 'Escape') showPreviewModal = false; }}
		tabindex="0"
		role="dialog"
	>
		<div class="relative max-w-4xl max-h-[90vh]" onclick={(e) => e.stopPropagation()}>
			<button
				onclick={() => showPreviewModal = false}
				class="absolute -top-10 right-0 text-white hover:text-gray-300 text-2xl font-bold"
				title="Close (ESC)"
			>✕</button>
			<img 
				src={generatedSprite} 
				alt="Full size preview"
				class="max-w-full max-h-[85vh] object-contain rounded-lg"
				style="image-rendering: pixelated;"
			/>
			<div class="flex justify-center gap-3 mt-4">
				<button
					class="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
					onclick={useAsReference}
				>🎬 Animate</button>
				<button
					class="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600"
					onclick={saveSprite}
				>💾 Save</button>
				<button
					class="px-4 py-2 bg-purple-500 text-white rounded-lg hover:bg-purple-600"
					onclick={downloadSprite}
				>📥 Download</button>
			</div>
		</div>
	</div>
{/if}
