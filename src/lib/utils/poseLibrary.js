/**
 * Pose Library - Loads and manages skeleton pose sequences
 */

// Import pose files
import idlePose from '$lib/poses/idle.json';
import runPose from '$lib/poses/run.json';
import jumpPose from '$lib/poses/jump.json';

// OpenPose keypoint indices
export const KEYPOINT_NAMES = [
	'nose',
	'neck',
	'right_shoulder',
	'right_elbow',
	'right_wrist',
	'left_shoulder',
	'left_elbow',
	'left_wrist',
	'right_hip',
	'right_knee',
	'right_ankle',
	'left_hip',
	'left_knee',
	'left_ankle',
	'right_eye',
	'left_eye',
	'right_ear',
	'left_ear'
];

// Skeleton connections for drawing
export const SKELETON_CONNECTIONS = [
	// Face
	[0, 14], [0, 15], [14, 16], [15, 17],
	// Torso
	[0, 1], [1, 2], [1, 5], [2, 8], [5, 11], [8, 11],
	// Right arm
	[2, 3], [3, 4],
	// Left arm
	[5, 6], [6, 7],
	// Right leg
	[8, 9], [9, 10],
	// Left leg
	[11, 12], [12, 13]
];

// Available poses
const POSES = {
	idle: idlePose,
	run: runPose,
	jump: jumpPose
};

/**
 * Get list of available actions
 */
export function getAvailableActions() {
	return Object.keys(POSES).map(key => ({
		id: key,
		name: POSES[key].name,
		description: POSES[key].description,
		frameCount: POSES[key].frameCount,
		loop: POSES[key].loop
	}));
}

/**
 * Get pose sequence for an action
 */
export function getPoseSequence(actionId) {
	const pose = POSES[actionId];
	if (!pose) {
		throw new Error(`Unknown action: ${actionId}`);
	}
	return pose;
}

/**
 * Get a specific frame from an action
 */
export function getPoseFrame(actionId, frameIndex) {
	const pose = POSES[actionId];
	if (!pose) {
		throw new Error(`Unknown action: ${actionId}`);
	}
	
	const frameIdx = frameIndex % pose.frames.length;
	return pose.frames[frameIdx];
}

/**
 * Convert normalized keypoints to pixel coordinates
 */
export function keypointsToPixels(keypoints, width, height) {
	return keypoints.map(([x, y]) => [
		Math.round(x * width),
		Math.round(y * height)
	]);
}

/**
 * Draw skeleton on a canvas
 */
export function drawSkeleton(ctx, keypoints, width, height, options = {}) {
	const {
		pointColor = '#00ff00',
		lineColor = '#00ff00',
		pointRadius = 3,
		lineWidth = 2
	} = options;
	
	const pixels = keypointsToPixels(keypoints, width, height);
	
	// Draw connections
	ctx.strokeStyle = lineColor;
	ctx.lineWidth = lineWidth;
	
	for (const [startIdx, endIdx] of SKELETON_CONNECTIONS) {
		const start = pixels[startIdx];
		const end = pixels[endIdx];
		
		if (start && end) {
			ctx.beginPath();
			ctx.moveTo(start[0], start[1]);
			ctx.lineTo(end[0], end[1]);
			ctx.stroke();
		}
	}
	
	// Draw points
	ctx.fillStyle = pointColor;
	
	for (const [x, y] of pixels) {
		ctx.beginPath();
		ctx.arc(x, y, pointRadius, 0, Math.PI * 2);
		ctx.fill();
	}
}

/**
 * Generate OpenPose-compatible JSON for a frame
 */
export function toOpenPoseFormat(keypoints, width, height) {
	const pixels = keypointsToPixels(keypoints, width, height);
	
	// OpenPose format: [x1, y1, confidence1, x2, y2, confidence2, ...]
	const poseKeypoints = [];
	for (const [x, y] of pixels) {
		poseKeypoints.push(x, y, 1.0); // confidence = 1.0
	}
	
	return {
		people: [{
			pose_keypoints_2d: poseKeypoints
		}]
	};
}

