# Agent Monorepo

Agent is an open source, planner-first agent platform for teams that need safe automation with strong auditability and tenant isolation.

## Purpose

This repository exists to make production-grade agent infrastructure reusable:

- A durable runtime that plans from objectives instead of hardcoded workflows.
- A Postgres-backed observability model that preserves replayability.
- A dashboard surface for operating multi-tenant agent fleets.

## What Is In This Repo

- `apps/dashboard`: Operator-facing views for runs, events, incidents, and metrics.
- `packages/agent-core`: Planner loop, tool contracts, policy gates, and runtime orchestration.
- `packages/agent-observability`: SQL migrations and shared event-log storage model.

## Core Architecture Decisions

- Planner-first loop: decisions come from planner intents (`tool_call`, `ask_user`, `complete`).
- Durable execution: workflow progress is persisted and resumable via signals.
- Event-log first storage: append-only `run_events` with query projections (`runs`, `agents`).
- Safety by default: policy and approval gates execute before side effects.
- Tenant isolation everywhere: runtime, memory, tools, persistence, and dashboards.
- Durable queue boundary for run dispatch:
  - API enqueue path writes tenant-scoped queue jobs.
  - Worker claims jobs with lease tokens and records run progress/events.
  - Queue adapter is swappable for external orchestrators (e.g. Inngest/Temporal).

Detailed architecture and system diagram: `packages/agent-core/docs/ARCHITECTURE.md`.

## Local Development

- Install dependencies: `npm install`
- Start Postgres (Docker): `npm run db:up`
- Apply migrations: `npm run db:migrate`
- Run the workspace in development: `npm run dev`
- Start local queue worker (`agent-runner`): `npm run worker`
- Process one batch once (`agent-runner`): `npm run worker:once`

Database URL resolution order:

1. `AGENT_DATABASE_URL`
2. `DATABASE_URL`
3. Default local DSN `postgres://agent:agent@127.0.0.1:55432/agent_observability`

## Agent Runner Notes

`apps/agent-runner` executes queued workflow jobs. Current planner behavior is:

- Provider-agnostic OpenAI-compatible LLM call layer (AI SDK).
- Multi-provider/model failover chain (`LLM_*`, `GROQ_*`, `OPENAI_*`, `OPENROUTER_*` envs).
- Strict planner-intent validation (`tool_call`, `ask_user`, `complete`) and tool allow-listing.
- Hierarchical memory:
  - Short-term: bounded recent step window in prompt.
  - Long-term: durable memory facts persisted to run events and retrieved by relevance.
  - Memory tools: `memory_write`, `memory_search`.

Runner reliability protections:

- Per-job execution timeout in queue runner.
- Failed executions mark runs as `failed` with `errorSummary`/`endedAt`.

## Open Source Workflow

- Active roadmap: `packages/agent-core/docs/ROADMAP.md`
- Archived phase specs: `packages/agent-core/docs/archive/issues/`
- Retention policy for durable tables: `packages/agent-core/docs/SCHEMA_RETENTION.md`
- Package-specific runtime details: `packages/agent-core/README.md`

## Contribution Expectations

- Keep runtime behavior deterministic and tenant-scoped.
- Add tests first for behavioral changes in planner, safety, persistence, or adapters.
- Favor composition boundaries over inheritance-heavy designs.
- Preserve replayability and audit trails when introducing new features.
