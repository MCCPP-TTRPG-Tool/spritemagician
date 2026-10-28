# Design & Systems Improvement Plan

Last Updated: 2026-02-25

## Objective

Provide a ranked, implementation-aware improvement plan for product design, UX flow, and system architecture without changing existing behavior.

This document builds on the current UI deep dive and is intended as the next decision layer before implementation.

---

## Priority 0 - What Is Working

Before changes, preserve these strengths:

- **Workspace mental model is strong:** left = authoring, center = assets/jobs, right = output actions.
- **Cross-panel handoffs are fast:** generated results move quickly into edit/animate.
- **Power-user throughput is high:** many operations are one-click in dense tool surfaces.
- **Security baseline is now broad:** route hardening and ownership checks reduce backend risk.

---

## Priority 1 - Highest Impact UX/System Fixes

## 1) Reduce mode/state ambiguity in right panel

Problem:
- Right panel behavior changes based on active tab and job-preview overrides, which is powerful but easy to misread.

Improvements:
- Add a persistent "preview context chip" at top-right:
  - `Design Result`, `Edit Result`, `Jobs Preview`, `Animation Playback`, `Export Mode`.
- Add explicit source label under preview:
  - e.g. `Source: Design > Genesis (GPT-4 Image)`.
- Add "Reset preview context" action to clear temporary overrides.

Expected outcome:
- Fewer accidental actions on wrong output (e.g. setting start/end from unintended source).

## 2) Unify save flows into one predictable pattern

Problem:
- Save interactions differ across Design, Edit, Jobs, AnimationPreview, and Export.

Improvements:
- Create a shared save dialog contract:
  - filename
  - destination folder
  - optional metadata tags
  - save confirmation state
- Replace scattered `alert/confirm` flows with a common modal pattern.

Expected outcome:
- Lower cognitive load and fewer failed saves.

## 3) Add generation "job tickets" with consistent lifecycle

Problem:
- Different routes/panels represent progress and completion differently.

Improvements:
- Standardize client job object schema:
  - `id`, `type`, `status`, `sourceTab`, `createdAt`, `resultRefs`, `error`.
- Expose same lifecycle labels everywhere:
  - `queued`, `processing`, `completed`, `failed`, `saved`.

Expected outcome:
- Better traceability and cleaner debugging for users and team.

## 4) Clarify "active asset context" globally

Problem:
- Active asset is important, but users can still perform actions without realizing where outputs go.

Improvements:
- Add sticky global indicator with stronger affordance:
  - folder name/path
  - auto-save state
  - chroma key
- Show inline warning when action would save outside active context.

Expected outcome:
- Fewer misplaced files and easier project organization.

---

## Priority 1 - Deep Pass (Billion-Dollar Quality Bar)

This section adds enterprise-grade depth to Priority 1. It defines quality standards, component contracts, and release gates so implementation quality is consistent and repeatable.

## P1.A Product Quality Principles

Every Priority 1 implementation should satisfy these principles:

- **Clarity over cleverness:** users always know what object they are acting on.
- **Predictable outcomes:** same actions produce same results in every panel.
- **Progressive power:** defaults are simple; advanced controls are available, not overwhelming.
- **Composability:** shared components and contracts replace one-off patterns.
- **Auditable UX:** key workflows emit telemetry for reliability and UX health.

## P1.B Detailed Specs by Initiative

## P1-B1) Right Panel Context Clarity (Spec)

Design goal:
- Remove ambiguity about what is currently previewed and what actions will target.

Must-have UI:
- persistent context header:
  - `Preview Type` chip
  - `Source Pipeline` breadcrumb
  - `Timestamp` and `Model` when available
- action safety line:
  - e.g. "Set Start will use: Jobs Preview > Animation 2026-02-25 13:42"
- `Reset Context` action

State contract (minimum):
- `previewContext.type`
- `previewContext.sourceTab`
- `previewContext.sourceJobId`
- `previewContext.isOverride`
- `previewContext.updatedAt`

