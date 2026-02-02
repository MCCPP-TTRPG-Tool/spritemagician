<script>
	import { projectStore } from '$lib/stores/project.js';
	import { saveProject, loadProject, exportProject, importProject } from '$lib/utils/projectSave.js';
	
	let project = $state({ frames: [], fps: 12, projectName: 'Untitled Project', lastSaved: null });
	
	projectStore.subscribe(value => {
		project = value;
	});
	
	let projectName = $state(project.projectName || 'Untitled Project');
	let isSaving = $state(false);
	let isLoading = $state(false);
	let saveMessage = $state('');

	async function handleSave() {
		isSaving = true;
		saveMessage = '';
		try {
			projectStore.update(p => {
				const updated = { ...p, projectName };
				// Save will be async, but update store immediately
				return updated;
			});
			
			const updated = { ...project, projectName };
			const result = await saveProject(updated);
			
			saveMessage = 'Saved!';
			setTimeout(() => { saveMessage = ''; }, 2000);
			
			// Update store with projectId if returned
			if (result.projectId) {
				projectStore.update(p => ({ ...p, projectId: result.projectId, lastSaved: new Date().toISOString() }));
			}
		} catch (error) {
			saveMessage = 'Error: ' + error.message;
			console.error('Save error:', error);
		} finally {
			isSaving = false;
		}
	}

	async function handleLoad() {
		isLoading = true;
		try {
			const saved = await loadProject();
			if (saved) {
				projectStore.set(saved);
				projectName = saved.projectName || 'Untitled Project';
			} else {
				alert('No saved project found');
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
			} catch (error) {
				alert('Failed to import project: ' + error.message);
			}
		}
	}
</script>

<div class="space-y-2">
	<div class="flex items-center gap-2">
		<input
			type="text"
			bind:value={projectName}
			class="flex-1 px-2 py-1 text-sm border border-gray-300 rounded"
			placeholder="Project name"
		/>
		<button
			class="px-2 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
			onclick={handleSave}
			disabled={isSaving}
			title="Save to Firebase"
		>
			{isSaving ? '⏳' : '💾'}
		</button>
		<button
			class="px-2 py-1 text-xs bg-gray-500 text-white rounded hover:bg-gray-600 disabled:opacity-50"
			onclick={handleLoad}
			disabled={isLoading}
			title="Load from Firebase"
		>
			{isLoading ? '⏳' : '📂'}
		</button>
		{#if saveMessage}
			<span class="text-xs text-green-600">{saveMessage}</span>
		{/if}
	</div>
	<div class="flex gap-2">
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

