# Phase 3: Persistence and Replayability

## Purpose

Make workflow execution restart-safe and audit-ready by persisting state transitions and producing deterministic replay traces.

## Outcomes Required

- Durable schema for request/workflow/step/signal/tool/policy/memory records.
- Repository and transaction boundaries around step commits.
- Exactly-once resume semantics for persisted signals.
- Replay tooling that reconstructs behavior without side effects.

## Contribution Scope

- Add migrations and replay-critical indexes.
- Persist each step atomically, rollback on failure.
- Record checkpoints for pause/resume flows.
- Build trace and drift-diff utilities for CI.

## Definition Of Done

- Fresh database bootstrap works from migrations only.
- Crashes/restarts resume from last committed checkpoint.
- Replay output includes step-level drift visibility.
- Replay reads are tenant-scoped by default.

## Why It Matters

Durability and replayability are prerequisites for operating agents in production and for debugging planner behavior safely.
