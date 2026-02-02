<script>
	import { projectStore } from '$lib/stores/project.js';
	
	let isGenerating = $state(false);
	let error = $state(null);
	let generatedSprite = $state(null);
	
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
	
	// Quick presets for common sprites
	const quickPresets = [
		{ name: 'Knight', desc: 'armored medieval knight with sword and shield', type: 'character', style: 'fantasy' },
		{ name: 'Wizard', desc: 'robed wizard with staff and magical aura', type: 'character', style: 'fantasy' },
		{ name: 'Goblin', desc: 'small green goblin with crude weapons', type: 'creature', style: 'fantasy' },
		{ name: 'Dragon', desc: 'fierce dragon with wings and fire breath', type: 'creature', style: 'fantasy' },
		{ name: 'Slime', desc: 'cute bouncy slime monster', type: 'monster', style: 'anime' },
		{ name: 'Sword', desc: 'glowing enchanted sword', type: 'item', style: 'fantasy' },
		{ name: 'Potion', desc: 'magical healing potion in glass bottle', type: 'item', style: 'fantasy' },
		{ name: 'Chest', desc: 'wooden treasure chest', type: 'object', style: 'fantasy' },
		{ name: 'Tree', desc: 'ancient magical tree', type: 'plant', style: 'fantasy' },
		{ name: 'Fireball', desc: 'blazing fireball spell effect', type: 'effect', style: 'fantasy' },
	];
	
	function applyPreset(preset) {
		description = preset.desc;
		subjectType = preset.type;
		artStyle = preset.style;
	}
	
	function buildPrompt() {
		const typeInfo = subjectTypes.find(t => t.id === subjectType);
		const styleInfo = artStyles.find(s => s.id === artStyle);
		const viewInfo = viewAngles.find(v => v.id === viewAngle);
		const detailInfo = detailLevels.find(d => d.id === detailLevel);
		const paletteInfo = colorPalettes.find(p => p.id === colorPalette);
		
		// Special case: HoMM3 style uses a specific prompt format
		if (artStyle === 'homm3') {
			return `Create a pixel art sprite of ${description || typeInfo.name} in the style of Heroes of Might and Magic 3, facing to the right, with a blank background.

Additional details:
- Classic 1990s pixel art aesthetic
- Rich, saturated colors typical of HoMM3
- Detailed but readable at small sizes
- Fantasy RPG creature/character style
- Clean edges, no anti-aliasing blur
- Iconic, memorable silhouette
- White or transparent background ONLY`;
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
		if (!description.trim()) {
			error = 'Please describe what you want to create';
			return;
		}
		
		isGenerating = true;
		error = null;
		generatedSprite = null;
		
		try {
			const prompt = buildPrompt();
			console.log('Generating sprite with prompt:', prompt);
			
			const response = await fetch('/api/generate-sprite', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ prompt })
			});
			
			const data = await response.json();
			
			if (!response.ok) {
				throw new Error(data.error || data.details || 'Generation failed');
			}
			
			generatedSprite = data.image;
			
		} catch (err) {
			error = err.message;
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
		<!-- Quick Presets -->
		<div>
			<p class="text-xs text-gray-500 mb-1">Quick Start:</p>
			<div class="flex flex-wrap gap-1">
				{#each quickPresets.slice(0, 5) as preset}
					<button
						class="px-2 py-0.5 text-[10px] bg-blue-50 text-blue-700 rounded border border-blue-200 hover:bg-blue-100"
						onclick={() => applyPreset(preset)}
					>{preset.name}</button>
				{/each}
			</div>
		</div>

		<!-- Subject Type -->
		<div>
			<p class="text-xs text-gray-500 mb-1">Type:</p>
			<div class="flex flex-wrap gap-1">
				{#each subjectTypes.slice(0, 6) as type}
					<button
						class="px-2 py-0.5 text-[10px] rounded border transition-colors {subjectType === type.id ? 'bg-purple-100 border-purple-400 text-purple-700' : 'bg-gray-50 border-gray-200 hover:border-gray-300'}"
						onclick={() => subjectType = type.id}
					>{type.icon} {type.name}</button>
				{/each}
			</div>
		</div>

		<!-- Style + View Row -->
		<div class="flex gap-2">
			<div class="flex-1">
				<p class="text-xs text-gray-500 mb-1">Style:</p>
				<select bind:value={artStyle} class="w-full px-2 py-1 text-xs border rounded bg-white">
					{#each artStyles as style}
						<option value={style.id}>{style.name}</option>
					{/each}
				</select>
			</div>
			<div class="flex-1">
				<p class="text-xs text-gray-500 mb-1">View:</p>
				<select bind:value={viewAngle} class="w-full px-2 py-1 text-xs border rounded bg-white">
					{#each viewAngles as view}
						<option value={view.id}>{view.name}</option>
					{/each}
				</select>
			</div>
		</div>

		<!-- Detail + Colors Row -->
		<div class="flex gap-2">
			<div class="flex-1">
				<p class="text-xs text-gray-500 mb-1">Detail:</p>
				<select bind:value={detailLevel} class="w-full px-2 py-1 text-xs border rounded bg-white">
					{#each detailLevels as detail}
						<option value={detail.id}>{detail.name}</option>
					{/each}
				</select>
			</div>
			<div class="flex-1">
				<p class="text-xs text-gray-500 mb-1">Colors:</p>
				<select bind:value={colorPalette} class="w-full px-2 py-1 text-xs border rounded bg-white">
					{#each colorPalettes as palette}
						<option value={palette.id}>{palette.name}</option>
					{/each}
				</select>
			</div>
		</div>

		<!-- Description -->
		<div>
			<p class="text-xs text-gray-500 mb-1">Description:</p>
			<textarea
				bind:value={description}
				placeholder="Describe your sprite in detail..."
				rows="2"
				class="w-full px-2 py-1.5 text-xs border rounded resize-none"
			></textarea>
		</div>

		<!-- Generate Button -->
		<button
			class="w-full px-3 py-2 bg-gradient-to-r from-purple-500 to-blue-500 text-white rounded-lg hover:from-purple-600 hover:to-blue-600 disabled:from-gray-400 disabled:to-gray-400 disabled:cursor-not-allowed font-medium"
			onclick={generateSprite}
			disabled={isGenerating || !description.trim()}
		>
			{isGenerating ? '✨ Creating...' : '✨ Create Sprite'}
		</button>

		{#if error}
			<p class="text-xs text-red-600 bg-red-50 px-2 py-1 rounded">{error}</p>
		{/if}
	{/if}
</div>
