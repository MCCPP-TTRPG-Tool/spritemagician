# Phase 1 Bulletproof Status

Last Updated: 2026-02-25

## Scope

Phase 1 focuses on hardening existing behavior:

- auth enforcement
- payload limits
- rate limits
- idempotency for write/costly routes
- usage telemetry for billing/audit readiness
- ownership and tenant isolation

## Coverage Snapshot (Current)

### Fully Hardened (auth + rate + size + idempotency + usage)

- `upload-file`
- `replace-file`
- `save-animation`
- `save-project`
- `create-folder`
- `generate-animation`
- `generate-frames`
- `extract-frames`
- `proxy-image`
- `remove-background`
- `upscale`
- `generate-sprite`
- `edit-image`
- `design-chat`
- `generate-keyframe`
- `generate-controlnet-pose`
- `generate-character-sheet`
- `generate-styled-character`
- `style-anchor`
- `generation-progress`
- `3d/generate`
- `3d/rig`
- `3d/animate`

### Partially Hardened (auth present, missing one or more controls)

- `load-project` (missing idempotency; read route)
- `load-animation` (missing idempotency; read route)
- `generate-keyframe-status` (ownership-bound + rate/usage; no payload/idempotency needed for read polling route)
- `generation-progress` (ownership-bound + rate/usage; no payload/idempotency needed for read polling route)

### Intentionally Special Routes

- `session`
  - Auth bootstrap/session lifecycle routes; require dedicated handling and should not blindly follow same idempotency model.
- `get-client-token`
  - Auth-gated and rate-limited; idempotency is intentionally not required for token-mint read flow.
- `test-models` and `test-replicate`
  - Already auth-gated and blocked in production.

## Important Security/Isolation Notes

- Project save/load now uses user-scoped storage paths:
  - `users/{uid}/projects/{projectId}/...`
- `load-project` list now reads only user-scoped prefix.
- Legacy fallback reads (`projects/{id}`) are ownership-guarded by `ownerUid`.
- `load-animation` now enforces both storage-domain allowlist and user path ownership marker.
- `generate-keyframe-status` now enforces per-user ownership binding (`runpodId` must exist under caller's `users/{uid}/runpod_jobs` record).
- `generation-progress` now enforces per-user ownership binding for in-memory jobs (`jobId` must be owned by caller UID).

## Remaining Work (Priority)

### Priority 1 (high-impact)

1. Add idempotency to:
   - `load-project` (optional for read-route replay behavior)
   - `load-animation` (optional for read-route replay behavior)
2. Add strict schema validation for all remaining advanced generation routes.

### Priority 2

1. Add standardized response/error envelope for all generation routes.

### Priority 3

1. Replace in-memory rate limiting with shared backend store (Redis/Upstash) for multi-instance consistency.
2. Add metric dashboards/alerts using usage ledger aggregation.

## Definition of Done for Phase 1

Phase 1 is complete when:

- Every non-bootstrap production API route has:
  - auth (unless intentionally public)
  - validation + bounded numeric/string constraints
  - payload limit
  - rate limit
  - usage telemetry
- Every write/costly route supports idempotency keys.
- Ownership checks are present on all data load/replace/list paths.
- Maintenance docs remain up-to-date:
  - `docs/MAINTENANCE_GUIDE.md`
  - `docs/API_ROUTE_CHECKLIST.md`
  - `docs/PHASE1_BULLETPROOF_STATUS.md`

