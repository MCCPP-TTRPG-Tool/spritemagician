import { writable, get } from 'svelte/store';
import { browser } from '$app/environment';

const STORAGE_KEY = 'spritemagician_assets_meta';
const DB_NAME = 'spritemagician_db';
const STORE_NAME = 'assets';

// Default stock categories
const DEFAULT_CATEGORIES = [
	{ id: 'characters', name: 'Characters', icon: '🧙' },
	{ id: 'creatures', name: 'Creatures', icon: '🐉' },
	{ id: 'items', name: 'Items', icon: '⚔️' },
	{ id: 'scenery', name: 'Scenery', icon: '🏔️' },
	{ id: 'effects', name: 'Effects', icon: '✨' },
	{ id: 'props', name: 'Props', icon: '🪑' },
	{ id: 'ui', name: 'UI Elements', icon: '🎯' },
];

// IndexedDB helper functions
let db = null;

async function openDB() {
	if (db) return db;
	
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, 1);
		
		request.onerror = () => reject(request.error);
		request.onsuccess = () => {
			db = request.result;
			resolve(db);
		};
		
		request.onupgradeneeded = (event) => {
			const database = event.target.result;
			if (!database.objectStoreNames.contains(STORE_NAME)) {
				database.createObjectStore(STORE_NAME, { keyPath: 'id' });
			}
		};
	});
}

async function saveImageToDB(id, imageData) {
	try {
		const database = await openDB();
		return new Promise((resolve, reject) => {
			const transaction = database.transaction([STORE_NAME], 'readwrite');
			const store = transaction.objectStore(STORE_NAME);
			const request = store.put({ id, imageData });
			request.onsuccess = () => resolve();
			request.onerror = () => reject(request.error);
		});
	} catch (e) {
		console.error('Failed to save image to IndexedDB:', e);
	}
}

async function getImageFromDB(id) {
	try {
		const database = await openDB();
		return new Promise((resolve, reject) => {
			const transaction = database.transaction([STORE_NAME], 'readonly');
			const store = transaction.objectStore(STORE_NAME);
			const request = store.get(id);
			request.onsuccess = () => resolve(request.result?.imageData || null);
			request.onerror = () => reject(request.error);
		});
	} catch (e) {
		console.error('Failed to get image from IndexedDB:', e);
		return null;
	}
}

async function deleteImageFromDB(id) {
	try {
		const database = await openDB();
		return new Promise((resolve, reject) => {
			const transaction = database.transaction([STORE_NAME], 'readwrite');
			const store = transaction.objectStore(STORE_NAME);
			const request = store.delete(id);
			request.onsuccess = () => resolve();
			request.onerror = () => reject(request.error);
		});
	} catch (e) {
		console.error('Failed to delete image from IndexedDB:', e);
	}
}

