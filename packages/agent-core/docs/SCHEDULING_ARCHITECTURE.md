# Control-Plane Scheduling Architecture

## Goal
Allow one-shot and recurring work through queue semantics while keeping planner tools primitive-only.

## Core design
1. Scheduling is handled by control-plane dispatch and queue metadata.
2. Queue jobs are materialized in `workflow_queue_jobs` with `available_at`.
3. Worker claims queued jobs when `available_at <= now` and executes through the normal planner loop.

## Why this design
- Reuses existing queue semantics (`queued -> claimed -> completed|failed`).
- Maintains one execution path for immediate and deferred runs.
- Preserves observability via existing run/run-event tables.
- Keeps planner/runtime contracts free of orchestration macros.

## Recurrence model
- Recurrence is represented as queue/control-plane scheduling metadata.
- Planner intents stay focused on primitive tool calls, asking users, and completion output.

## Idempotency
- Scheduled `requestId` remains deterministic where control-plane enqueues are derived from prior workflow state.
- Retries of the same enqueue operation converge on the same identity inputs to prevent duplicates.

## Operational behavior
- Scheduled runs are visible as normal runs with queue and state events.
- Existing lease and retry logic applies unchanged.
- No separate cron daemon is required beyond the existing queue worker loop.
- Queue runner should enforce per-job execution timeouts and mark failed runs terminally
  (`status=failed` with error summary) to avoid stuck `running` runs.

## Planner Context Guidance
- Keep short-term planner context bounded by token budget.
- Store durable scheduling/user facts in long-term memory and retrieve on demand.
- Avoid replaying full historical step logs into every planning call.
