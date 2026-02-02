<script>
	import { projectStore } from '$lib/stores/project.js';
	import { saveProject, loadProject, exportProject, importProject } from '$lib/utils/projectSave.js';
	
	let project = $state({ frames: [], fps: 12, projectName: 'Untitled Project', lastSaved: null });
	
	projectStore.subscribe(value => {
		project = value;
	});
	
	let projectName = $state(project.projectName || 'Untitled Project');

	function handleSave() {
		projectStore.update(p => {
			const updated = { ...p, projectName };
			saveProject(updated);
			return updated;
		});
	}

	function handleLoad() {
		const saved = loadProject();
		if (saved) {
			projectStore.set(saved);
			projectName = saved.projectName || 'Untitled Project';
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
			class="px-2 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600"
			onclick={handleSave}
			title="Save"
		>
			💾
		</button>
		<button
			class="px-2 py-1 text-xs bg-gray-500 text-white rounded hover:bg-gray-600"
			onclick={handleLoad}
			title="Load"
		>
			📂
		</button>
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

