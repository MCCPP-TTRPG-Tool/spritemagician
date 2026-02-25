# Genesis Controls Implementation Guide

Last Updated: 2026-02-25
Applies to:
- `src/lib/components/DesignPanel.svelte`
- `src/lib/stores/design.js`
- `src/routes/api/generate-character-sheet/+server.js` (and any active Genesis API route)

## Goal

Implement the new Design `Controls` tab capabilities in small, safe, sequential steps.

Do not batch all features into one release.

---

## Step 0 - Controls Tab Scaffold

Deliverables:
- Add third segmented tab button: `Controls`.
- Add placeholder panel describing planned controls.

Validation:
- Switching between `GPT Chat`, `Genesis`, `Controls` is stable.
- Existing Genesis generation flow unchanged.

---

## Step 1 - Preflight Asset Readiness Checklist

Deliverables:
- Add `genesisControls.preflight` booleans to design store.
- Add checklist UI in `Controls` tab:
  - Full body in frame
  - Flat BG
  - Transparent-ready
  - Sprite-safe silhouette
- Build helper function in DesignPanel:
  - `buildPreflightInstructions(preflightState, chromaHex)`
- Merge checklist instructions into outgoing Genesis prompt.

Acceptance:
- Toggling checklist visibly changes the effective request prompt.
- With all toggles off, output payload matches old behavior.

---

## Step 2 - Prompt History + Favorites

Deliverables:
- Add `genesisControls.promptHistory` store state with cap (e.g., 30 items).
- On each successful Genesis generate submit, push history item:
  - prompt text
  - negative prompt snapshot
  - timestamp
  - starred flag
- Controls tab history UI:
  - list recent first
  - star/unstar
  - reuse into current prompt
  - copy prompt
  - delete item

Acceptance:
- Prompts survive reload (persisted in localStorage).
- Starred items are clearly distinguished and reusable in one click.

---

## Step 3 - Seed + Reproducibility Controls

Deliverables:
- Add store fields:
  - `seed`
  - `lockSeed`
  - `lastUsedSeed`
- Controls UI:
  - seed input
  - lock seed checkbox
  - rerun with same seed button
- Request payload updates:
  - include seed when lock is on or explicit seed provided.

Acceptance:
- When `Lock seed` is on, repeated generations send same seed.
- `Rerun with same seed` sends `lastUsedSeed` and triggers generation.

Note:
- If provider ignores seed, keep UI but show compact note: `Provider may not guarantee deterministic replay`.

---

## Step 4 - Negative Prompt Field

Deliverables:
- Add `genesisControls.negativePrompt` to store.
- Controls UI text area for negative prompt.
- Request payload:
  - send `negativePrompt` separately when backend/provider supports it.
  - else append:
    - `Avoid: <negativePrompt>` block to composed prompt.

Acceptance:
- Negative prompt is persistent and editable from Controls tab.
- Request always includes user negative intent in one of the supported forms.

---

## Suggested API/Backend Touchpoints

- Confirm active generation endpoint currently used by `generateGenesis()` and update that route contract:
  - input additions:
    - `negativePrompt?: string`
    - `seed?: string`
    - `preflight?: object`
- Keep backward compatibility by making new fields optional.

---

## Testing Checklist Per Step

- Unit-like checks (where available):
  - prompt composer utilities produce expected text.
- Manual checks:
  - tab switching
  - persistence on reload
  - successful generation path
  - no regression in Save / Refine / Edit / Animate actions
- Failure checks:
  - API error still renders proper inline error.

---

## Release Order (Required)

1. Step 0 scaffold
2. Step 1 checklist
3. Step 2 history/favorites
4. Step 3 seed
5. Step 4 negative prompt

Ship each step separately and confirm stability before moving on.

