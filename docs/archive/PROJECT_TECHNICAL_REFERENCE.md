# Sprite Magician Technical Reference

Last Updated: 2026-02-24

## 1) What This Project Is

Sprite Magician is a SvelteKit application for sprite production workflows. It currently supports:

- 2D workflows: design ideation, still-image edit, animation generation, preview, and export.
- 3D foundation workflows: mode toggle, file-tree handoff, generation/rig/animate stubs, and right-side 3D preview.
- Asset/file management with Firebase (Firestore + Storage) and session-authenticated API routes.

The UI is organized as a 3-panel workspace:

- Left panel: workflow controls (2D tabs or 3D tabs).
- Center panel: file system/jobs/frames.
- Right panel: 2D preview/export or 3D model preview.

## 2) Runtime Architecture

### Frontend

- SvelteKit + Svelte 5 runes.
- TailwindCSS via Vite plugin.
- Client Firebase SDK for auth + Firestore realtime subscriptions.

### Backend (inside SvelteKit routes)

- Server API routes under `src/routes/api`.
- Firebase Admin SDK for server-side auth verification, Firestore writes, and Storage access.
- External AI providers:
  - Google Gemini (`@google/genai`) for image generation/edit/style flows.
  - Replicate for video/image utilities (animation, rembg, upscale).
  - RunPod integration helpers for keyframe workflows.

### Deployment/Config

- Adapter: Vercel (`@sveltejs/adapter-vercel`) with Node runtime 22.
- Firestore rule policy scoped per-user document tree (`/users/{uid}/**`).

## 3) Auth and Session Model

### Flow

1. User signs in via Google in `src/routes/login/+page.svelte`.
2. Client gets Firebase ID token.
3. Client exchanges token with `POST /api/session`.
4. Server sets HTTP-only `__session` cookie.
5. `src/hooks.server.js` verifies cookie on each request and populates `event.locals.user`.
6. `src/routes/+layout.server.js` enforces redirect guard (`/login` if unauthenticated).
7. `src/routes/+layout.svelte` also signs client Firebase auth with `/api/get-client-token` for Firestore rules compatibility.

### Important Behavior

- Server auth and client auth intentionally run in parallel:
  - Server cookie secures routes/API.
  - Client auth token is required for Firestore realtime listeners.

## 4) UI Shell and Mode Routing

Primary shell: `src/routes/+page.svelte`

- Tracks:
  - `appMode`: `2d` or `3d`
  - `activeTab` (left 2D): `design | edit | animate`
  - `rightTab` (right 2D): `preview | export`
- Persists panel state in localStorage.
- Keeps center panel (`CenterPanel`) constant across modes.
- Listens for cross-component events (`designNavigate`, `open3DMode`, job preview events).
- Supports right-panel still actions: load into edit, set start/end, save to folder.

## 5) Component Map (What Each One Does)

### Core shell panels

- `DesignPanel.svelte`: design chat + prompt drafting + genesis generation + asset creation/save.
- `EditPanel.svelte`: image edit/expand flow with presets, local persistence, and save-to-folder.
- `GenerationPanel.svelte`: animation generation, interpolation mode, frame extraction + post-processing controls.
- `CenterPanel.svelte`: tabs for file tree, jobs, and frames; active-asset controls.
- `AnimationPreview.svelte`: timeline-style playback and frame save actions.
- `ExportPanel.svelte`: frame export, sprite sheet, GIF/MP4 generation and save/download.

### 3D panels

- `ModelGeneration3DPanel.svelte`: left 3D tabs (`Generate`, `Rigging`, `Animate`) + calls to `/api/3d/*`.
- `RigAnimation3DPanel.svelte`: right 3D preview-only viewer using `@google/model-viewer` web component.

### File and jobs ecosystem

