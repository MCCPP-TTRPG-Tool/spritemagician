# ComfyUI Character Tool Brief

## Goal
Build a ComfyUI workflow that generates a consistent character across multiple poses in one batch run.

## Requirements
- Keep character identity consistent (face, outfit, proportions, style)
- Accept up to **8 pose references** in one request
- Support **skeleton/keypoint pose references** (OpenPose-style maps)
- Read provided pose references and generate outputs from them with accurate pose adherence
- Apply depth conditioning from provided depth maps or generated depth
- Output up to 8 final images (one per pose reference)
- Include seed control for repeatability
- Exportable as ComfyUI API JSON for backend use

## Inputs
- 1 reference character image
- Up to 8 pose references (provided as OpenPose/keypoint maps)
- Optional depth map(s)
- Prompt and negative prompt
- Seed, resolution, steps, cfg, denoise

## Deliverables
1. Working ComfyUI workflow
2. API-exportable JSON
3. Setup doc (required models and custom nodes)
4. Test run using provided character + 8 pose refs

## Acceptance
- 8 outputs match 8 pose references
- Character remains consistent across outputs
- Depth conditioning is active and verifiable with depth preview/check output
- Workflow runs without missing-node errors
