<script>
	import { projectStore } from '$lib/stores/project.js';
	import { saveProject, loadProject, listProjects, exportProject, importProject } from '$lib/utils/projectSave.js';
	import { browser } from '$app/environment';
	
	let project = $state({ frames: [], fps: 12, projectName: 'Untitled Project', lastSaved: null });
	
	projectStore.subscribe(value => {
		project = value;
	});
	
	let projectName = $state('Untitled Project');
	let isSaving = $state(false);
	let isLoading = $state(false);
	let saveMessage = $state('');
	let savedProjects = $state([]);
	let showProjectList = $state(false);
	
	// Update projectName when project changes
	$effect(() => {
		projectName = project.projectName || 'Untitled Project';
	});
	
	// Load project list on mount
	$effect(() => {
		if (browser && showProjectList && savedProjects.length === 0) {
			loadProjectList();
		}
	});
	
	async function loadProjectList() {
		try {
			savedProjects = await listProjects();
		} catch (e) {
			console.error('Failed to load project list:', e);
		}
	}

	async function handleSave() {
		isSaving = true;
		saveMessage = '';
		try {
			const updated = { ...project, projectName };
			projectStore.update(p => ({ ...p, projectName }));
			
			const result = await saveProject(updated);
			
			saveMessage = '✓ Saved!';
			setTimeout(() => { saveMessage = ''; }, 2000);
			
			if (result.projectId) {
				projectStore.update(p => ({ 
					...p, 
					projectId: result.projectId, 
					lastSaved: new Date().toISOString() 
				}));
			}
			
			// Refresh project list
			if (showProjectList) {
				await loadProjectList();
			}
		} catch (error) {
			saveMessage = '✗ ' + error.message;
			console.error('Save error:', error);
		} finally {
			isSaving = false;
		}
	}

	async function handleLoadProject(projectId) {
		isLoading = true;
		try {
			const saved = await loadProject(projectId);
			if (saved) {
				projectStore.set(saved);
				projectName = saved.projectName || 'Untitled Project';
				showProjectList = false;
				saveMessage = '✓ Loaded!';
				setTimeout(() => { saveMessage = ''; }, 2000);
			} else {
				alert('Project not found');
			}
		} catch (error) {
			alert('Failed to load project: ' + error.message);
			console.error('Load error:', error);
		} finally {
			isLoading = false;
		}
	}

	function handleExport() {
		exportProject({ ...project, projectName });
	}

	async function handleImport(event) {
		const file = event.target.files?.[0];
		if (file) {
			try {
				const imported = await importProject(file);
				projectStore.set(imported);
				projectName = imported.projectName || 'Untitled Project';
				saveMessage = '✓ Imported!';
				setTimeout(() => { saveMessage = ''; }, 2000);
			} catch (error) {
				alert('Failed to import project: ' + error.message);
			}
		}
		event.target.value = '';
	}
	
	function toggleProjectList() {
		showProjectList = !showProjectList;
		if (showProjectList && savedProjects.length === 0) {
			loadProjectList();
		}
	}
	
	function newProject() {
		if (project.frames.length > 0) {
			if (!confirm('Start a new project? Unsaved changes will be lost.')) {
				return;
			}
		}
		projectStore.set({
			frames: [],
			fps: 12,
			prompt: '',
			firstFrame: null,
			lastFrame: null,
			generationMode: 'prompt',
			frameCount: 8,
			duration: null,
			projectName: 'Untitled Project',
			lastSaved: null,
			projectId: null
		});
		projectName = 'Untitled Project';
	}
</script>

<div class="space-y-2">
	<!-- Project Name and Actions -->
	<div class="flex items-center gap-2">
		<input
			type="text"
			bind:value={projectName}
			class="flex-1 px-2 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
			placeholder="Project name"
		/>
		<button
			class="px-2 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
			onclick={handleSave}
			disabled={isSaving}
			title="Save project"
		>
			{isSaving ? '⏳' : '💾'}
		</button>
		<button
			class="px-2 py-1 text-xs bg-gray-500 text-white rounded hover:bg-gray-600"
			onclick={toggleProjectList}
			title="Load project"
		>
			📂
		</button>
	</div>
	
	{#if saveMessage}
		<p class="text-xs {saveMessage.startsWith('✓') ? 'text-green-600' : 'text-red-600'}">{saveMessage}</p>
	{/if}
	
	<!-- Project List -->
	{#if showProjectList}
		<div class="bg-gray-50 border rounded p-2 space-y-2 max-h-48 overflow-y-auto">
			<div class="flex items-center justify-between">
				<span class="text-xs font-medium text-gray-600">Saved Projects</span>
				<button
					class="text-xs text-blue-600 hover:underline"
					onclick={loadProjectList}
				>
					Refresh
				</button>
			</div>
			
			{#if savedProjects.length === 0}
				<p class="text-xs text-gray-500 text-center py-2">No saved projects</p>
			{:else}
				{#each savedProjects as proj}
					<button
						class="w-full text-left px-2 py-1.5 text-xs bg-white border rounded hover:bg-blue-50 hover:border-blue-300 transition-colors"
						onclick={() => handleLoadProject(proj.projectId)}
						disabled={isLoading}
					>
						<div class="font-medium truncate">{proj.projectName}</div>
						<div class="text-gray-500">{proj.frameCount} frames • {new Date(proj.lastSaved).toLocaleDateString()}</div>
					</button>
				{/each}
			{/if}
		</div>
	{/if}
	
	<!-- Secondary Actions -->
	<div class="flex gap-2">
		<button
			class="flex-1 px-2 py-1 text-xs bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
			onclick={newProject}
		>
			+ New
		</button>
		<button
			class="flex-1 px-2 py-1 text-xs bg-green-500 text-white rounded hover:bg-green-600"
			onclick={handleExport}
		>
			Export
		</button>
		<label class="flex-1 px-2 py-1 text-xs bg-purple-500 text-white rounded hover:bg-purple-600 text-center cursor-pointer">
			Import
			<input type="file" accept=".json" class="hidden" onchange={handleImport} />
		</label>
	</div>
</div>
