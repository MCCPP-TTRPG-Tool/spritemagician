# File System Refactor Mission (No Asset Model)

## Mission Objective
Replace the current asset-based file workflow with a folder-first file system that is simple, predictable, and Windows-like in list browsing behavior.

## Locked Product Decisions
- Remove all Asset concepts from UI and data model.
- Remove `Select Asset` completely.
- Save from preview panel only (additional save options later).
- Save flow uses folder-picker modal; users must choose destination folder (no implicit fallback).
- Remove all `New Asset` actions and asset metadata flows.
- Add File Tree view toggle: `Grid` and `List` (File Tree tab only).
- List mode includes sortable columns and folder-first ordering.
- List rows include:
  - small icon,
  - name,
  - type,
  - modified (and other columns),
  - left-side details toggle,
  - `...` actions menu.
- Single click behavior:
  - folder: open folder,
  - file: open preview.
- No double-click behavior.
- View mode preference persists per project in Firestore.
- Hard cleanup/migration of legacy asset-oriented data.
- Store `presetId` on generated files now for future preset linkage.
- Future scope: add separate Presets tab and file-to-preset jump/load actions.

## Execution Rules For This Mission
- Implement one task at a time.
- After each task:
  - stop,
  - report what changed,
  - wait for user response (`next` or requested adjustment).
- No parallel feature changes outside current task.

## Task List (One-By-One)

### Task 1 - Data Model Cutover (Asset Removal)
Scope:
- Remove active-asset dependencies from client stores and save routing assumptions.
- Remove asset-specific metadata fields from new writes.
- Keep folder/file structures intact.

Acceptance:
- No runtime dependency on active asset for preview save flow.
- New writes no longer add asset-specific metadata.

### Task 2 - Hard Migration Plan + Script
Scope:
- Create and run migration script/path to remove/normalize legacy asset fields in Firestore.
- Keep user folders/files valid after migration.

Acceptance:
- Legacy asset-only fields removed or normalized.
- Existing folders/files still load and save correctly.

### Task 3 - File Tree Command Cleanup
Scope:
- Remove `New Asset` buttons/modals and any asset-labeled commands.
- Replace with neutral folder/file actions only.

Acceptance:
- No `Asset` wording remains in file-system UI for this flow.
- Create folder/upload/new actions still function.

### Task 4 - Save Destination Modal Enforcement
Scope:
- Preview save always opens folder picker.
- No default auto-save destination.
- Save action blocked until folder explicitly selected.

Acceptance:
- Save cannot proceed without explicit folder selection.
- Selected folder receives saved file successfully.

### Task 5 - List Mode UI (Windows-style v1)
Scope:
- Add File Tree list mode with sortable columns:
  - icon, name, type, modified, plus selected additional columns.
- Maintain folder-first ordering.
- Add per-row `...` actions menu.

Acceptance:
- Users can toggle grid/list in File Tree tab.
- Column sorting works.
- Folder-first ordering works in list view.

### Task 6 - Row Details Drawer + Editing Actions
Scope:
- Add left-side row toggle control for expandable details panel.
- Show file metadata (size, date, type, modified, etc.).
- Include edit actions in details/actions path.

Acceptance:
- Metadata drawer opens per row.
- Edit options available from row actions/details.

### Task 7 - Single-Click Behavior Standardization
Scope:
- Enforce single-click interactions:
  - folder opens,
  - file loads preview.
- Remove double-click dependency from file interactions.

Acceptance:
- No double-click required anywhere in File Tree browsing.

### Task 8 - Per-Project Preference Persistence (Firestore)
Scope:
- Persist view mode (`grid`/`list`) in project document.
- Restore preference when switching projects.

Acceptance:
- View mode follows project settings across sessions/devices.

### Task 9 - Preset Linking Metadata (Forward Compatibility)
Scope:
- Add `presetId` field support on generated file records.
- Ensure metadata is available in file info/details payloads.

Acceptance:
- New generated files include `presetId` when available.
- Metadata path ready for future Presets tab linkage.

## Out-Of-Scope (Current Mission Pass)
- Full Presets tab UI implementation.
- Advanced multi-select keyboard emulation parity beyond current behavior.
- New billing/subscription behavior.

## Reporting Template (After Each Task)
- Task completed:
- Files changed:
- Behavior verified:
- Known gaps:
- Awaiting user response: `next` / changes requested.

