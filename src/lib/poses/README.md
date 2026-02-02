# Pose Library

Skeleton keypoint sequences for sprite animations.

## Format

Each pose file contains an array of frames. Each frame has 18 OpenPose keypoints with normalized coordinates (0-1).

### Keypoint Index Reference (OpenPose format)
- 0: Nose
- 1: Neck
- 2: Right Shoulder
- 3: Right Elbow
- 4: Right Wrist
- 5: Left Shoulder
- 6: Left Elbow
- 7: Left Wrist
- 8: Right Hip
- 9: Right Knee
- 10: Right Ankle
- 11: Left Hip
- 12: Left Knee
- 13: Left Ankle
- 14: Right Eye
- 15: Left Eye
- 16: Right Ear
- 17: Left Ear

### Coordinate System
- X: 0 = left edge, 1 = right edge
- Y: 0 = top edge, 1 = bottom edge
- Character faces RIGHT by default

### Creating New Actions
1. Define keyframes for the action cycle
2. Ensure frame 1 and last frame can loop smoothly
3. Keep character centered (x ≈ 0.5) and grounded (ankle y ≈ 0.9)

