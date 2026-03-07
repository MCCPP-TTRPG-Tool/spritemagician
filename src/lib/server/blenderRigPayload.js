export const HUMANOID_BONE_HIERARCHY = [
	{ name: 'pelvis', parent: null },
	{ name: 'spine', parent: 'pelvis' },
	{ name: 'neck', parent: 'spine' },
	{ name: 'head', parent: 'neck' },
	{ name: 'shoulder_L', parent: 'neck' },
	{ name: 'elbow_L', parent: 'shoulder_L' },
	{ name: 'wrist_L', parent: 'elbow_L' },
	{ name: 'shoulder_R', parent: 'neck' },
	{ name: 'elbow_R', parent: 'shoulder_R' },
	{ name: 'wrist_R', parent: 'elbow_R' },
	{ name: 'hip_L', parent: 'pelvis' },
	{ name: 'knee_L', parent: 'hip_L' },
	{ name: 'ankle_L', parent: 'knee_L' },
	{ name: 'hip_R', parent: 'pelvis' },
	{ name: 'knee_R', parent: 'hip_R' },
	{ name: 'ankle_R', parent: 'knee_R' }
];

export function buildBlenderRigPayload({
	jobId,
	modelUrl,
	markers,
	options = {},
	preflight = null
}) {
	const targetHeightMeters = 1.8;
	const measuredHeight =
		Number.isFinite(Number(preflight?.height)) && Number(preflight.height) > 0
			? Number(preflight.height)
			: null;
	const inferredScale = measuredHeight ? targetHeightMeters / measuredHeight : 1.0;

	return {
		specVersion: 'blender_rig_v1',
		jobId: String(jobId || ''),
		type: 'rig_from_markers',
		input: {
			modelUrl,
			modelFormatHint: String(modelUrl || '').split('?')[0].split('.').pop()?.toLowerCase() || '',
			template: 'humanoid_v1',
			markers
		},
		rig: {
			boneHierarchy: HUMANOID_BONE_HIERARCHY,
			options: {
				ik_hands: !!options.ik_hands,
				ik_feet: !!options.ik_feet
			}
		},
		normalize: {
			axis: { forward: 'Y', up: 'Z' },
			centerAtOrigin: true,
			groundFeet: true,
			targetHeightMeters,
			uniformScale: Number.isFinite(inferredScale) ? inferredScale : 1.0,
			preflight
		},
		output: {
			blendPath: `outputs/${jobId}/rigged.blend`,
			previewGlbPath: `outputs/${jobId}/rig_preview.glb`
		}
	};
}
