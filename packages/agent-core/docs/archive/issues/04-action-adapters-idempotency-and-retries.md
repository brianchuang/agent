# Phase 4: Action Adapters, Idempotency, and Retries

## Purpose

Protect external side effects behind stable adapter boundaries with deterministic duplicate prevention and retry behavior.

## Outcomes Required

- Provider-agnostic action adapter interfaces.
- Idempotency keys and execution dedupe strategy.
- Retry taxonomy and deterministic backoff controls.
- Callback/webhook routing into workflow signal resumes.

## Contribution Scope

- Normalize adapter request/response/error contracts.
- Enforce tenant-scoped credential resolution at adapter boundary.
- Persist idempotency and retry metadata for replay safety.
- Add tests for in-flight duplicates, collisions, and terminal failures.

## Definition Of Done

- Planner loop never calls provider SDKs directly.
- Retries only occur for retryable classes (timeouts, 429, retryable 5xx).
- Non-retryable failures stop deterministically with actionable metadata.
- Callback-driven resumes do not duplicate side effects.

## Why It Matters

If side-effect execution is not idempotent and bounded, replay and resume flows become unsafe in real integrations.