Acceptance criteria:
- users can correctly identify active preview source in under 2 seconds.
- no silent context switches without visible indicator changes.
- action buttons always show target object context.

Telemetry:
- `preview_context_changed`
- `preview_action_invoked`
- `preview_context_reset`

## P1-B2) Save-Flow Unification (Spec)

Design goal:
- one save model across Design/Edit/Jobs/Preview/Export.

Canonical save dialog:
- required:
  - filename
  - folder destination
- optional:
  - tags
  - description
  - overwrite behavior
- UX states:
  - `idle`, `validating`, `saving`, `success`, `error`

Unified copy rules:
- clear primary CTA: `Save`
- secondary CTA: `Cancel`
- error copy always includes remediation:
  - "Folder no longer exists. Choose another destination."

Acceptance criteria:
- all save actions open same component pattern.
- no browser `alert/confirm` in standard save flows.
- save success feedback is consistent and dismissible.

Telemetry:
- `save_opened`
- `save_validation_failed`
- `save_succeeded`
- `save_failed`

## P1-B3) Job Lifecycle Standardization (Spec)

Design goal:
- consistent object model and lifecycle for all generated outputs.

Canonical job schema (client-facing):
- `id`
- `kind` (`image`, `animation`, `video`, `3d`)
- `origin` (`design`, `edit`, `animate`, `3d`)
- `status` (`queued`, `processing`, `completed`, `failed`, `saved`)
- `progress` (0-100)
- `resultRefs` (image/frame/video/model URLs or IDs)
- `error` (structured, user-safe)
- `createdAt`, `updatedAt`

Lifecycle UI guarantees:
- every job has visible status
- every terminal job has explicit next actions:
  - `Preview`, `Save`, `Use in ...`, `Discard`
- retries are explicit when route supports retry

Acceptance criteria:
- no panel-specific status vocabulary drift.
- same status colors/icons across center/right surfaces.
- failed jobs always preserve inspectable failure reason.

Telemetry:
- `job_created`
- `job_status_changed`
- `job_retried`
- `job_completed`
- `job_failed`

## P1-B4) Active Asset Context Visibility (Spec)

Design goal:
- make destination context impossible to miss.

UI requirements:
- global "Active Asset" rail (visible from all main tabs)
- destination badge on all save buttons:
  - `Saving to: <folder path>`
- warning state when no active asset is selected

Behavior rules:
- actions that need destination either:
  - auto-use active asset, or
  - open picker with active asset preselected
- no hidden fallback to root without explicit user choice

Acceptance criteria:
- users can always answer "where will this save?" before clicking save.
- accidental root saves reduced to near zero.

Telemetry:
- `active_asset_changed`
- `save_without_active_asset_blocked`
- `save_destination_confirmed`

## P1.C Visual System Standards for Priority 1

To reach big-company polish, enforce:

- **Semantic color roles**
  - primary action, neutral, warning, destructive, success
- **Component sizing tiers**
  - compact, default, dense (workspace mode)
- **Icon discipline**
  - one icon style family, no mixed metaphors
- **Typography consistency**
  - clear hierarchy for label/helper/status/error
- **Spacing rhythm**
  - consistent vertical rhythm for forms and action groups

## P1.D Interaction Quality Rubric (0-5)

Each Priority 1 feature should be scored before release:

- **Discoverability**
  - 0: hidden
  - 5: obvious at first glance
- **Predictability**
  - 0: surprising outcomes
  - 5: consistent and expected
- **Recovery**
  - 0: errors dead-end
  - 5: clear remediation + retry
- **Efficiency**
  - 0: many unnecessary steps
  - 5: streamlined for repeated use
- **Consistency**
  - 0: one-off behavior
  - 5: follows shared contracts

Release gate:
- average score >= 4.0 and no category below 3.5.

## P1.E Engineering/Design Collaboration Model

For each Priority 1 implementation:

- design artifact:
  - flow map + state diagram + component spec
