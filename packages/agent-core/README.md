# @agent/core

`@agent/core` is the reusable runtime package for planner-driven agents.

## Purpose

This package provides the execution model for objective-based automation without embedding domain-specific workflow code.

## Responsibilities

- Accept and validate versioned objective requests.
- Run a planner loop that emits typed intents.
- Resolve and execute tools through schema-validated registries.
- Enforce policy and approval gates before side effects.
- Persist workflow, step, signal, and audit state through repository boundaries.
- Support replay/evaluation/scalability harnesses for CI confidence.

## Runtime Model

Architecture-significant flow (intentionally simplified):

```ts
const runtime = new AgentRuntime(agentId, memory, { persistence, toolRegistry, policyEngine });
const result = await runtime.runPlannerLoop(objectiveRequestV1);
```

Everything outside the runtime boundary (providers, storage engines, policy packs) is replaceable via composition.

## Key Modules

- `src/core/agentRuntime.ts`: planner loop orchestration and signal resume flow.
- `src/core/contracts.ts`: request, intent, tool, policy, and signal contracts.
- `src/core/toolRegistry.ts`: tool definitions, validation, and authorization.
- `src/core/adapters.ts`: provider-agnostic adapter interfaces and idempotent dispatch wrappers.
- `src/core/persistence/repositories.ts`: transactional persistence ports and adapters.
- `src/core/replay.ts`: deterministic trace materialization and replay diffing.
- `src/core/evaluation.ts` / `src/core/scalability.ts`: quality and cross-domain guardrails.

## Adjacent Docs

- Architecture and system diagram: `docs/ARCHITECTURE.md`
- Active roadmap: `docs/ROADMAP.md`
- Archived phase specs: `docs/archive/issues/`
- Schema retention policy: `docs/SCHEMA_RETENTION.md`
