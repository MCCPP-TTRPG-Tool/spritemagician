<script>
	import GenerationPanel from '$lib/components/GenerationPanel.svelte';
	import PoseGenerator from '$lib/components/PoseGenerator.svelte';
	import SpriteGenerator from '$lib/components/SpriteGenerator.svelte';
	import CenterPanel from '$lib/components/CenterPanel.svelte';
	import AnimationPreview from '$lib/components/AnimationPreview.svelte';
	import ExportPanel from '$lib/components/ExportPanel.svelte';
	import ProjectManager from '$lib/components/ProjectManager.svelte';
	import PoseVisualizer from '$lib/components/PoseVisualizer.svelte';
	import ReplicateTest from '$lib/components/ReplicateTest.svelte';
	
	let showDevTools = $state(false);
	let activeTab = $state('create'); // 'create', 'animation', or 'poses'
</script>

<div class="h-screen bg-gray-50 overflow-hidden flex flex-col">
	<header class="px-4 py-2 border-b bg-white flex items-center justify-between">
		<h1 class="text-xl font-bold text-gray-900">Sprite Magician</h1>
		<button 
			class="text-xs px-2 py-1 bg-gray-200 hover:bg-gray-300 rounded"
			onclick={() => showDevTools = !showDevTools}
		>
			{showDevTools ? 'Hide' : 'Show'} Dev Tools
		</button>
	</header>

	<div class="flex-1 grid gap-2 p-2 overflow-hidden" class:grid-cols-3={!showDevTools} class:grid-cols-4={showDevTools}>
		<!-- Left Column: Project & Generation/Poses -->
		<div class="flex flex-col gap-2 overflow-hidden">
			<div class="bg-white rounded shadow p-3 flex-shrink-0">
				<ProjectManager />
			</div>
			
			<!-- Tab Selector -->
			<div class="bg-white rounded shadow flex-1 overflow-hidden flex flex-col min-h-0">
				<div class="flex border-b">
					<button
						class="flex-1 px-2 py-2 text-xs font-medium transition-colors {activeTab === 'create' ? 'bg-green-50 text-green-600 border-b-2 border-green-600' : 'text-gray-600 hover:bg-gray-50'}"
						onclick={() => activeTab = 'create'}
					>
						✨ Create
					</button>
					<button
						class="flex-1 px-2 py-2 text-xs font-medium transition-colors {activeTab === 'animation' ? 'bg-blue-50 text-blue-600 border-b-2 border-blue-600' : 'text-gray-600 hover:bg-gray-50'}"
						onclick={() => activeTab = 'animation'}
					>
						🎬 Animate
					</button>
					<button
						class="flex-1 px-2 py-2 text-xs font-medium transition-colors {activeTab === 'poses' ? 'bg-purple-50 text-purple-600 border-b-2 border-purple-600' : 'text-gray-600 hover:bg-gray-50'}"
						onclick={() => activeTab = 'poses'}
					>
						🎭 Poses
					</button>
				</div>
				
				<div class="p-3 flex-1 overflow-y-auto">
					{#if activeTab === 'create'}
						<SpriteGenerator />
					{:else if activeTab === 'animation'}
						<GenerationPanel />
					{:else}
						<PoseGenerator />
					{/if}
				</div>
			</div>
		</div>

		<!-- Middle Column: Frames / Poses / Animations -->
		<div class="bg-white rounded shadow p-3 overflow-hidden">
			<CenterPanel />
		</div>

		<!-- Right Column: Preview & Export -->
		<div class="flex flex-col gap-2 overflow-hidden">
			<div class="bg-white rounded shadow p-3 flex-1 overflow-y-auto">
				<AnimationPreview />
			</div>
			<div class="bg-white rounded shadow p-3 flex-shrink-0">
				<ExportPanel />
			</div>
		</div>

		<!-- Dev Tools Column (collapsible) -->
		{#if showDevTools}
			<div class="flex flex-col gap-2 overflow-y-auto">
				<PoseVisualizer />
				<ReplicateTest />
			</div>
		{/if}
	</div>
</div>
