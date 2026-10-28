# Workspace UI Deep Dive

Last Updated: 2026-02-25

## Purpose

This document is a deep, implementation-grounded map of the Sprite Magician UI workspace as it exists now, aligned to current tabs and behavior shown in the latest UI screenshots.

Scope:
- 2D mode (Design, Edit, Animate)
- Center column (File Tree, Jobs, Frames)
- Right column (Preview, Export)
- 3D mode (Generate, Rigging, Animate + Preview)
- cross-tab handoffs and state orchestration

---

## 1) Top-Level Workspace Model

The page is a three-column workspace with a global mode switch:

- Left column: task input and generation controls
- Middle column: file and job management
- Right column: output preview and export

Global mode:
- `2D`: full sprite workflow
- `3D`: 3D foundation flow

Persisted panel state:
- active left tab (`design`/`edit`/`animate`)
- active right tab (`preview`/`export`)
- app mode (`2d`/`3d`)

This state is persisted to local storage and restored on load.

---

## 2) Left Column - 2D Tabs

## 2.1 Design Tab

Design has two sub-modes:
- `GPT Chat`
- `Genesis`

Primary controls:
- Generate Type (`character`, `building`, `item`, `asset`, `scenery`, `effects`)
- Theme Style (currently focused on Oil Painting Fantasy in UI)
- Conversations drawer (save/load/delete named chat sessions)
- New Asset modal (creates asset folder and sets active asset context)

### GPT Chat mode

Core behavior:
- conversational ideation over `/api/design-chat`
- optional reference image upload for chat grounding
- chat history stored in `designStore`
- `Write Prompt` converts chat context into a production prompt draft

Chat UX patterns:
- message stream with role separation (user vs assistant)
- attachment support for visual grounding
- explicit transient notes and error messaging
- keyboard Enter to send

### Prompt Draft block

Functions:
- manual editing of drafted prompt
- copy / clear controls
- one-click handoff into Genesis mode (`Use This Prompt in Genesis`)

### Genesis mode

Functions:
- model picker:
  - `Nano Banana (Gemini)`
  - `GPT-4 Image (OpenAI)`
  - `DALL·E (OpenAI)`
- generation call to `/api/generate-sprite`
- reference lock behavior when a reference image exists

Post-generation actions:
- save result to active asset folder
- send result back to chat for iterative refinement
- send result directly to Edit tab
- send result directly to Animate tab
- open full-size modal preview

---

## 2.2 Edit Tab

Edit has two sub-modes:
- `Edit`
- `Expand` (outpainting)

Input options:
- upload image by click or drag-drop
- auto-load image from cross-panel handoff (Design/FileTree/right panel)

### Edit mode

Core concept:
- context-aware edits plus guardrails, then send to `/api/edit-image`

Context presets:
- character, building, item, asset, scenery, effects
- each context has preset prompt snippets
- quick actions include character T-pose and flat background instruction

Guardrail toggles:
- Keep Uncropped
- Remove Background

Prompt strategy:
- if user prompt is blank, system builds a safe default from context
- optional user prompt is appended and normalized

Result behavior:
- result is routed to right preview panel
- optional auto-save to active asset folder when enabled
- emits center modal event for result actions

### Expand mode

Core concept:
- expand canvas in direction (`up/down/left/right/all`)
- generate in expanded region while preserving original image

Controls:
- direction select
- expansion amount slider
- dimension preview (original to expanded size)

---

## 2.3 Animate Tab

Implemented by `GenerationPanel`.

Core inputs:
- Start frame (required)
- End frame (optional or required in interpolation mode)

Animation modes:
- standard animation from one frame
- interpolation (`Start -> End`) using FLF path

Main controls:
- animation type/preset or custom prompt
- max input size cap
- duration, fps, motion/steps
- loop and perfect-loop
- static lock
- remove background
- pixelate output
- frame target planning (auto/manual)

Generation flow:
1. submit generation job (`/api/generate-animation`)
2. poll `/api/generation-progress` by job id
3. extract frames from generated video
4. optional loop shaping
5. optional background removal (`/api/remove-background`)
6. optional pixelation
7. persist output frames into project store and completed jobs

Operational notes:
- progress is visible in-panel
- queue/job status is reflected in middle Jobs tab
- auto-switch to Frames tab can occur when animation completes

