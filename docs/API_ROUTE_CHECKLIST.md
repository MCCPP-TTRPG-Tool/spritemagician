# API Route Hardening Checklist

Use this checklist whenever adding or modifying any `src/routes/api/*` endpoint.

## Security Baseline

- [ ] Requires auth (`locals.user`) unless route is intentionally public.
- [ ] Rejects malformed input with explicit `400` errors.
- [ ] Enforces payload-size limit with `approxJsonBytes`.
- [ ] Enforces per-user rate limits with `enforceRateLimit`.
- [ ] Enforces ownership checks for user-scoped data (`users/{uid}/...`).
- [ ] Uses domain allowlist if route fetches external/user-provided URLs.

## Determinism and Cost Safety

- [ ] Supports `Idempotency-Key` for write/costly operations.
- [ ] Correctly handles:
  - [ ] replayed request
  - [ ] duplicate in-progress request (`409`)
  - [ ] same key with different payload (`409`)
- [ ] Writes usage telemetry via `recordUsageEvent` on success and failure.

## Validation

- [ ] Numeric inputs are bounded and normalized.
- [ ] String IDs are format-validated (regex/length).
- [ ] Arrays have min/max length limits.
- [ ] Data URLs and HTTP URLs are explicitly validated as needed.

## Operational

- [ ] Provider key requirements return actionable errors.
- [ ] Timeouts/failure paths are captured in logs.
- [ ] Lints pass on all touched files.
- [ ] Session log created for the change.
- [ ] `03_CURRENT_STATE_AUDIT.md` updated.

