/**
 * Saves project data to localStorage
 */
export function saveProject(project) {
	const projectData = {
		...project,
		lastSaved: new Date().toISOString()
	};
	localStorage.setItem('spriteMagician_project', JSON.stringify(projectData));
	return projectData;
}

/**
 * Loads project data from localStorage
 */
export function loadProject() {
	const data = localStorage.getItem('spriteMagician_project');
	if (data) {
		return JSON.parse(data);
	}
	return null;
}

/**
 * Exports project as JSON file
 */
export function exportProject(project) {
	const projectData = {
		...project,
		lastSaved: new Date().toISOString()
	};
	const blob = new Blob([JSON.stringify(projectData, null, 2)], { type: 'application/json' });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = `${project.projectName || 'project'}.json`;
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	URL.revokeObjectURL(url);
}

/**
 * Imports project from JSON file
 */
export function importProject(file) {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = (e) => {
			try {
				const project = JSON.parse(e.target.result);
				resolve(project);
			} catch (error) {
				reject(new Error('Invalid project file'));
			}
		};
		reader.onerror = () => reject(new Error('Failed to read file'));
		reader.readAsText(file);
	});
}

