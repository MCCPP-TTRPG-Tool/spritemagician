# Product Quality Bar

Last Updated: 2026-02-25

## Purpose

Define the practical quality standard for Sprite Magician to feel "built by top-tier product companies" across UX, systems behavior, and release discipline.

This is a standing quality contract, not a one-time checklist.

---

## 1) Experience Standards

## 1.1 Immediate Comprehension

A user should understand within 5 seconds:
- where they are
- what object is active
- what primary action does next

Any screen that fails this should be redesigned before adding more controls.

## 1.2 Action Confidence

Before action, the UI must make clear:
- action target
- destination
- expected result
- reversibility

## 1.3 Recovery Quality

Failures must include:
- plain-language cause
- immediate remediation path
- retry option when possible

No dead-end errors in core flows.

## 1.4 Consistency Over Local Optimization

Equivalent interactions should feel equivalent:
- same save pattern
- same status vocabulary
- same button hierarchy
- same feedback conventions

---

## 2) Interface Standards

## 2.1 Hierarchy

Every panel must visually separate:
- primary action
- supporting controls
- advanced controls
- destructive actions

## 2.2 Feedback

Every non-trivial action must provide:
- in-progress feedback
- success/failure outcome
- next recommended action

## 2.3 Context Transparency

Global context must always be visible:
- active asset
- active preview source
- active mode (2D/3D)

If hidden, accidental mistakes increase.

---

## 3) Systems Standards

## 3.1 Deterministic State Contracts

Shared stores/events must have explicit contracts:
- schema
- producer/consumer ownership
- fallback behavior for missing payload fields

## 3.2 Lifecycle Fidelity

Every job-oriented workflow should use explicit lifecycle phases:
- queued
- processing
- completed
- failed
- saved

## 3.3 Multi-Instance Readiness

Any operational state that affects user correctness should not depend on process memory in production.

---

## 4) Metrics Standards

Track and monitor:
- action success rate
- time to first successful output
- save failure rate
- retry success rate
- confusion proxy events (context reset frequency, canceled saves)

No "quality claims" without telemetry evidence.

---

## 5) Release Standards

## 5.1 Pre-Release Gate

Required for major UX/system changes:
- design review pass
- contract review pass
- telemetry verification
- regression checklist

## 5.2 Post-Release Gate

Within 48 hours:
- monitor top flow metrics
- review errors/failures by route and UI action
- validate no major behavior regressions

---

## 6) Red Flags (Stop-Ship)

Do not ship if any core flow has:
- ambiguous destination/action target
- inconsistent save behavior with other panels
- status mismatch between panel surfaces
- silent failure without actionable message

---

## 7) Practical Application in Current Workspace

Near-term enforcement focus:
- right-panel context clarity
- save-flow unification
- job lifecycle normalization
- active-asset visibility and destination confidence

These are the leverage points most likely to make the product feel "enterprise-grade" quickly.

