# Character Consistency Edit Iteration Plan

## Goal
Enable reliable character-consistent edits across multiple steps, with clear back/forward navigation through edit history.

## Product Outcome
- Users can perform chained edits without losing character identity.
- Users can move backward/forward through prior edits.
- Users can branch from an earlier edit without losing existing work.

## Scope
- Primary focus: character edits in 2D workflow.
- Secondary support: reuse context framework for non-character types.

## Phase 1 - Consistency-First Prompting
1. Add a character identity lock in Edit compiled prompt:
   - Keep identity, silhouette, body proportions, and key outfit/accessory details consistent.
2. Add consistency strength:
   - `Light`, `Medium`, `Strict`.
3. Default context to `Character` in Edit.

### Acceptance Criteria
- In consistency mode, generated outputs preserve recognizable character identity across sequential edits.
- Identity lock appears in compiled prompt when consistency mode is enabled.

## Phase 2 - Sequential Edit Chain
1. Treat edits as a chain of steps:
   - `root -> step1 -> step2 -> ...`
2. Store metadata per step:
   - `id`, `parentId`, `image`, `prompt`, `context`, `settings`, `model`, `createdAt`.
3. New edit defaults to latest accepted step as source.

### Acceptance Criteria
- Every edit result can be traced to a parent step.
- User can continue editing from the latest accepted step without manual source re-selection.

## Phase 3 - Back / Forward Navigation
1. Add Edit history controls:
   - `Back`
   - `Forward`
2. Display current position:
   - Example: `Step 4 of 9`.
3. If editing from an older step, create a new branch automatically.

### Acceptance Criteria
- Back/Forward updates source image and associated step metadata.
- Editing from past history does not overwrite future steps.

## Phase 4 - Branching UX
1. Add branch awareness:
   - Show active branch label.
2. Let user switch branch.
3. Keep branch-local forward path behavior.

### Acceptance Criteria
- Users can navigate and continue work on separate edit branches.
- Branch switching restores correct step sequence and image state.

## Phase 5 - Output Controls for Consistency
1. Add output controls in Edit:
   - Aspect ratio
   - Resolution tier
2. Add simple model routing:
   - Fast iteration model for speed
   - Pro image model for high-fidelity consistency-critical passes

### Acceptance Criteria
- Output controls are reflected in generation request/config.
- Users can choose speed vs fidelity intentionally.

## Phase 6 - Quality Gate Before Accepting Step
1. Add lightweight review checklist before step acceptance:
   - identity drift
   - anatomy artifacts
   - uncropped framing compliance
   - extraction cleanliness
2. Offer one-click retry presets (same source step, stricter consistency).

### Acceptance Criteria
- Users can quickly reject drifted outputs and retry from same step context.

## Data Model (Draft)
- `editTimeline`:
  - `steps: EditStep[]`
  - `activeStepId: string`
  - `activeBranchId: string`
- `EditStep`:
  - `id: string`
  - `parentId: string | null`
  - `branchId: string`
  - `image: string`
  - `prompt: string`
  - `context: string`
  - `strategy: string`
  - `consistencyStrength: string`
  - `createdAt: string`

## Initial Implementation Order (MVP)
1. Phase 1 (prompt consistency lock)
2. Phase 2 (step metadata + parent links)
3. Phase 3 (back/forward buttons)
4. Phase 5 (aspect ratio + resolution controls)
5. Phase 4 (branch UX)
6. Phase 6 (quality gate + retry presets)

## Out of Scope (for MVP)
- Automatic visual embedding similarity scoring.
- Multi-character independent identity locks.
- Full timeline graph visualization.
