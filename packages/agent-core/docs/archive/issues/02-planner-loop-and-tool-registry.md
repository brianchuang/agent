# Phase 2: Planner Loop and Tool Registry

## Purpose

Replace objective-specific control flow with a general planner loop that selects tools dynamically from registered capabilities.

## Outcomes Required

- Durable planner loop with terminal and waiting states.
- Tool registry with schema-validated arguments.
- Planner/runtime contract boundary that supports provider swaps.
- Tenant-aware tool authorization and execution gating.

## Contribution Scope

- Implement loop stages as composable units (context, plan, validate, execute).
- Add workflow state transitions and resume entrypoints.
- Route `tool_call` intents only through the registry boundary.
- Add deterministic test tools and loop behavior tests.

## Definition Of Done

- Loop can complete, pause (`ask_user`), fail deterministically, and resume by workflow ID.
- Unknown tools and invalid args are rejected before handler invocation.
- Planner adapters are swappable without modifying core loop logic.
- Tenant unauthorized tool use is blocked pre-execution.

## Why It Matters

This is the phase that turns the system from scripted automation into an actual agent runtime.
