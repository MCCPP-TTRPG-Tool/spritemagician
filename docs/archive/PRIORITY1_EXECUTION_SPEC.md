# Priority 1 Execution Spec

Last Updated: 2026-02-25
Status: Approved Direction -> Implementation Ready (Spec Only)

## Scope

This spec operationalizes Priority 1 from `docs/DESIGN_SYSTEMS_IMPROVEMENT_PLAN.md`:

- Right-panel context clarity
- Save-flow unification
- Job lifecycle standardization
- Active-asset destination clarity

This is documentation-only and does not implement UI.

---

## User Stories

1. As a creator, I can always tell what preview I am acting on before clicking any action.
2. As a creator, every save action behaves the same regardless of panel.
3. As a creator, job statuses use the same vocabulary and action model in all surfaces.
4. As a creator, I can always tell where output will save, and I am blocked from ambiguous destination saves.
5. As a maintainer, I can debug UX failures using deterministic state and telemetry events.

## Non-Goals

- Reworking full visual design system tokens in this phase.
- Changing generation model/provider behavior.
- Rebuilding 3D provider pipelines beyond shared contract alignment.
- Adding new workflow features (wizard/recipes/shortcuts) outside Priority 1.

---

## Component / State / Event Contracts

## 1) Preview Context Contract

### Component Contract: `PreviewContextHeader`

- Props:
  - `context: PreviewContext`
  - `actionTarget: PreviewActionTarget`
  - `onResetContext(): void`
  - `onOpenSource(): void`
- Render guarantees:
  - Always visible at top of right preview surface.
  - Shows chip, source breadcrumb, and update timestamp.
  - Shows explicit action-target line for `Set Start`, `Set End`, `Load in Edit`, `Save`.

### State Contract: `PreviewContext`

```ts
type PreviewContextType =
  | 'design_result'
  | 'edit_result'
  | 'jobs_preview'
  | 'animation_playback'
  | 'export_mode';

type PreviewContext = {
  type: PreviewContextType;
  sourceTab: 'design' | 'edit' | 'animate' | 'jobs' | 'export' | '3d';
  sourceJobId: string | null;
  sourceAssetPath: string | null;
  sourceLabel: string; // human-readable breadcrumb
  modelLabel: string | null; // e.g., GPT-4 Image
  isOverride: boolean; // true when Jobs/temporary override is active
  updatedAt: string; // ISO timestamp
};

type PreviewActionTarget = {
  action: 'set_start' | 'set_end' | 'load_edit' | 'save';
  targetRef: string; // image URL, frame id, or job id
  targetLabel: string; // user-facing target summary
};
```

### Event Contract

- Producer: right panel preview resolver, Jobs click handlers, Design/Edit/Animate result publish actions.
- Consumer: right panel preview component and action CTA wrappers.
- Required emitted UI events:
  - `preview.context.changed`
  - `preview.context.reset`
  - `preview.action.invoked`

---

## 2) Unified Save Flow Contract

### Component Contract: `UnifiedSaveDialog`

- Props:
  - `isOpen: boolean`
  - `request: SaveRequest`
  - `state: SaveDialogState`
  - `onClose(): void`
  - `onSubmit(payload: SaveDialogSubmit): Promise<void>`
  - `onPickFolder(): void`
- Behavior:
  - All save entry points route through this component.
  - No browser `alert`/`confirm` in standard save path.
  - Success and error are rendered in component state, not as blocking browser dialogs.

### State Contract

```ts
type SaveDialogStatus = 'idle' | 'validating' | 'saving' | 'success' | 'error';

type SaveRequest = {
  sourceType: 'image' | 'animation' | 'frame' | 'jobs_output' | 'export_bundle';
  sourceRef: string; // URL, jobId, frameId, or export object id
  defaultFileName: string;
  defaultFolderPath: string | null; // prefilled from active asset if present
  tags?: string[];
  description?: string;
  allowOverwrite: boolean;
};

type SaveDialogSubmit = {
  fileName: string;
  folderPath: string;
  tags?: string[];
  description?: string;
  overwrite: boolean;
};

type SaveDialogState = {
  status: SaveDialogStatus;
  fieldErrors: Record<string, string>;
  globalError: string | null;
  savedRef: string | null; // persisted record/file id
};
```

