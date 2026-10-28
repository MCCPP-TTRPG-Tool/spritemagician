# End‑to‑End 3D → Rig → Animate → Isometric Spritesheet Pipeline

## Production-Oriented Technical Architecture (Prototype First)

This document describes how to build a complete browser-accessible
pipeline:

GPT Discussion → 2D Genesis → 3D Generation (Hunyuan) → Rigging →
Animation → Headless Blender Rendering → Batch Isometric Spritesheet
Export

Stack Assumptions: - Frontend: SvelteKit - Backend API: Node - Auth +
Storage: Firebase (Auth + Firestore + Storage) - Compute Workers: Runpod
(or self-hosted equivalent) - Rig/Render Engine: Blender (headless) -
Browser 3D: three.js or Babylon.js

The goal is to build a WORKING prototype while avoiding edge cases and
bad practices.

------------------------------------------------------------------------

# 1. System Architecture Overview

## Separation of Responsibilities

Browser: - Model preview - Rig marker placement - Animation keyframe
authoring - Timeline preview - Job submission

Backend (Node): - Auth validation - Job creation - Rate limiting -
Firestore job state management

Worker (Runpod + Blender): - Model normalization - Rig construction -
Skinning - Animation baking - Isometric rendering - Output export

Storage: - Firebase Storage for inputs + outputs - Firestore for job
tracking

------------------------------------------------------------------------

# 2. 3D Model Generation Stage

## Input

-   Prompt or image → Hunyuan3D API

## Output

-   FBX (preferred) or GLB

## Immediate Normalization Step (Critical)

Before exposing to browser: 1. Import FBX in headless Blender 2. Apply
transforms (scale, rotation) 3. Fix axis (Y-forward, Z-up recommended)
4. Center model at origin 5. Place feet at ground plane (optional) 6.
Export normalized GLB

This GLB becomes canonical preview asset.

Avoid letting browser handle raw FBX.

------------------------------------------------------------------------

# 3. Rigging Tool (Browser Side)

## Concept

User does NOT build bones manually. User places joint markers for a
predefined template.

### Supported Template (v1)

Humanoid only.

Required markers: - pelvis - spine - neck - head - shoulder_L /
shoulder_R - elbow_L / elbow_R - wrist_L / wrist_R - hip_L / hip_R -
knee_L / knee_R - ankle_L / ankle_R

### Browser Implementation

Use three.js:

-   Raycaster for click-to-place
-   Store marker positions in MODEL LOCAL coordinates
-   Display marker spheres
-   Draw preview lines between joints
-   Optional symmetry mirroring

### RigSpec JSON

{ "template": "humanoid_v1", "markers": { ... }, "options": {
"ik_hands": false, "ik_feet": false } }

------------------------------------------------------------------------

# 4. Rig Construction (Blender Worker)

Job Type: rig_from_markers

Steps:

1.  Import normalized model
2.  Create armature
3.  Add bones between marker coordinates
4.  Parent into fixed canonical hierarchy
5.  Apply automatic weights
6.  Optional: add simple IK constraints
7.  Save rigged .blend
8.  Export rigged GLB for preview

Do NOT overcomplicate bone roll or advanced constraints in prototype.

------------------------------------------------------------------------

# 5. Animation Tool (Browser Side)

## Scope (Prototype)

Expose only small control set: - hips/root - chest - head - hand_L -
hand_R

Avoid full deform bone editing.

## Timeline Implementation

-   FPS fixed (e.g. 24)
-   Linear interpolation only
-   Keyframe structure:

{ "clip_name": "attack_01", "fps": 24, "frames": 24, "tracks": \[ {
"node": "hand_R", "keys": \[ { "f": 0, "rot": \[...\], "pos": \[...\] },
{ "f": 6, "rot": \[...\], "pos": \[...\] } \] } \] }

Use simple interpolation in browser for preview.

------------------------------------------------------------------------

# 6. Animation Baking (Blender Worker)

Job Type: apply_anim_clip

1.  Load rigged .blend
2.  Parse AnimClip JSON
3.  Insert keyframes on matching bones
4.  Bake action
5.  Save baked .blend

This ensures reproducibility and consistency.

------------------------------------------------------------------------

# 7. Isometric Sprite Rendering

Job Type: render_spritesheet

Blender scene preconfigured with: - Isometric camera rig - Lighting
setup - Transparent background - Frame range defined

Process:

1.  Rotate character for each direction (8 or 16)
2.  Render frame sequence
3.  Composite into spritesheet
4.  Export PNG + metadata JSON

Metadata example:

{ "frame_width": 256, "frame_height": 256, "directions": 8,
"frames_per_direction": 24, "pivot": \[128, 32\] }

------------------------------------------------------------------------

# 8. Firestore Job Model

Collection: jobs/{jobId}

{ "userId": "...", "type": "render_spritesheet", "status":
"queued\|running\|done\|failed", "input": { ... }, "output": { ... },
"progress": 0 }

Worker claims job via Firestore transaction.

------------------------------------------------------------------------

# 9. Worker Loop Design

Worker Container: - Blender installed - base.blend - run_job.py

Loop: 1. Poll Firestore for queued job 2. Mark running 3. Download
inputs 4. Execute Blender headless 5. Upload outputs 6. Mark done

Concurrency = number of worker containers.

------------------------------------------------------------------------

# 10. Avoiding Edge Cases

## Do NOT:

-   Allow arbitrary skeleton editing
-   Execute user-provided Python
-   Let users choose extreme resolutions initially
-   Mix coordinate spaces
-   Chain infinite edits without baking

## Always:

-   Normalize model before rigging
-   Use canonical skeleton hierarchy
-   Store local-space marker coordinates
-   Cache rigged models
-   Enforce job timeouts

------------------------------------------------------------------------

# 11. Prototype Development Order

1.  Model upload + normalization
2.  Rig marker placement UI
3.  Rig building worker job
4.  Animation timeline UI
5.  Animation bake job
6.  Isometric sprite render job
7.  Job queue scaling

------------------------------------------------------------------------

# 12. Services That Cover Partial Workflow

Model Generation: - Hunyuan3D

Motion Capture Animation: - DeepMotion

Rigging Inspiration: - AccuRig

Animation Library: - Mixamo (manual use)

Rendering: - Blender headless

Browser 3D: - three.js or Babylon.js

No single service currently offers this entire stack as a SaaS product.

------------------------------------------------------------------------

# Conclusion

The pipeline is viable.

Key principles: - Browser defines intent. - Blender executes
deterministically. - JSON defines contracts. - Workers scale
horizontally. - Keep prototype minimal and constrained.

This architecture avoids: - Browser-side DCC complexity - Fragile FBX
handling - Infinite rig variation chaos - Uncontrolled compute costs

Build simple first. Improve fidelity later.