---

## 3) Middle Column - File Tree, Jobs, Frames

## 3.1 Active Asset Header

When an asset folder is active, middle header shows:
- active asset name/path
- auto-save toggle
- background chroma key picker
- clear active asset context

This header is a key global context anchor for all tabs.

## 3.2 File Tree Tab

Primary responsibilities:
- browse folders/files
- set active asset workspace
- upload and manage files
- batch actions (select, move, delete, download)
- open file previews and route files to workflows

Important observed behavior:
- single-click folders opens quickly
- supports "Fresh Start" destructive reset with typed confirmation
- supports 3D handoffs (reference/model URLs) into 3D workflow via shared store/events

## 3.3 Jobs Tab

Tracks:
- active queue jobs
- failed jobs
- completed jobs

Actions:
- preview in right panel
- load into project
- add animation jobs to queue
- save selected job outputs to folder
- discard/cancel jobs
- multi-select job operations

Design intent:
- Jobs is the operational control room for generation outcomes before permanent save.

## 3.4 Frames Tab

Primary responsibilities:
- frame-level timeline/grid management
- drag reorder
- frame delete
- frame set active for preview
- save animation object

Also supports unsaved animation switching via tabs and quick discard.

---

## 4) Right Column - Preview and Export

## 4.1 Preview Tab

Context-sensitive:
- if active left tab is Animate and no jobs override: uses `AnimationPreview`
- otherwise shows still-image preview panel

Still preview actions:
- load image into Edit
- set Start frame
- set End frame
- save to folder

Animation preview panel features:
- playback controls
- frame stepping
- FPS adjustments
- ping-pong loop creation
- frame duplication/deletion
- background removal on current/all frames
- save current frame with folder picker and filename

## 4.2 Export Tab

Context-sensitive:
- Animate active: full export toolset
- other tabs: simplified still export actions

Animation export options:
- preview sprite sheet
- export individual frames
- export sprite sheet PNG
- preview/download MP4 (preferred)
- GIF fallback
- save animation package to folder (`/api/save-animation`)

---

## 5) 3D Mode

Left panel (`ModelGeneration3DPanel`):
- tabs: `Generate`, `Rigging`, `Animate`
- generate supports text/image input plus reference URL
- rigging supports provider + model URL
- animate supports provider + model URL + preset
- all actions post to `/api/3d/*` stubs (foundation endpoints)

Right panel (`RigAnimation3DPanel`):
- pure 3D preview with `model-viewer`
- loads selected model URL from shared project store
- no authoring controls; controls stay in left 3D panel

Current maturity:
- UI and hardening baseline are in place
- provider execution remains intentionally stub/foundation state

---

## 6) Cross-Tab Handoffs and Event Contracts

Key handoff patterns currently in use:
- Design generated image -> Edit/Animate via `projectStore`
- FileTree selections -> Edit/Animate/3D via `projectStore`
- Design "navigate" actions -> page-level event (`designNavigate`)
- Jobs preview selection -> right-panel still preview override
- animation loaded flag -> right tab auto-switch to Preview
- 3D model/reference selection -> shared store values consumed by 3D panels

This event/store bridge architecture is the main reason the workspace feels interconnected despite separate panels.

---

## 7) UX Characteristics from Current Screens

Based on current screenshots and implementation:
- the app is optimized for dense, tool-like workflows rather than onboarding simplicity
- center column is the operational backbone (asset context + jobs + frames)
- right column acts as a context-aware action surface, not only passive preview
- Design and Edit tabs are highly iterative and prompt-driven
- Animate balances artist controls with production constraints (looping, frame budget, cleanup)

---

## 8) Known Constraints / Implementation Notes

- some panels still use `alert`/`confirm` prompts for destructive or save actions
- several workflows depend on in-memory state for progress and session UX continuity
- right panel behavior changes by active tab and job preview overrides, which is powerful but non-trivial
- 3D provider calls are scaffolded; UX exists but final pipeline outputs are not fully wired

---

## 9) Recommended Companion Reading

- `docs/PROJECT_TECHNICAL_REFERENCE.md`
- `docs/MAINTENANCE_GUIDE.md`
- `docs/API_ROUTE_CHECKLIST.md`
- `docs/PHASE1_BULLETPROOF_STATUS.md`