### Event Contract

- Producer: save CTAs in Design/Edit/Preview/Jobs/AnimationPreview/Export.
- Consumer: save dialog state machine and save service.
- Required emitted UI events:
  - `save.dialog.opened`
  - `save.dialog.validation_failed`
  - `save.dialog.submitted`
  - `save.dialog.succeeded`
  - `save.dialog.failed`

---

## 3) Job Lifecycle Contract

### Component Contract: `JobTicketCard`

- Props:
  - `job: UnifiedJob`
  - `onPreview(jobId: string): void`
  - `onSave(jobId: string): void`
  - `onRetry(jobId: string): void`
  - `onDiscard(jobId: string): void`
- Render guarantees:
  - Every card shows one canonical status label and one canonical status color.
  - Terminal states (`completed`, `failed`, `saved`) expose next actions.
  - Failure state exposes structured user-safe reason.

### State Contract: `UnifiedJob`

```ts
type JobKind = 'image' | 'animation' | 'video' | '3d';
type JobOrigin = 'design' | 'edit' | 'animate' | '3d';
type JobStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'saved';

type UnifiedJob = {
  id: string;
  kind: JobKind;
  origin: JobOrigin;
  status: JobStatus;
  progress: number; // 0..100
  sourceAssetPath: string | null;
  resultRefs: string[]; // URLs/ids
  error: {
    code: string;
    userMessage: string;
    retryable: boolean;
  } | null;
  createdAt: string;
  updatedAt: string;
};
```

### Event Contract

- Producer: all generation route adapters and polling handlers.
- Consumer: Jobs panel, right preview resolver, telemetry dispatcher.
- Required emitted UI events:
  - `job.created`
  - `job.status.changed`
  - `job.retry.requested`
  - `job.completed`
  - `job.failed`
  - `job.saved`

---

## 4) Active Asset Context Contract

### Component Contract: `ActiveAssetRail`

- Props:
  - `context: ActiveAssetContext`
  - `onChangeAsset(): void`
  - `onToggleAutoSave(next: boolean): void`
  - `onChangeChroma(nextHex: string): void`
- Render guarantees:
  - Visible across all main tabs where save-capable actions exist.
  - Save-capable CTAs must show destination badge (`Saving to: <path>`).
  - If no active asset and action needs destination, block and open picker.

### State Contract: `ActiveAssetContext`

```ts
type ActiveAssetContext = {
  assetId: string | null;
  assetName: string | null;
  assetPath: string | null;
  autoSaveEnabled: boolean;
  chromaKeyHex: string | null;
  lastConfirmedAt: string | null; // ISO timestamp of explicit destination confirmation
};
```

### Event Contract

- Producer: file tree asset selection, save dialog destination changes, active asset header controls.
- Consumer: all save entry points and destination badges.
- Required emitted UI events:
  - `asset.active.changed`
  - `asset.destination.confirmed`
  - `asset.destination.blocked_missing_context`

---

## Telemetry Schema

Event namespace: `sm.p1.*`

Common fields on all events:

- `event_id` (uuid)
- `event_ts` (ISO timestamp)
- `user_id`
- `session_id`
- `workspace_mode` (`2d` | `3d`)
- `left_tab`
- `right_tab`
- `active_asset_path` (nullable)
- `build_version`

Event definitions:

1. `sm.p1.preview_context_changed`
   - `context_type`
   - `source_tab`
   - `source_job_id` (nullable)
   - `is_override`
   - `source_label`
2. `sm.p1.preview_context_reset`
   - `previous_context_type`
   - `previous_source_job_id` (nullable)
   - `reset_reason` (`user_click` | `source_unavailable` | `tab_change`)
3. `sm.p1.preview_action_invoked`
   - `action_name` (`set_start` | `set_end` | `load_edit` | `save`)
   - `context_type`
   - `source_job_id` (nullable)
4. `sm.p1.save_opened`
   - `source_type`
   - `source_ref`
   - `default_folder_path` (nullable)
5. `sm.p1.save_validation_failed`
   - `source_type`
   - `error_fields` (string[])
   - `error_codes` (string[])