- `FileTree.svelte`: realtime file manager, context actions, upload/folder ops, 2D/3D handoff events.
- `JobsPanel.svelte`: queue + completed jobs, preview routing, save operations.
- `FramesPanel.svelte`: frame list/reorder/remove and unsaved animation switching.
- `FolderPicker.svelte`: reusable folder selection modal.
- `AnimationQueueBar.svelte`, `JobQueue.svelte`, `CompletedJobsViewer.svelte`, `FrameEditor.svelte`: queue/history editing and presentation helpers.

### Wizard/specialized tooling

- Deprecated legacy panels (`CharacterWizard`, `AssetWizard`, `KeyframePanel`, `PosePanel`, `SpriteGenerator`) have been removed from `src/lib/components` to keep the active 2D surface focused on `Design`, `Edit`, and `Animate`.
- `AutoFitPanel.svelte`: adaptive panel scaling wrapper.
- `FrameUpload.svelte`: reusable drag/drop upload control.

## 6) Store Layer (State Management)

### Core stores

- `projectStore` (`src/lib/stores/project.js`)
  - Primary working state: frames, fps, prompt, first/last frame, mode settings.
  - Includes cross-panel handoff fields (`editImage`, `styleImage`).
  - Includes 3D handoff fields (`threeDReferenceImage`, `threeDModelUrl`).
  - Persisted to localStorage.

- `designStore`
  - Chat-mode design ideation state, draft prompt, reference image, saved conversations.
  - Persisted with normalization/size limits.

- `activeAssetStore`
  - Current asset folder context (`folderId/name/path`), autosave toggle, chroma key color.
  - Persisted to localStorage.

- `userFiles`
  - Realtime file tree data and folder navigation.
  - Subscribes to Firestore children via `onSnapshot`.

### Supporting stores

- `authStore`: UI-level auth flags and user profile.
- `jobQueue`: active/pending/failed queue state.
- `completedJobs`: completed jobs with IndexedDB support for large payloads.
- `animationQueue`: queue composition and project-frame restoration.
- `unsavedAnimations`, `animations`, `poses`, `assets`: workflow-specific libraries/buffers.

## 7) API Surface (Current Route Inventory)

All routes below are in `src/routes/api`.

### 3D

- `POST /api/3d/generate` — 3D generation foundation endpoint (auth required, provider not yet wired).
- `POST /api/3d/rig` — 3D rigging foundation endpoint (auth required, provider not yet wired).
- `POST /api/3d/animate` — 3D animation foundation endpoint (auth required, provider not yet wired).

### Auth/session

- `POST /api/session` — create session cookie from Firebase ID token.
- `DELETE /api/session` — clear session cookie.
- `GET /api/get-client-token` — mint Firebase custom token for client Firestore auth.

### File/project persistence

- `POST /api/upload-file` — upload base64 file to Firebase Storage (auth required).
- `POST /api/replace-file` — overwrite/replace existing stored file.
- `POST /api/create-folder` — create folder doc in Firestore (auth required).
- `POST /api/save-project` — store project metadata + frame assets.
- `GET /api/load-project` — load single project by `projectId`.
- `POST /api/load-project` — list projects.
- `POST /api/save-animation` — save `.anim.json` + thumbnail.
- `GET /api/load-animation` — CORS-safe load of animation JSON from Firebase URL.

### 2D generation/edit pipelines

- `POST /api/generate-sprite` — sprite genesis via Gemini.
- `POST /api/design-chat` — design chat + prompt drafting.
- `POST /api/edit-image` — edit/expand image using Gemini cascade.
- `POST /api/generate-animation` — image-to-video generation (Replicate models).
- `GET /api/generation-progress` — progress polling for in-memory jobs.
- `POST /api/extract-frames` — server helper for extraction fallback paths.
- `POST /api/generate-frames` — sequential/parallel frame generation utility route.
- `POST /api/generate-keyframe` — RunPod keyframe job submission.
- `GET /api/generate-keyframe-status` — RunPod keyframe job polling.
- `POST /api/generate-character-sheet` — turnaround-style sheet generation.
- `POST /api/generate-styled-character` — style transfer flow with style anchor.
- `POST /api/generate-controlnet-pose` — RunPod pose generation path.

