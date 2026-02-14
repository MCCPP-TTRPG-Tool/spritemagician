# Minimal SDXL + OpenPose Keyframe Pipeline (RunPod + ComfyUI)

## Purpose
This document defines a non-bloated, production-oriented pipeline for mass-generating isometric keyframes for sprites using SDXL, OpenPose ControlNet, a single stabilizer (Depth), and IP-Adapter for identity locking. WAN 2.2 is assumed to already be in use for frame-to-frame animation and is intentionally excluded from this stage.

## 1. Locked Decisions
- Base model: SDXL
- Pose control: OpenPose ControlNet (SDXL)
- Stabilizer: Depth ControlNet (SDXL)
- Identity consistency: IP-Adapter (SDXL)

No additional checkpoints, LoRAs, or ControlNets are to be added unless a failure case is proven.

## 2. RunPod Environment
- Use a standard ComfyUI RunPod template
- Persistent volume recommended
- Verify ComfyUI web interface loads and queues jobs correctly

## 3. Required Model Files
### Base Model
- SDXL base checkpoint placed in `ComfyUI/models/checkpoints/`

### ControlNets
- OpenPose ControlNet (SDXL)
- Depth ControlNet (SDXL)
Placed in `ComfyUI/models/controlnet/`

### IP-Adapter
- IP-Adapter weights (SDXL)
- CLIP Vision encoder
Placed in `ComfyUI/models/ipadapter/` and `ComfyUI/models/clip_vision/`

## 4. Required Custom Nodes
Install only if missing:
- ComfyUI-Manager
- ControlNet nodes
- OpenPose Preprocessor nodes
- IP-Adapter nodes

Avoid installing extra node packs.

## 5. Workflow Definition
Workflow name: `keyframe_sdxl_openpose_depth_ipadapter.json`

### Inputs
- OpenPose image (preferred) or pose source image
- Optional depth image
- Reference image
- Prompt (style/material only)
- Negative prompt
- Seed
- Resolution

### Node Flow
1. Load SDXL checkpoint
2. CLIP text encode
3. Load pose image
4. (Optional) OpenPose preprocessor
5. Load OpenPose ControlNet
6. Apply OpenPose ControlNet
7. Load depth image
8. Load Depth ControlNet
9. Apply Depth ControlNet
10. Load reference image
11. Load IP-Adapter + CLIP Vision
12. Apply IP-Adapter
13. KSampler
14. VAE decode
15. Save image

## 6. Recommended Parameters
- Steps: 25–35
- CFG: 4–7
- Denoise: 1.0
- OpenPose weight: 0.8–1.0
- Depth weight: 0.3–0.6
- IP-Adapter weight: 0.6–0.9

## 7. Isometric Consistency
Isometric perspective is enforced by pose templates, not prompts. All OpenPose templates must be authored from a consistent camera convention.

## 8. Pose Library Strategy
- Build 50–150 reusable pose templates
- Generate 8-direction variants by rotating skeletons
- Store poses as OpenPose PNGs or keypoint JSON

## 9. API Integration
Use ComfyUI HTTP API:
- POST `/prompt`
- Poll `/history/{id}`
- Fetch output via `/view`

Backend flow:
1. Upload pose and reference images
2. Inject into workflow JSON
3. Queue generation
4. Poll for completion
5. Download and store output

## 10. Quality Control
- Lock seeds for reproducibility
- Reroll via seed changes only
- Avoid prompt drift

## 11. Acceptance Tests
Pipeline is valid when:
1. Pose obedience is consistent
2. Identity is stable across seeds
3. Depth reduces silhouette drift
4. Batch generation is reliable
5. No crashes or memory leaks occur

## 12. Exclusions
Do not add:
- Extra checkpoints
- Extra ControlNets
- LoRAs
- Video models

WAN 2.2 remains separate and downstream.

## 13. Next Step
Once stable, pixelize outputs and validate sprite readability on terrain.

## 14. SpriteMagician Integration (Implemented)
### Required Environment Variables
- `RUNPOD_API_KEY`
- `RUNPOD_ENDPOINT_ID`
- `RUNPOD_WORKFLOW_FILE` (optional; defaults to `static/keyframe_sdxl_openpose_depth_ipadapter.json`)

### App Endpoints
- `POST /api/generate-keyframe` (submit RunPod job)
- `GET /api/generate-keyframe-status?runpodId=...` (poll status/result)

### UI Entry Point
- Left panel tab: `🦾 Keyframes`
- Inputs: pose image, reference image, optional depth image, prompt, negative prompt, seed, resolution
- Output: result auto-saved to File Tree (selected folder or Root)

### RunPod Setup Checklist
1. Create/choose a RunPod endpoint and copy endpoint ID.
2. Ensure endpoint accepts ComfyUI workflow input payload.
3. Set `RUNPOD_API_KEY` and `RUNPOD_ENDPOINT_ID` in deployment env.
4. Start with the included workflow template file, then replace with your exported OpenPose+Depth+IP-Adapter workflow JSON.
5. Generate from the `Keyframes` tab and verify status in Jobs queue.