function createAssetStore() {
	// Load metadata from localStorage
	let initialState = {
		categories: DEFAULT_CATEGORIES.map(cat => ({ ...cat, assets: [], thumbnail: null })),
	};
	
	if (browser) {
		try {
			const saved = localStorage.getItem(STORAGE_KEY);
			if (saved) {
				const parsed = JSON.parse(saved);
				const existingIds = parsed.categories.map(c => c.id);
				DEFAULT_CATEGORIES.forEach(defaultCat => {
					if (!existingIds.includes(defaultCat.id)) {
						parsed.categories.push({ ...defaultCat, assets: [], thumbnail: null });
					}
				});
				initialState = parsed;
			}
		} catch (e) {
			console.error('Failed to load assets metadata:', e);
		}
	}
	
	const { subscribe, set, update } = writable(initialState);
	
	// Save metadata (not images) to localStorage
	function saveMetadata(value) {
		if (!browser) return;
		try {
			// Create a copy without image data for localStorage
			const metaOnly = {
				categories: value.categories.map(cat => ({
					...cat,
					thumbnail: cat.thumbnail ? 'stored' : null, // Just mark that thumbnail exists
					assets: cat.assets.map(asset => ({
						...asset,
						imageData: 'stored' // Just mark that image exists
					}))
				}))
			};
			localStorage.setItem(STORAGE_KEY, JSON.stringify(metaOnly));
		} catch (e) {
			console.error('Failed to save metadata:', e);
		}
	}
	
	// Load images from IndexedDB when needed
	async function loadImages() {
		if (!browser) return;
		
		const current = get({ subscribe });
		let updated = false;
		
		for (const cat of current.categories) {
			// Load thumbnail
			if (cat.thumbnail === 'stored') {
				const thumb = await getImageFromDB(`thumb_${cat.id}`);
				if (thumb) {
					cat.thumbnail = thumb;
					updated = true;
				}
			}
			
			// Load asset images
			for (const asset of cat.assets) {
				if (asset.imageData === 'stored') {
					const img = await getImageFromDB(asset.id);
					if (img) {
						asset.imageData = img;
						updated = true;
					}
				}
			}
		}
		
		if (updated) {
			set(current);
		}
	}
	
	// Initialize - load images from IndexedDB
	if (browser) {
		loadImages();
	}
	
	return {
		subscribe,
		
		addCategory: (name, icon = '📁') => {
			update(s => {
				const id = `custom-${Date.now()}`;
				const newState = {
					...s,
					categories: [...s.categories, { id, name, icon, assets: [], thumbnail: null }]
				};
				saveMetadata(newState);
				return newState;
			});
		},
		
		removeCategory: (categoryId) => {
			update(s => {
				// Delete images from IndexedDB
				const cat = s.categories.find(c => c.id === categoryId);
				if (cat) {
					cat.assets.forEach(asset => deleteImageFromDB(asset.id));
					deleteImageFromDB(`thumb_${categoryId}`);
				}
				
				const newState = {
					...s,
					categories: s.categories.filter(c => c.id !== categoryId)
				};
				saveMetadata(newState);
				return newState;
			});
		},
		
		renameCategory: (categoryId, newName) => {
			update(s => {
				const newState = {
					...s,
					categories: s.categories.map(c => 
						c.id === categoryId ? { ...c, name: newName } : c
					)
				};
				saveMetadata(newState);
				return newState;
			});
		},
		
		setCategoryIcon: (categoryId, icon) => {
			update(s => {
				const newState = {
					...s,
					categories: s.categories.map(c => 
						c.id === categoryId ? { ...c, icon } : c
					)
				};
				saveMetadata(newState);
				return newState;
			});
		},
		
		setCategoryThumbnail: (categoryId, imageData) => {
			// Save to IndexedDB
			saveImageToDB(`thumb_${categoryId}`, imageData);
			
			update(s => {
				const newState = {
					...s,
					categories: s.categories.map(c => 
						c.id === categoryId ? { ...c, thumbnail: imageData } : c
					)
				};
				saveMetadata(newState);
				return newState;
			});
		},
		
		addAsset: (categoryId, asset) => {
			const assetId = `asset-${Date.now()}`;
			const newAsset = {
				id: assetId,
				createdAt: Date.now(),
				...asset
			};
			
			// Save image to IndexedDB
			saveImageToDB(assetId, asset.imageData);
			
			update(s => {
				const newState = {
					...s,
					categories: s.categories.map(c => {
						if (c.id === categoryId) {
							const newAssets = [...c.assets, newAsset];
							const thumbnail = c.thumbnail || newAsset.imageData;
							
							// Save thumbnail if it's the first asset
							if (!c.thumbnail) {
								saveImageToDB(`thumb_${categoryId}`, thumbnail);
							}
							
							return { ...c, assets: newAssets, thumbnail };
						}
						return c;
					})
				};
				saveMetadata(newState);
				return newState;
			});
		},
		
		removeAsset: (categoryId, assetId) => {
			// Delete from IndexedDB
			deleteImageFromDB(assetId);
			
			update(s => {
				const newState = {
					...s,
					categories: s.categories.map(c => {
						if (c.id === categoryId) {
							const removedAsset = c.assets.find(a => a.id === assetId);
							const newAssets = c.assets.filter(a => a.id !== assetId);
							
							let thumbnail = c.thumbnail;
							if (removedAsset && c.thumbnail === removedAsset.imageData) {
								thumbnail = newAssets.length > 0 ? newAssets[0].imageData : null;
								if (thumbnail) {
									saveImageToDB(`thumb_${categoryId}`, thumbnail);
								}
							}
							
							return { ...c, assets: newAssets, thumbnail };
						}
						return c;
					})
				};
				saveMetadata(newState);
				return newState;
			});
		},
		
		renameAsset: (categoryId, assetId, newName) => {
			update(s => {
				const newState = {
					...s,
					categories: s.categories.map(c => {
						if (c.id === categoryId) {
							return {
								...c,
								assets: c.assets.map(a => 
									a.id === assetId ? { ...a, name: newName } : a
								)
							};
						}
						return c;
					})
				};
				saveMetadata(newState);
				return newState;
			});
		},
		
		moveAsset: (fromCategoryId, toCategoryId, assetId) => {
			update(s => {
				let assetToMove = null;
				
				const categoriesAfterRemove = s.categories.map(c => {
					if (c.id === fromCategoryId) {
						assetToMove = c.assets.find(a => a.id === assetId);
						const newAssets = c.assets.filter(a => a.id !== assetId);
						let thumbnail = c.thumbnail;
						if (assetToMove && c.thumbnail === assetToMove.imageData) {
							thumbnail = newAssets.length > 0 ? newAssets[0].imageData : null;
						}
						return { ...c, assets: newAssets, thumbnail };
					}
					return c;
				});
				
				if (!assetToMove) return s;
				
				const categoriesAfterAdd = categoriesAfterRemove.map(c => {
					if (c.id === toCategoryId) {
						const newAssets = [...c.assets, assetToMove];
						const thumbnail = c.thumbnail || assetToMove.imageData;
						return { ...c, assets: newAssets, thumbnail };
					}
					return c;
				});
				
				const newState = { ...s, categories: categoriesAfterAdd };
				saveMetadata(newState);
				return newState;
			});
		},
		
		clear: () => {
			// Clear IndexedDB
			if (browser) {
				indexedDB.deleteDatabase(DB_NAME);
			}
			const newState = {
				categories: DEFAULT_CATEGORIES.map(cat => ({ ...cat, assets: [], thumbnail: null }))
			};
			set(newState);
			saveMetadata(newState);
		},
		
		reset: () => {
			if (browser) {
				indexedDB.deleteDatabase(DB_NAME);
			}
			const newState = {
				categories: DEFAULT_CATEGORIES.map(cat => ({ ...cat, assets: [], thumbnail: null }))
			};
			set(newState);
			saveMetadata(newState);
		}
	};
}

export const assetStore = createAssetStore();
export { DEFAULT_CATEGORIES };
