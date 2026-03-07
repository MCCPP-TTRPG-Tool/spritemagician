<script>
	import { onMount } from 'svelte';
	import { projectStore } from '$lib/stores/project.js';

	const REQUIRED_MARKERS = [
		'pelvis',
		'spine',
		'neck',
		'head',
		'shoulder_L',
		'elbow_L',
		'wrist_L',
		'shoulder_R',
		'elbow_R',
		'wrist_R',
		'hip_L',
		'knee_L',
		'ankle_L',
		'hip_R',
		'knee_R',
		'ankle_R'
	];

	let viewerStatus = $state('');
	let activeMarker = $state('pelvis');
	let markerMap = $state({});
	let hostEl = null;

	let threeRef = null;
	let controlsRef = null;
	let cameraRef = null;
	let sceneRef = null;
	let rendererRef = null;
	let modelRoot = null;
	let raycaster = null;
	let pointer = null;
	let markerGroup = null;
	let markerSpheres = new Map();
	let stopResizeObserver = null;
	let controls = null;
	let localModelInputEl = null;
	let markerSizeMult = $state(1.4);
	let markerRadiusWorld = 0.035;
	let isDraggingMarker = false;
	let draggingMarkerName = '';
	let dragPlane = null;
	let preflight = $state(null);
let lastLoadedModelUrl = '';

	function formatVec(v) {
		if (!v) return '';
		return `${v.x.toFixed(3)}, ${v.y.toFixed(3)}, ${v.z.toFixed(3)}`;
	}

	function getMarkerWorldPoint(markerName) {
		if (!threeRef || !modelRoot) return null;
		const local = markerMap?.[markerName];
		if (!local) return null;
		const world = new threeRef.Vector3(local.x, local.y, local.z);
		modelRoot.localToWorld(world);
		return world;
	}

	function round3(n) {
		const v = Number(n);
		if (!Number.isFinite(v)) return 0;
		return Math.round(v * 1000) / 1000;
	}

	function analyzeModelPreflight(model) {
		if (!threeRef || !model) return null;
		const box = new threeRef.Box3().setFromObject(model);
		if (box.isEmpty()) return null;
		const size = box.getSize(new threeRef.Vector3());
		const center = box.getCenter(new threeRef.Vector3());
		const minY = box.min.y;
		const height = Math.max(0.0001, size.y);

		let meshCount = 0;
		let skinnedMeshCount = 0;
		model.traverse((node) => {
			if (node?.isMesh) meshCount += 1;
			if (node?.isSkinnedMesh) skinnedMeshCount += 1;
		});

		const groundedTolerance = Math.max(0.01, height * 0.02);
		const centeredTolerance = Math.max(0.01, height * 0.05);
		const grounded = Math.abs(minY) <= groundedTolerance;
		const centeredXZ = Math.abs(center.x) <= centeredTolerance && Math.abs(center.z) <= centeredTolerance;
		const targetHeight = 1.8;
		const uniformScale = targetHeight / height;
		const scaledReasonably = uniformScale >= 0.85 && uniformScale <= 1.15;

		const canAutoWeight = meshCount > 0 && height > 0 && Number.isFinite(height);
		return {
			grounded,
			centeredXZ,
			scaledReasonably,
			canAutoWeight,
			meshCount,
			skinnedMeshCount,
			height: round3(height),
			minY: round3(minY),
			center: { x: round3(center.x), y: round3(center.y), z: round3(center.z) },
			suggestedNormalization: {
				uniformScale: round3(uniformScale),
				translate: {
					x: round3(-center.x),
					y: round3(-minY),
					z: round3(-center.z)
				}
			}
		};
	}

	function normalizeModelForRig(model, targetHeightMeters = 1.8) {
		if (!threeRef || !model) return { applied: false, scaleFactor: 1 };
		let box = new threeRef.Box3().setFromObject(model);
		if (box.isEmpty()) return { applied: false, scaleFactor: 1 };

		// Pass 1: center in XZ and place lowest point on ground plane (Y=0).
		const center = box.getCenter(new threeRef.Vector3());
		const minY = box.min.y;
		model.position.sub(new threeRef.Vector3(center.x, minY, center.z));

		// Pass 2: normalize height to target meters.
		box = new threeRef.Box3().setFromObject(model);
		const size = box.getSize(new threeRef.Vector3());
		const height = Math.max(1e-6, size.y);
		const scaleFactor = targetHeightMeters / height;
		model.scale.multiplyScalar(scaleFactor);

		// Pass 3: re-ground/re-center after scaling drift.
		box = new threeRef.Box3().setFromObject(model);
		const center2 = box.getCenter(new threeRef.Vector3());
		const minY2 = box.min.y;
		model.position.sub(new threeRef.Vector3(center2.x, minY2, center2.z));

		return { applied: true, scaleFactor };
	}

	function writePreflightToProject(report) {
		preflight = report;
		projectStore.update((p) => ({
			...p,
			threeDModelPreflight: report
		}));
	}

	function applyRigUIStateFromStore() {
		const ui = $projectStore?.threeDRigUI || {};
		activeMarker = typeof ui.activeMarker === 'string' ? ui.activeMarker : 'pelvis';
		const nextSize = Number(ui.markerSizeMult);
		markerSizeMult = Number.isFinite(nextSize) ? nextSize : 1.4;
	}

	function eventToNdc(event) {
		if (!rendererRef || !pointer) return;
		const rect = rendererRef.domElement.getBoundingClientRect();
		pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
		pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
	}

	function setMarkerLocal(markerName, localVec3) {
		markerMap = {
			...markerMap,
			[markerName]: { x: localVec3.x, y: localVec3.y, z: localVec3.z }
		};
		updateMarkerObjects();
		const snapshot = toPlainRigSpec(buildRigSpec());
		projectStore.update((p) => ({ ...p, threeDRigSpec: snapshot }));
	if (typeof window !== 'undefined') {
		try {
			localStorage.setItem('spritemagician.rigspec.latest', JSON.stringify(snapshot));
		} catch {
			// best effort local cache only
		}
	}
	}

	function beginMarkerDrag(event) {
		if (!rendererRef || !cameraRef || !threeRef || !markerGroup || !raycaster) return false;
		eventToNdc(event);
		raycaster.setFromCamera(pointer, cameraRef);
		const hits = raycaster.intersectObjects(markerGroup.children, true);
		if (!hits?.length) return false;
		const hit = hits[0];
		let node = hit.object;
		while (node && node !== markerGroup && !node.userData?.markerName) {
			node = node.parent;
		}
		const markerName = node?.userData?.markerName;
		if (!markerName) return false;

		draggingMarkerName = markerName;
		activeMarker = markerName;
		projectStore.update((p) => ({
			...p,
			threeDRigUI: {
				...(p?.threeDRigUI || {}),
				activeMarker: markerName
			}
		}));
		const anchorWorld = getMarkerWorldPoint(markerName) || hit.point.clone();
		const viewNormal = new threeRef.Vector3();
		cameraRef.getWorldDirection(viewNormal);
		dragPlane = new threeRef.Plane().setFromNormalAndCoplanarPoint(viewNormal, anchorWorld);
		isDraggingMarker = true;
		if (controls) controls.enabled = false;
		viewerStatus = `Dragging ${markerName}...`;
		return true;
	}

	function moveDraggedMarker(event) {
		if (!isDraggingMarker || !draggingMarkerName || !dragPlane || !raycaster || !cameraRef || !modelRoot) return;
		eventToNdc(event);
		raycaster.setFromCamera(pointer, cameraRef);
		const hitWorld = new threeRef.Vector3();
		const didHit = raycaster.ray.intersectPlane(dragPlane, hitWorld);
		if (!didHit) return;
		const local = modelRoot.worldToLocal(hitWorld.clone());
		setMarkerLocal(draggingMarkerName, local);
	}

	function endMarkerDrag() {
		if (!isDraggingMarker) return;
		const markerName = draggingMarkerName;
		isDraggingMarker = false;
		draggingMarkerName = '';
		dragPlane = null;
		if (controls) controls.enabled = true;
		const local = markerMap?.[markerName];
		if (local) {
			viewerStatus = `Placed ${markerName} at (${formatVec(local)}).`;
		}
	}

	async function ensureThree() {
		if (threeRef) return;
		const threeMod = await import('https://esm.sh/three@0.165.0');
		const controlsMod = await import(
			'https://esm.sh/three@0.165.0/examples/jsm/controls/OrbitControls.js'
		);
		threeRef = threeMod;
		controlsRef = controlsMod.OrbitControls;
	}

	function inferModelTypeFromUrl(url) {
		try {
			const parsed = new URL(String(url || ''), typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
			const pathname = decodeURIComponent(parsed.pathname || '').toLowerCase();
			if (pathname.endsWith('.glb')) return 'glb';
			if (pathname.endsWith('.gltf')) return 'gltf';
			if (pathname.endsWith('.fbx')) return 'fbx';
			if (pathname.endsWith('.obj')) return 'obj';
		} catch {
			// ignore and fall back
		}
		const lower = String(url || '').toLowerCase();
		if (lower.includes('.glb')) return 'glb';
		if (lower.includes('.gltf')) return 'gltf';
		if (lower.includes('.fbx')) return 'fbx';
		if (lower.includes('.obj')) return 'obj';
		return '';
	}

	function toViewportFetchUrl(rawUrl) {
		const value = String(rawUrl || '').trim();
		if (!value) return value;
		if (value.startsWith('blob:') || value.startsWith('data:')) return value;
		try {
			const parsed = new URL(
				value,
				typeof window !== 'undefined' ? window.location.origin : 'http://localhost'
			);
			if (typeof window !== 'undefined' && parsed.origin === window.location.origin) {
				return parsed.toString();
			}
			return `/api/3d/model-proxy?url=${encodeURIComponent(parsed.toString())}`;
		} catch {
			return value;
		}
	}

	function fitCameraToModel() {
		if (!threeRef || !cameraRef || !modelRoot || !controls) return;
		const box = new threeRef.Box3().setFromObject(modelRoot);
		if (box.isEmpty()) return;
		const center = box.getCenter(new threeRef.Vector3());
		const size = box.getSize(new threeRef.Vector3());
		const radius = Math.max(size.length() * 0.5, 0.1);
		markerRadiusWorld = Math.max(0.015, radius * 0.03);
		const fovRad = (cameraRef.fov * Math.PI) / 180;
		const dist = (radius / Math.tan(fovRad / 2)) * 1.35;

		modelRoot.position.sub(center);
		cameraRef.position.set(dist, dist * 0.75, dist);
		cameraRef.near = Math.max(0.001, dist / 500);
		cameraRef.far = Math.max(1000, dist * 100);
		cameraRef.updateProjectionMatrix();
		controls.target.set(0, 0, 0);
		controls.update();
	}

	function frameCameraForDirection(direction = 'iso') {
		if (!threeRef || !cameraRef || !modelRoot || !controls) return;
		const box = new threeRef.Box3().setFromObject(modelRoot);
		if (box.isEmpty()) return;
		const center = box.getCenter(new threeRef.Vector3());
		const size = box.getSize(new threeRef.Vector3());
		const radius = Math.max(size.length() * 0.5, 0.1);
		const fovRad = (cameraRef.fov * Math.PI) / 180;
		const dist = (radius / Math.tan(fovRad / 2)) * 1.35;
		const torsoY = center.y + size.y * 0.1;

		let offset = new threeRef.Vector3(dist, dist * 0.45, dist);
		if (direction === 'front') {
			// Front = camera on +Z, slightly above center to avoid ground/up-butt angle.
			offset = new threeRef.Vector3(0, 0, dist);
		} else if (direction === 'side') {
			// Side = camera on +X at same torso height.
			offset = new threeRef.Vector3(dist, 0, 0);
		}

		const target = new threeRef.Vector3(center.x, torsoY, center.z);
		cameraRef.position.copy(target.clone().add(offset));
		cameraRef.near = Math.max(0.001, dist / 500);
		cameraRef.far = Math.max(1000, dist * 100);
		cameraRef.updateProjectionMatrix();
		controls.target.copy(target);
		controls.update();
	}

	function disposeCurrentModel() {
		if (!sceneRef || !modelRoot) return;
		sceneRef.remove(modelRoot);
		modelRoot.traverse((obj) => {
			if (obj?.geometry?.dispose) obj.geometry.dispose();
			const mats = Array.isArray(obj?.material) ? obj.material : [obj?.material];
			for (const m of mats) {
				if (m?.dispose) m.dispose();
			}
		});
		modelRoot = null;
	}

	function updateMarkerObjects() {
		if (!threeRef || !markerGroup || !modelRoot) return;
		for (const sphere of markerSpheres.values()) {
			markerGroup.remove(sphere);
			sphere.traverse?.((node) => {
				node.geometry?.dispose?.();
				node.material?.dispose?.();
			});
		}
		markerSpheres = new Map();
		for (const [name, local] of Object.entries(markerMap || {})) {
			const markerNode = new threeRef.Group();
			const baseRadius = Math.max(0.01, markerRadiusWorld * markerSizeMult);
			const radius = name === activeMarker ? baseRadius * 1.2 : baseRadius;
			const coreGeom = new threeRef.SphereGeometry(radius, 18, 18);
			const haloGeom = new threeRef.SphereGeometry(radius * 1.28, 16, 16);
			const coreColor = name === activeMarker ? 0x7c3aed : 0x06b6d4;
			const haloColor = name === activeMarker ? 0xf5d0fe : 0x99f6e4;
			const coreMat = new threeRef.MeshBasicMaterial({
				color: coreColor,
				depthTest: false,
				depthWrite: false
			});
			const haloMat = new threeRef.MeshBasicMaterial({
				color: haloColor,
				transparent: true,
				opacity: 0.55,
				depthTest: false,
				depthWrite: false
			});
			const core = new threeRef.Mesh(coreGeom, coreMat);
			const halo = new threeRef.Mesh(haloGeom, haloMat);
			core.renderOrder = 999;
			halo.renderOrder = 998;
			markerNode.add(halo);
			markerNode.add(core);
			const world = new threeRef.Vector3(local.x, local.y, local.z);
			modelRoot.localToWorld(world);
			markerNode.position.copy(world);
			markerNode.userData.markerName = name;
			markerGroup.add(markerNode);
			markerSpheres.set(name, markerNode);
		}
	}

	function markerCoverage() {
		const count = REQUIRED_MARKERS.filter((k) => markerMap?.[k]).length;
		return `${count}/${REQUIRED_MARKERS.length}`;
	}

	function buildRigSpec() {
		return {
			template: 'humanoid_v1',
			markers: markerMap,
			options: {
				ik_hands: false,
				ik_feet: false
			}
		};
	}

	function toPlainRigSpec(spec) {
		try {
			return JSON.parse(JSON.stringify(spec));
		} catch {
			return {
				template: 'humanoid_v1',
				markers: { ...(spec?.markers || {}) },
				options: {
					ik_hands: !!spec?.options?.ik_hands,
					ik_feet: !!spec?.options?.ik_feet
				}
			};
		}
	}

	function saveRigSpecToProject() {
		const spec = toPlainRigSpec(buildRigSpec());
		projectStore.update((p) => ({ ...p, threeDRigSpec: spec }));
		if (typeof window !== 'undefined') {
			try {
				localStorage.setItem('spritemagician.rigspec.latest', JSON.stringify(spec));
			} catch {
				// best effort local cache only
			}
			window.dispatchEvent(
				new CustomEvent('threeDRigSpecSaved', {
					detail: { markerCount: Object.keys(spec?.markers || {}).length }
				})
			);
		}
		viewerStatus = `RigSpec saved (${markerCoverage()} markers placed).`;
	}

	function clearMarkers() {
		markerMap = {};
	const emptySpec = buildRigSpec();
	projectStore.update((p) => ({ ...p, threeDRigSpec: emptySpec }));
	if (typeof window !== 'undefined') {
		try {
			localStorage.setItem('spritemagician.rigspec.latest', JSON.stringify(emptySpec));
		} catch {
			// best effort local cache only
		}
	}
		updateMarkerObjects();
		viewerStatus = 'Cleared all rig markers.';
	}

	async function loadModelFromUrl(url, forcedType = '') {
		if (!url || !sceneRef || !threeRef) return;
		const requestUrl = toViewportFetchUrl(url);
		const modelType =
			['glb', 'gltf', 'fbx', 'obj'].includes(String(forcedType || '').toLowerCase())
				? String(forcedType).toLowerCase()
				: inferModelTypeFromUrl(url);
		let loaded = null;
		if (modelType === 'glb' || modelType === 'gltf') {
			const gltfMod = await import('https://esm.sh/three@0.165.0/examples/jsm/loaders/GLTFLoader.js');
			const loader = new gltfMod.GLTFLoader();
			loaded = await new Promise((resolve, reject) => {
				loader.load(
					requestUrl,
					(gltf) => resolve(gltf.scene),
					undefined,
					(err) => reject(new Error(err?.message || 'Failed to load glTF model.'))
				);
			});
		} else if (modelType === 'fbx') {
			const fbxMod = await import('https://esm.sh/three@0.165.0/examples/jsm/loaders/FBXLoader.js');
			const loader = new fbxMod.FBXLoader();
			loaded = await new Promise((resolve, reject) => {
				loader.load(
					requestUrl,
					resolve,
					undefined,
					(err) => reject(new Error(err?.message || 'Failed to load FBX model.'))
				);
			});
		} else if (modelType === 'obj') {
			const objMod = await import('https://esm.sh/three@0.165.0/examples/jsm/loaders/OBJLoader.js');
			const loader = new objMod.OBJLoader();
			loaded = await new Promise((resolve, reject) => {
				loader.load(
					requestUrl,
					resolve,
					undefined,
					(err) => reject(new Error(err?.message || 'Failed to load OBJ model.'))
				);
			});
		} else {
			throw new Error(
				'Could not detect model type from URL. Use .glb/.gltf/.fbx/.obj and keep extension in filename.'
			);
		}

		disposeCurrentModel();
		modelRoot = loaded;
		sceneRef.add(modelRoot);
		const normalization = normalizeModelForRig(modelRoot, 1.8);
		const post = analyzeModelPreflight(modelRoot);
		writePreflightToProject(
			post
				? {
						...post,
						normalizationApplied: !!normalization.applied,
						appliedScaleFactor: round3(normalization.scaleFactor)
					}
				: post
		);
		fitCameraToModel();

		updateMarkerObjects();
		viewerStatus = 'Model loaded and normalized (grounded + centered + target height).';
	lastLoadedModelUrl = String(url);
	}

	async function openLocalModel(event) {
		const file = event?.target?.files?.[0];
		event.target.value = '';
		if (!file || !threeRef || !sceneRef) return;
		const name = String(file.name || '').toLowerCase();
		try {
			let loaded = null;
			if (name.endsWith('.obj')) {
				const text = await file.text();
				const objMod = await import('https://esm.sh/three@0.165.0/examples/jsm/loaders/OBJLoader.js');
				const loader = new objMod.OBJLoader();
				loaded = loader.parse(text);
			} else if (name.endsWith('.fbx')) {
				const buf = await file.arrayBuffer();
				const fbxMod = await import('https://esm.sh/three@0.165.0/examples/jsm/loaders/FBXLoader.js');
				const loader = new fbxMod.FBXLoader();
				loaded = loader.parse(buf, '');
			} else if (name.endsWith('.glb')) {
				const buf = await file.arrayBuffer();
				const gltfMod = await import('https://esm.sh/three@0.165.0/examples/jsm/loaders/GLTFLoader.js');
				const loader = new gltfMod.GLTFLoader();
				loaded = await new Promise((resolve, reject) => {
					loader.parse(buf, '', (gltf) => resolve(gltf.scene), (err) => reject(err));
				});
			} else {
				throw new Error('Local open currently supports .obj, .fbx, .glb');
			}

			disposeCurrentModel();
			modelRoot = loaded;
			sceneRef.add(modelRoot);
			const normalization = normalizeModelForRig(modelRoot, 1.8);
			const post = analyzeModelPreflight(modelRoot);
			writePreflightToProject(
				post
					? {
							...post,
							normalizationApplied: !!normalization.applied,
							appliedScaleFactor: round3(normalization.scaleFactor)
						}
					: post
			);
			fitCameraToModel();
			updateMarkerObjects();
			viewerStatus = `Loaded local model ${file.name} and normalized for rigging.`;
		} catch (err) {
			viewerStatus = err?.message || 'Failed to open local model.';
		}
	}

	function onPointerDown(event) {
		if (event?.button !== 0) return;
		if (!rendererRef || !cameraRef || !sceneRef || !modelRoot || !threeRef || !activeMarker) return;
		// First priority: drag existing marker balls.
		if (beginMarkerDrag(event)) return;
		eventToNdc(event);
		raycaster.setFromCamera(pointer, cameraRef);

		// First placement for a marker should use visible mesh hit depth,
		// so the marker does not jump behind/in front when view rotates.
		let hitWorld = null;
		if (!markerMap?.[activeMarker]) {
			const meshHits = raycaster.intersectObject(modelRoot, true);
			if (meshHits?.length) {
				hitWorld = meshHits[0].point.clone();
			}
		}

		// After marker exists, keep AccuRig-like 2D adjustment on camera-aligned plane.
		if (!hitWorld) {
			const viewNormal = new threeRef.Vector3();
			cameraRef.getWorldDirection(viewNormal);
			const anchorWorld =
				getMarkerWorldPoint(activeMarker) || controls?.target?.clone?.() || new threeRef.Vector3(0, 0, 0);
			const placementPlane = new threeRef.Plane().setFromNormalAndCoplanarPoint(viewNormal, anchorWorld);
			const planeHit = new threeRef.Vector3();
			const didHit = raycaster.ray.intersectPlane(placementPlane, planeHit);
			if (!didHit) return;
			hitWorld = planeHit;
		}

		const local = modelRoot.worldToLocal(hitWorld.clone());
		setMarkerLocal(activeMarker, local);
		viewerStatus = `Placed ${activeMarker} at (${formatVec(local)}).`;
	}

	function onPointerMove(event) {
		if (!isDraggingMarker) return;
		moveDraggedMarker(event);
	}

	function onPointerUp() {
		endMarkerDrag();
	}

	onMount(async () => {
		if (typeof window === 'undefined' || !hostEl) return;
		await ensureThree();

		sceneRef = new threeRef.Scene();
		sceneRef.background = new threeRef.Color(0xf3f4f6);
		cameraRef = new threeRef.PerspectiveCamera(55, 1, 0.01, 1000);
		cameraRef.position.set(1.5, 1.4, 1.9);

		rendererRef = new threeRef.WebGLRenderer({ antialias: true });
		rendererRef.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
		rendererRef.outputColorSpace = threeRef.SRGBColorSpace;
		hostEl.appendChild(rendererRef.domElement);

		controls = new controlsRef(cameraRef, rendererRef.domElement);
		controls.enableDamping = true;
		controls.target.set(0, 0.2, 0);
		// AccuRig-like interaction: left click places markers; middle/right navigate viewport.
		controls.mouseButtons = {
			LEFT: -1,
			MIDDLE: threeRef.MOUSE.ROTATE,
			RIGHT: threeRef.MOUSE.PAN
		};

		sceneRef.add(new threeRef.HemisphereLight(0xffffff, 0x444444, 1.2));
		const dir = new threeRef.DirectionalLight(0xffffff, 1.0);
		dir.position.set(2, 4, 2);
		sceneRef.add(dir);
		sceneRef.add(new threeRef.GridHelper(4, 20, 0x94a3b8, 0xcbd5e1));

		markerGroup = new threeRef.Group();
		sceneRef.add(markerGroup);

		raycaster = new threeRef.Raycaster();
		pointer = new threeRef.Vector2();
		rendererRef.domElement.addEventListener('pointerdown', onPointerDown);
		rendererRef.domElement.addEventListener('pointermove', onPointerMove);
		rendererRef.domElement.addEventListener('pointerup', onPointerUp);
		rendererRef.domElement.addEventListener('pointerleave', onPointerUp);
		applyRigUIStateFromStore();

		const onRigViewportAction = (event) => {
			const type = String(event?.detail?.type || '');
			if (type === 'load_model_url') {
				const url = String(event?.detail?.url || '').trim();
				const formatHint = String(event?.detail?.formatHint || '').trim().toLowerCase();
				if (!url) {
					viewerStatus = 'No model URL provided.';
					return;
				}
				loadModelFromUrl(url, formatHint)
					.then(() => {
						viewerStatus = 'Model loaded from URL and normalized.';
					})
					.catch((err) => {
						viewerStatus = err?.message || 'Failed to load model from URL.';
					});
				return;
			}
			if (type === 'open_model') {
				localModelInputEl?.click();
				return;
			}
			if (type === 'save_rigspec') {
				saveRigSpecToProject();
				return;
			}
			if (type === 'clear_markers') {
				clearMarkers();
				return;
			}
			if (type === 'view_front') {
				if (!modelRoot) {
					viewerStatus = 'Load a model first, then use Front/Side view.';
					return;
				}
				frameCameraForDirection('front');
				viewerStatus = 'Camera: front view (framed).';
				return;
			}
			if (type === 'view_side') {
				if (!modelRoot) {
					viewerStatus = 'Load a model first, then use Front/Side view.';
					return;
				}
				frameCameraForDirection('side');
				viewerStatus = 'Camera: side view (framed).';
			}
		};
		if (typeof window !== 'undefined') {
			window.addEventListener('threeDRigViewportAction', onRigViewportAction);
		}

		const resize = () => {
			if (!hostEl || !rendererRef || !cameraRef) return;
			const w = Math.max(50, hostEl.clientWidth);
			const h = Math.max(50, hostEl.clientHeight);
			rendererRef.setSize(w, h, false);
			cameraRef.aspect = w / h;
			cameraRef.updateProjectionMatrix();
		};
		resize();
		const ro = new ResizeObserver(resize);
		ro.observe(hostEl);
		stopResizeObserver = () => ro.disconnect();

		let raf = 0;
		const tick = () => {
			controls.update();
			rendererRef.render(sceneRef, cameraRef);
			raf = window.requestAnimationFrame(tick);
		};
		tick();

		if ($projectStore.threeDModelUrl) {
			try {
				await loadModelFromUrl($projectStore.threeDModelUrl);
			} catch (err) {
				viewerStatus = err.message || 'Failed to load model.';
			}
		} else {
			viewerStatus = 'Upload/select a model first.';
		}

		return () => {
			window.cancelAnimationFrame(raf);
			rendererRef?.domElement?.removeEventListener('pointerdown', onPointerDown);
			rendererRef?.domElement?.removeEventListener('pointermove', onPointerMove);
			rendererRef?.domElement?.removeEventListener('pointerup', onPointerUp);
			rendererRef?.domElement?.removeEventListener('pointerleave', onPointerUp);
			if (typeof window !== 'undefined') {
				window.removeEventListener('threeDRigViewportAction', onRigViewportAction);
			}
			stopResizeObserver?.();
			disposeCurrentModel();
			rendererRef?.dispose?.();
			hostEl?.replaceChildren();
		};
	});

	$effect(() => {
		const url = $projectStore.threeDModelUrl;
		if (!url || !sceneRef) return;
		if (String(url) === lastLoadedModelUrl) return;
		loadModelFromUrl(url).catch((err) => {
			viewerStatus = err.message || 'Failed to load model.';
		});
	});

	$effect(() => {
		applyRigUIStateFromStore();
		if (modelRoot) updateMarkerObjects();
	});
</script>

<div class="h-full min-w-0 overflow-hidden p-3">
	<div class="relative w-full h-full border rounded bg-gray-100 overflow-hidden" bind:this={hostEl}>
		{#if viewerStatus}
			<div class="absolute bottom-2 left-2 right-2 text-[11px] bg-black/60 text-white px-2 py-1 rounded pointer-events-none">
				{viewerStatus}
			</div>
		{/if}
	</div>
	<input
		class="hidden"
		type="file"
		accept=".obj,.fbx,.glb"
		bind:this={localModelInputEl}
		onchange={openLocalModel}
	/>
</div>