- engineering artifact:
  - file touch list + event/store contract + telemetry events
- QA artifact:
  - acceptance checklist + edge case matrix

This avoids "looks good but breaks flow" releases.

## P1.F Rollout Strategy for Low-Risk Quality Uplift

Recommended order:

1. Ship read-only context indicators first.
2. Introduce unified save modal behind feature flag.
3. Migrate one panel at a time to standardized job schema UI.
4. Turn on stricter destination-context enforcement.

Each rollout should include:
- short dogfooding cycle
- telemetry review
- regression pass on cross-panel handoffs

---

## Priority 2 - Product Design Quality Upgrades

## 5) Create a guided "New Asset Wizard" (future idea already captured)

Problem:
- New users must manually configure many settings to match asset type/style goals.

Improvements:
- Wizard asks:
  - asset category (character, scenery, item, etc.)
  - style family
  - output intent (still, animation, sprite sheet, 3D prep)
- Wizard preconfigures:
  - design presets
  - edit guardrails
  - animate defaults (fps/duration/frame target)
  - chroma/background defaults

Expected outcome:
- Faster first success and better default consistency.

## 6) Introduce "workflow recipes" for repeatable production

Problem:
- Teams repeat manual settings for common pipelines.

Improvements:
- Save/load named recipes:
  - `Design Recipe`
  - `Edit Recipe`
  - `Animate Recipe`
  - combined "pipeline recipe"

Expected outcome:
- Repeatability and better collaboration across users/projects.

## 7) Improve visual hierarchy in dense controls

Problem:
- Panels contain many controls of equal weight.

Improvements:
- Segment controls into:
  - primary actions
  - advanced options
  - destructive actions
- Add collapsible advanced blocks by default in Edit/Animate.

Expected outcome:
- Better scanability without removing power features.

---

## Priority 3 - Systems and Architecture Improvements

## 8) Move in-memory coordination to shared backend stores

Problem:
- In-memory structures (rate limit/progress/ephemeral coordination) are fragile in multi-instance environments.

Improvements:
- Redis/Upstash (or equivalent) for:
  - distributed rate limits
  - progress state
  - short-lived coordination primitives

Expected outcome:
- Production consistency under scale.

## 9) Formalize event contracts used across panels

Problem:
- Multiple custom browser events are effective but loosely typed.

Improvements:
- Define a typed event contract registry:
  - event name
  - payload schema
  - producer/consumer list
- Add lightweight runtime payload guards in development.

Expected outcome:
- Fewer cross-panel regressions.

## 10) Add deterministic telemetry dashboards from usage ledger

Problem:
- Usage is logged, but not yet surfaced as operational dashboards.

Improvements:
- Build dashboard views:
  - route volume/failure rate
  - per-provider latency/cost proxies
  - per-user abuse anomaly indicators

Expected outcome:
- Faster incident response and monetization readiness.

---

## Priority 4 - Craft/Polish Layer

## 11) Keyboard efficiency pass

- Add shortcuts for:
  - tab switching
  - send chat / write prompt
  - set start/end
  - save current result

## 12) Better inline feedback and undo affordances

- Replace passive status text with actionable toasts:
  - saved
  - loaded
  - failed (with retry)
- Add undo for key reversible actions (frame delete, selection clear).

## 13) Visual consistency pass

- Normalize icon language, button sizing, and color semantics across tabs.
- Ensure “primary action” color is consistent by panel role.

---

## Suggested Execution Order

1. Right panel context clarity + save-flow unification.
2. Job lifecycle standardization + active-asset visibility uplift.
3. New Asset Wizard v1 (guided defaults only).
4. Distributed infra upgrades (Redis/telemetry).
5. UX polish and keyboard accelerators.

---

## Definition of Completion for This Plan

This planning phase is complete when:

- stakeholders agree on the top 3 implementation items,
- each selected item has:
  - acceptance criteria,
  - owner,
  - rollout order,
  - success metric.

