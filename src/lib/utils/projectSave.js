/**
 * Saves project data to Firebase Storage
 * Includes all frames - stored in Firebase Storage, not localStorage
 */
export async function saveProject(project) {
	try {
		const response = await fetch('/api/save-project', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({ project })
		});

		if (!response.ok) {
			const error = await response.json();
			throw new Error(error.error || 'Failed to save project');
		}

		const result = await response.json();
		
		// Store projectId in localStorage for quick access
		if (result.projectId) {
			localStorage.setItem('spriteMagician_lastProjectId', result.projectId);
		}

		return result;
	} catch (error) {
		console.error('Save project error:', error);
		throw error;
	}
}

/**
 * Loads project data from Firebase Storage
 * @param {string} projectId - Optional project ID. If not provided, loads the last saved project.
 */
export async function loadProject(projectId = null) {
	try {
		// If no projectId provided, try to get the last saved one
		if (!projectId) {
			projectId = localStorage.getItem('spriteMagician_lastProjectId');
		}

		if (!projectId) {
			return null;
		}

		const response = await fetch(`/api/load-project?projectId=${encodeURIComponent(projectId)}`);

		if (!response.ok) {
			if (response.status === 404) {
				return null; // Project not found
			}
			const error = await response.json();
			throw new Error(error.error || 'Failed to load project');
		}

		const project = await response.json();
		return project;
	} catch (error) {
		console.error('Load project error:', error);
		return null;
	}
}

/**
 * Lists all saved projects from Firebase
 */
export async function listProjects() {
	try {
		const response = await fetch('/api/load-project', {
			method: 'POST'
		});

		if (!response.ok) {
			const error = await response.json();
			throw new Error(error.error || 'Failed to list projects');
		}

		const data = await response.json();
		return data.projects || [];
	} catch (error) {
		console.error('List projects error:', error);
		return [];
	}
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

