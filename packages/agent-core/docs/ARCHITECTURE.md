# Agent Architecture

## Why This Architecture Exists

Agent is designed for teams that need autonomous behavior without losing control. The architecture prioritizes safe tool use, resumable execution, and transparent governance in multi-tenant environments.

## System Principles

- Planner-driven execution over hardcoded objective plugins.
- Durable workflows over in-memory loops.
- Safety gates before side effects.
- Tenant/workspace isolation by construction.
- Event log as source of truth, projections for fast reads.
- Composition-first modules for replaceability and testability.

## Architecture Diagram

```mermaid
flowchart TD
  A[Objective Request V1\n(tenant + workspace scoped)] --> B[Agent Runtime]
  B --> C[Planning Context Builder]
  C --> D[Planner Adapter]
  D --> E[Typed Intent Validation]
  E --> F{Intent Type}
  F -->|tool_call| G[Policy + Approval Gates]
  F -->|ask_user| H[Workflow Waiting State]
  F -->|complete| I[Terminal Completion]
  G --> J[Tool Registry]
  J --> K[Action Adapter Boundary]
  K --> L[External Providers]
  B --> M[Persistence Port]
  M --> N[(Postgres Event Log +\nWorkflow Tables)]
  N --> O[Read Projections\n(runs, agents)]
  O --> P[Dashboard API]
  Q[Signals: approval/timer/webhook/user] --> B
  B --> R[Audit + Metrics]
  R --> P
```

## Execution Lifecycle

1. Runtime receives `ObjectiveRequestV1`.
2. Context is built from memory, policy constraints, and prior steps.
3. Planner returns a typed intent.
4. Runtime validates intent and tenant/tool authorization.
5. Policy and approval stages allow, block, or rewrite intent.
6. Tool calls execute through adapter boundaries with idempotency and retry controls.
7. Step outcomes, audit records, and workflow status are committed transactionally.
8. Workflow continues, completes, fails, or pauses for a signal and later resumes.

## Storage Strategy

- Canonical history: append-only `run_events`.
- Durable workflow state: request/step/signal/policy/tool execution tables.
- Query ergonomics: projection tables (`runs`, `agents`) for dashboard reads.
- Replay support: deterministic traces from persisted state.

## Boundaries That Must Stay Stable

- Contracts: request envelopes, planner intents, signals, and tool schemas are versioned.
- Safety: no side effect may bypass policy/approval checks.
- Isolation: no cross-tenant data access without explicit authorization.
- Durability: crash/restart must resume from committed workflow checkpoints.

## Where To Contribute

- New tools: implement schema + execution via `toolRegistry` and adapters.
- New policies: add deterministic rules through policy engine interfaces.
- New storage adapters: implement persistence ports without changing runtime orchestration semantics.
- New evaluation suites: add domain scenarios in quality/scalability harnesses.
