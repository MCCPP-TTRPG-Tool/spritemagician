# Sprite Magician Maintenance Guide

Last Updated: 2026-02-24

## Purpose
- Keep the app stable and secure as features grow.
- Ensure every new route/workflow follows the same hardening baseline.
- Provide operational steps for keys, incidents, and routine upkeep.

## 1) Weekly Maintenance Cadence

- Review API errors and recent failures in logs.
- Review usage ledger trends (`users/{uid}/usage_ledger`) for abuse spikes.
- Spot-check expensive routes for latency and timeout regressions.
- Verify no debug/test routes are exposed in production.
- Confirm recent feature merges include session log + state audit updates.

## 2) Mandatory Route Hardening Standard

For any new or changed `src/routes/api/*` endpoint:

1. **Auth**
   - Enforce `locals.user` for any non-public route.
2. **Validation**
   - Validate payload shape, data types, and bounded ranges.
   - Reject malformed input with `400`.
3. **Payload Limits**
   - Use `approxJsonBytes(...)`.
   - Return `413` for oversized requests.
4. **Rate Limiting**
   - Use `enforceRateLimit(...)`.
   - Return `429` with `Retry-After`.
5. **Idempotency**
   - For write/costly endpoints support `Idempotency-Key`.
   - Handle replay/processing/conflict (`409`).
6. **Usage Logging**
   - Record success/failure with `recordUsageEvent(...)`.
7. **Ownership**
   - Enforce user namespace checks (e.g., `users/{uid}/...`) for storage/data access.
8. **Domain Allowlist**
   - Any outbound fetch to user-provided URL must use allowlist checks.

## 3) Secrets and Key Rotation

- Keys live in local `.env` for development.
- Required keys currently include:
  - `GEMINI_API_KEY`
  - `OPENAI_API_KEY`
  - `REPLICATE_API_TOKEN`
  - Firebase Admin keys
- Rotation policy:
  - Rotate immediately if exposed in chat/log/screenshot.
  - Update `.env`.
  - Validate with one smoke request per provider.
  - Record in session log.

## 4) Data Isolation Rules

- Project and animation artifacts must stay user-scoped.
- Storage paths should be under `users/{uid}/...`.
- Read/list operations must only access caller-owned paths.
- Legacy global paths should be treated as migration-only and guarded by ownership checks.

## 5) Incident Response (Fast Path)

If abuse/cost spike is detected:

1. Temporarily reduce route limits (`maxRequests`) on expensive endpoints.
2. Disable non-critical provider routes by short-circuiting with `503`.
3. Revoke exposed provider keys and replace.
4. Review usage ledger for offending accounts/routes.
5. Patch and document in session log + `03_CURRENT_STATE_AUDIT.md`.

## 6) Release Gate (Do Not Skip)

Before shipping:

- Run lints on all touched files.
- Verify auth checks remained intact.
- Verify rate limit + payload guards still active.
- Verify idempotency behavior on retried POSTs.
- Validate a full user flow:
  - Design -> Generate -> Save -> Load -> Export

