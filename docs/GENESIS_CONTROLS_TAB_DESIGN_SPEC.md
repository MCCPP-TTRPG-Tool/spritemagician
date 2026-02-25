# Genesis Controls Tab Design Spec

Last Updated: 2026-02-25
Scope: `src/lib/components/DesignPanel.svelte` (`GPT Chat` / `Genesis` / `Controls`)

## Objective

Add a third `Controls` tab in Design that centralizes generation quality and reproducibility controls.

This tab will own these features:
- Preflight Asset Readiness Checklist
- Prompt History + Favorites
- Seed + Reproducibility Controls
- Negative Prompt Field

Implementation is intentionally phased one feature at a time.

---

## Current UI Baseline

- Design mode switch currently supports `chat` and `genesis`.
- Genesis prompt/model controls are in the Genesis panel.
- No dedicated control surface exists for reproducibility or prompt governance.

---

## Target IA

Top segmented switch in Design:
1. `GPT Chat`
2. `Genesis`
3. `Controls`

`Controls` tab is a dedicated settings/workbench panel and does not replace image result actions.

---

## Controls Tab Sections

## 1) Preflight Asset Readiness Checklist

Purpose:
- Make output constraints explicit before generation.

Initial toggles:
- `Full body in frame`
- `Flat BG`
- `Transparent-ready`
- `Sprite-safe silhouette`

Behavior:
- Each toggle appends/removes deterministic prompt fragments in a generated preflight block.
- Preflight block is merged into the outgoing Genesis prompt at generate-time.

## 2) Prompt History + Favorites

Purpose:
- Preserve successful prompts and enable fast reuse.

Behavior:
- Store recent Genesis prompts (most-recent-first).
- Allow star/unstar as favorites.
- Quick actions: `Reuse`, `Copy`, `Delete`.

## 3) Seed + Reproducibility Controls

Purpose:
- Enable repeatability for iteration and team handoff.

Behavior:
- Show current seed.
- `Lock seed` toggle to reuse same seed across runs.
- `Rerun with same seed` action when a previous run exists.

## 4) Negative Prompt Field

Purpose:
- Explicitly describe artifacts to avoid.

Behavior:
- Dedicated multi-line field.
- Included in request payload as separate field (`negativePrompt`) when provider supports it.
- If provider does not support native negative prompt, append as structured avoid-block in text prompt.

---

## UX Contract

- Keep all control labels plain-language and production-oriented.
- Controls tab must be safe to ignore; Genesis continues to work with defaults.
- No hidden prompt mutation: show a compact `Effective prompt includes controls` indicator.
- No destructive actions without explicit click (`Delete history item` only).

---

## Data Contract (Design Store Additions)

Proposed additions in `src/lib/stores/design.js` state:
- `mode`: allow `'controls'`.
- `genesisControls` object:
  - `preflight`: `{ fullBody, flatBg, transparentReady, spriteSafeSilhouette }`
  - `negativePrompt`: string
  - `seed`: string
  - `lockSeed`: boolean
  - `lastUsedSeed`: string
  - `promptHistory`: array of `{ id, prompt, negativePrompt, createdAt, starred }`

Persistence:
- Persist all controls except transient generation output.

---

## Rollout Plan (One-at-a-time)

Phase 0:
- Add `Controls` tab shell and placeholder panel.

Phase 1:
- Implement Preflight checklist wiring to effective prompt composition.

Phase 2:
- Implement Prompt History + Favorites and reuse actions.

Phase 3:
- Implement Seed + Reproducibility controls.

Phase 4:
- Implement Negative Prompt field + provider fallback behavior.

Each phase ships independently with QA.

---

## QA Acceptance Criteria

1. User can open `Controls` tab from Design segmented control.
2. Genesis generation still works when all controls are untouched.
3. Each phased feature works independently and does not regress chat/genesis core flows.
4. Users can explain where quality/repro settings live in under 2 seconds.

