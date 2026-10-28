# Home Page Setup Log

## Status
Planning locked. UI scaffold phase only (no backend changes in this step).

## Confirmed Decisions
- Home is the first page users see on site entry.
- Top navigation order: `Home` / `2D` / `3D`.
- Home keeps the same 3-panel layout used by 2D/3D pages.
- Left panel tabs: `Docs` and `Tutorials` (simple placeholders for now).
- Center panel tabs: `Home` and `Settings` with the same tab style pattern as 2D tabs (emoji + name).
- `Settings` content: empty placeholder ("Under construction").
- Home tab (logged out): show login info + brief website description.
- Home tab (logged in): show 6 project thumbnails, with one card as `Create New Project`.
- `Create New Project` opens a modal.
- Project listing area below thumbnails: thumbnail/icon + project name.
- Right panel: show subscription plans and wallet information.
- Wallet label: `Balance`.
- Existing Firebase auth is available at minimal setup level.
- Mobile behavior should follow current 2D behavior, but center panel must be in focus on initial load.
- Asset/file system integration is deferred and represented with placeholder content for now.

## Initial Implementation Scope (Phase 1)
- Add/enable `Home` route as default entry page.
- Add top nav `Home` button next to `2D`/`3D`.
- Reuse existing 3-panel shell/layout.
- Implement placeholder left panel tabs: `Docs`, `Tutorials`.
- Implement center tab set: `Home`, `Settings`.
- Implement logged-out Home content block (login info + short description).
- Implement logged-in Home content block:
  - 6 thumbnail cards total.
  - include `Create New Project` card.
  - list section under cards with icon + name rows.
- Implement `Create New Project` modal scaffold (placeholder body).
- Implement right panel placeholder blocks:
  - subscription plans section,
  - wallet section with `Balance`.
- Ensure mobile initial focus lands on center panel.

## Security and Rollout Notes
- UI scaffold first; no new write operations to Firebase in this phase.
- Auth state is read-only for conditional rendering in this phase.
- Modal actions remain placeholder-only until project creation flow is defined.
- Placeholder financial values must be clearly marked non-final in UI text.

## Deferred (Later Refactor)
- Asset/file-system redesign and final project source mapping.
- Production project creation flow wiring.
- Subscription data wiring and live balance values.
- Settings tab functionality.

## Acceptance Checklist
- [ ] Home loads first when visiting the site.
- [ ] Nav shows `Home`, `2D`, `3D` in order.
- [ ] 3-panel layout matches existing structure.
- [ ] Left panel contains `Docs` and `Tutorials` placeholders.
- [ ] Center has `Home` and `Settings` tabs with emoji + label style.
- [ ] Logged-out Home view displays login info + brief site description.
- [ ] Logged-in Home view shows 6 thumbnails including `Create New Project`.
- [ ] `Create New Project` opens modal scaffold.
- [ ] Project list appears under thumbnails with icon + name.
- [ ] Right panel shows plans + wallet with `Balance`.
- [ ] Mobile load focuses center panel first.

