# Left Tabs UI Consistency Redesign Spec

Last Updated: 2026-02-25  
Scope: `Design`, `Edit`, `Animate` tabs only (deprecated tabs removed)

## Objective

Deliver a clean, even, professional left-panel experience with:
- visual consistency across all three tabs,
- predictable interaction flow,
- improved Edit-tab clarity without degrading Design/Animate strengths.

This is a documentation and implementation-planning spec.

---

## Current Assessment

## What already works
- `Design` has clear generation intent, coherent hierarchy, and strong post-result actions.
- `Animate` has strong step structure (source -> setup -> generate -> output framing).
- Tab-level navigation and panel density are generally good for power users.

## Main issue
- `Edit` feels comparatively cluttered and uneven:
  - too many controls compete at the same visual priority,
  - weak section rhythm,
  - inconsistent control styles compared to Design/Animate,
  - less obvious primary action path.

---

## Product Quality Targets

1. **One rhythm:** same spacing cadence and section framing across all tabs.
2. **One hierarchy:** each tab has one obvious primary CTA and one linear reading flow.
3. **One language:** labels, helper text, chips, and toggles follow the same voice and placement rules.
4. **One state model:** loading, success, warning, and error feedback feel identical.
5. **No regression:** Design/Animate behavior quality must remain stable while Edit is upgraded.

---

## Shared Left-Tab Layout Contract

Each tab follows this shell in order:

1. **Tab Header Row**
   - title + compact context utilities
   - optional secondary actions with subdued styling
2. **Primary Input/Source Block**
   - large, consistent preview/input frame
   - source status and quick clear/swap controls
3. **Configuration Block(s)**
   - grouped settings cards with clear subsection labels
   - advanced settings either collapsed or visually de-emphasized
4. **Primary Action Block**
   - single dominant CTA (full width)
   - disabled reason visible inline when action cannot run
5. **Result/Handoff Block**
   - consistent success note + next actions (Save/Edit/Animate variants)

---

## Visual Consistency Contract

## Spacing + density
- Use one vertical rhythm scale per tab section stack: `8 / 12 / 16` px only.
- Section cards use identical padding, border, radius, and title weight.
- Avoid mixed-density rows in same block (no tiny chip row beside full-height inputs unless grouped as utility row).

## Component hierarchy
- **Primary CTA:** full-width, strong contrast, reserved for generate/apply action.
- **Secondary CTA:** outlined/soft-filled style for utility actions.
- **Tertiary actions:** text buttons only for low-priority actions.
- Toggles/chips/checks should share one common treatment system across tabs.

## Copy style
- Section titles: short noun phrases (`Edit Context`, `Animation Setup`).
- Helper copy: one sentence max, action-oriented.
- Status copy: outcome + next step, not just outcome.

---

## Edit Tab Redesign (Primary Focus)

## A) Top block normalization (match Animate/Design rhythm)
- Keep the Edit/Expand mode switch, but visually align it to the same segmented-control style used elsewhere.
- Source image frame should match Animate source frame treatment:
  - same border weight, corner radius, padding rhythm, and clear/remove affordance placement.
- Dimension metadata (`0×0`) should be contextual and de-emphasized under the frame.

## B) Context controls hierarchy
- Split current mixed controls into two layers:
  - **Core Context (always visible):**
    - Context type selector
    - Keep subject uncropped
    - Remove background
  - **Advanced Context (collapsible):**
    - presets and guardrail diagnostics
    - technical tuning options
- Keep two-column compact controls only when both controls are same priority.

## C) Preset UX cleanup
- Rename `Pose / Context Preset` to `Quick Direction` for broader applicability.
- Replace "Apply" micro-CTA with immediate-apply selection behavior or clearer inline `Apply Preset` action.
- Keep active preset and active guardrails in one unified status strip.

## D) Prompt composer upgrade
- `Edit Instructions` remains the anchor input.
- Add compact prompt aids (chips) below input:
  - `Preserve silhouette`
  - `Keep scale fixed`
  - `Flat BG #00FF00`
  - `No crop`
- Chips append structured text to prompt to reduce manual repetition.

## E) Primary action clarity
- Keep one dominant CTA: `Apply Edit`.
- Show explicit disabled reason directly below CTA when blocked (no source image, empty prompt, processing state).
- Keep result status row aligned with Design/Animate messaging style.

## F) Post-result handoff parity
- Once edit result exists, use a consistent handoff action row analogous to Design:
  - `Save`
  - `Refine` (re-edit)
  - `Animate`
- Keep ordering and button weights consistent with Design result actions.

---

## Design + Animate Light Consistency Pass

Design and Animate are already strong. Apply only low-risk consistency refinements:

- normalize section title spacing and icon sizing with Edit updates.
- align button heights and corner radii with shared CTA system.
- align helper/status row style (same muted panel + icon + text rules).
- preserve current IA and generation behavior.

---

## Interaction + State Consistency

All three tabs should share the same feedback semantics:

- **idle:** neutral helper text
- **loading:** CTA spinner + “working” verb (`Generating...`, `Applying...`)
- **success:** concise completion note + next action
- **error:** inline error panel with action-oriented fix guidance

No blocking alerts in standard path.

---

## QA Acceptance Checklist

1. User can identify primary action in each tab in under 1 second.
2. Section order feels structurally identical across Design/Edit/Animate.
3. Edit tab no longer has “crowded” or “mixed-priority” perception in heuristic review.
4. Post-result handoff actions are consistent between Design and Edit.
5. No behavior regressions in generation, preview handoff, save, or animate routing.
6. Mobile/compact widths preserve hierarchy and CTA visibility.

---

## Rollout Plan

## Phase 1 - Design contract + shared primitives
- finalize spacing, card, CTA, and status row primitives.
- no behavior changes.

## Phase 2 - Edit structural redesign
- implement Edit IA + hierarchy changes first.
- test against existing Design/Animate interactions.

## Phase 3 - Cross-tab polish
- apply shared visual tokens to Design and Animate.
- perform final consistency pass.

## Phase 4 - Validation
- run scripted QA for all three tabs.
- collect user review snapshots before/after.

---

## Non-Goals

- introducing new generation capabilities.
- redesigning center/right panels in this spec.
- changing model/provider logic.
- reintroducing deprecated wizard/pose/keyframe flows.