### Processing helpers

- `POST /api/remove-background` — Replicate rembg integration.
- `POST /api/upscale` — Replicate Real-ESRGAN integration.
- `POST /api/proxy-image` — allowlisted image proxy to base64.

### Style anchor + diagnostics

- `GET /api/style-anchor` — get current style metadata.
- `PUT /api/style-anchor` — set new style anchor.
- `DELETE /api/style-anchor` — clear style cache/config.
- `GET|POST /api/test-replicate` — Replicate connectivity/model test route.
- `GET /api/test-models` — model list/info route.

## 8) Server Utility Modules

- `src/lib/server/gemini.js`
  - Gemini singleton client, model cascade, image extraction helpers, style constants.

- `src/lib/server/runpod.js`
  - RunPod job submit/status helpers, workflow template loading, placeholder replacement.

- `src/lib/server/styleAnchor.js`
  - Master style image resolution stack (cache -> Firestore -> Storage/local fallback).
  - Set/get style anchor metadata and cache invalidation.

## 9) Firebase Modules

- `src/lib/firebase/client.js`
  - Client app initialization, auth provider, Firestore instance.

- `src/lib/firebase/admin.js`
  - Server Admin initialization and accessors (`auth`, `db`, `storage`).
  - Session cookie and ID-token verification helpers.

- `src/lib/firebase/firestore.js`
  - Client CRUD for file tree docs and realtime subscriptions.
  - Includes upsert-by-name behavior for same-name replacement.

## 10) Utility Modules

- `backgroundCleanup.js` — chroma cleanup and spill-removal post-processing.
- `videoFrameExtractor.js` — video/GIF/WebP extraction logic with timeout guards.
- `imagePrep.js` — input resizing and sharpness prep.
- `spriteSheet.js` — sheet generation + image loading/proxy integration.
- `gifEncoder.js` / `mp4Encoder.js` — export encoders.
- `firebaseStorage.js` — Firebase Storage upload/delete helpers.
- `generationProgress.js` — in-memory progress map.
- `projectSave.js` / `projectExport.js` / `pixelate.js` — project/export helper functions.

## 11) Blender and Godot Add-on Area

Directory: `BlenderSpriteSheetTool`

- Python add-on entry:
  - `__init__.py`
  - `spritemagician_spritegen.py`
- Add-on specification:
  - `Blender_Isometric_Sprite_Sheet_Addon_Spec.md`
- Godot importer assets:
  - `spritemagician_godot_importer.gd`
  - `godot_plugin/spritemagician_importer/*`
  - `godot_plugin/README.md`

This toolset is separate from the SvelteKit app runtime and appears intended for DCC/export pipeline workflows.

## 12) Environment Variables in Use

Referenced by server runtime:

- `GEMINI_API_KEY`
- `REPLICATE_API_TOKEN`
- `RUNPOD_API_KEY`
- `RUNPOD_ENDPOINT_ID`
- `RUNPOD_WORKFLOW_FILE` (optional override)
- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY`
- `FIREBASE_STORAGE_BUCKET` (optional explicit bucket)

## 13) Notes on Current 3D Status

The 3D UI and routing are integrated into the main shell and file-browser handoff path, but backend provider wiring for generation/rig/animate is still scaffold-level. The preview path is functional (`model-viewer`) and driven by `projectStore.threeDModelUrl`.

## 14) Suggested Documentation Split (Ready for Professional Docs Pass)

This reference can be split into publication docs:

- `docs/architecture.md` — system design + auth + data flow.
- `docs/api-reference.md` — per-endpoint request/response contracts.
- `docs/frontend-workflows.md` — panel/tab workflows and store interactions.
- `docs/operations.md` — environment variables, deployment, Firebase rules.
- `docs/roadmap-3d.md` — 3D provider integration plan and acceptance criteria.