6. `sm.p1.save_succeeded`
   - `source_type`
   - `destination_path`
   - `duration_ms`
   - `overwrite`
7. `sm.p1.save_failed`
   - `source_type`
   - `error_code`
   - `retryable`
   - `duration_ms`
8. `sm.p1.job_status_changed`
   - `job_id`
   - `job_kind`
   - `job_origin`
   - `from_status`
   - `to_status`
   - `progress`
9. `sm.p1.job_failed`
   - `job_id`
   - `job_kind`
   - `job_origin`
   - `error_code`
   - `retryable`
10. `sm.p1.active_asset_changed`
   - `from_asset_path` (nullable)
   - `to_asset_path` (nullable)
   - `change_source` (`file_tree` | `save_dialog` | `header_control`)
11. `sm.p1.save_without_active_asset_blocked`
   - `entry_point` (`design` | `edit` | `jobs` | `preview` | `export` | `animation_preview`)
   - `source_type`
12. `sm.p1.save_destination_confirmed`
   - `destination_path`
   - `confirmation_source` (`dialog_submit` | `explicit_picker_select`)

---

## QA Acceptance Checklist

- Right preview always shows current source context with no silent switches.
- Action safety line matches actual target object for each right-panel CTA.
- All save triggers open `UnifiedSaveDialog` with consistent states and copy.
- No core save flow uses browser `alert`/`confirm`.
- Jobs tab and any mirrored job surfaces use exact same lifecycle labels/colors.
- Failed jobs expose user-safe reason and retry affordance when retryable.
- Save-capable actions clearly show destination; missing active asset blocks with recoverable path.
- Telemetry events emit once per user action without duplicates for the same transition.

## Edge-Case Matrix

1. Preview override source deleted while selected
   - Expected: context falls back to stable default and emits `preview_context_reset` with `source_unavailable`.
2. Job status polling races (out-of-order updates)
   - Expected: state ignores stale transitions using timestamp/version guard.
3. Save destination removed during open dialog
   - Expected: validation error, prompt reselect, no data loss.
4. Duplicate save submit click
   - Expected: single in-flight save state; second submit ignored.
5. Active asset cleared in another panel before save submit
   - Expected: submit blocked, destination repick required.
6. Retry on non-retryable failure
   - Expected: retry CTA disabled and explanatory helper text shown.
7. Tab switch during in-flight save
   - Expected: save continues; outcome toast/state remains visible on return.
8. Right panel tab/mode change during preview action
   - Expected: action resolves against captured context snapshot or aborts with clear message.

---

## Rollout Plan

Feature flags:

1. `p1_preview_context_header`
   - Enables read-only preview context header and action safety line.
2. `p1_unified_save_dialog`
   - Routes save entry points to unified dialog.
3. `p1_unified_job_ticket_schema`
   - Enables canonical job status model and card rendering.
4. `p1_active_asset_destination_guard`
   - Enforces explicit destination confidence guardrails.

Phased rollout:

1. Phase A (read-only clarity): enable `p1_preview_context_header` for internal users.
2. Phase B (save consistency): enable `p1_unified_save_dialog` on Design + right preview first.
3. Phase C (job fidelity): enable `p1_unified_job_ticket_schema` on Jobs panel, then mirror surfaces.
4. Phase D (destination enforcement): enable `p1_active_asset_destination_guard` with soft warning, then hard block.
5. Phase E (general availability): remove legacy behavior paths after 48h stable telemetry.

Success metrics (must meet for GA):

- `save_succeeded / save_opened >= 0.97`
- `save_failed / save_opened <= 0.03`
- `save_without_active_asset_blocked` trends downward week-over-week after onboarding copy stabilizes.
- Context confusion proxy (`preview_context_reset` with `user_click`) decreases by >= 30% from baseline.
- `job_failed` retry success rate >= 60% for retryable failure classes.

Stop-ship triggers:

- Any core flow executes action against a hidden/incorrect preview context.
- Save behavior differs by panel after `p1_unified_save_dialog` is enabled.
- Job state label mismatch appears across center/right surfaces.
- Missing telemetry on primary actions prevents quality verification.

