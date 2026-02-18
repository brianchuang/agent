# Planner-Driven Scheduling Architecture

## Goal
Allow the planner to schedule future work (one-shot or recurring) with a tool call, without introducing a second orchestration system.

## Core design
1. Planner gets a first-class scheduling tool: `planner_schedule_workflow`.
2. The tool writes directly to the existing `workflow_queue_jobs` table using `available_at`.
3. Worker claims queued jobs when `available_at <= now` and executes them through the normal planner loop.

## Why this design
- Reuses existing queue semantics (`queued -> claimed -> completed|failed`).
- Maintains one execution path for immediate and deferred runs.
- Preserves observability via existing run/run-event tables.
- Avoids coupling scheduler logic into planner runtime internals.

## Tool contract
`planner_schedule_workflow` accepts exactly one strategy:
- `runAt` (ISO datetime)
- `delaySeconds`
- `cron` (5-field UTC cron: minute hour day-of-month month day-of-week)

Optional:
- `objectivePrompt` override
- `threadId` override
- `maxAttempts`

Returns scheduled workflow/request IDs and resolved `availableAt`.

## Recurrence model
- `cron` schedules the next occurrence only.
- Recurrence is "self-perpetuating": each execution should schedule the next one.
- This keeps recurrence explicit in planner policy and audit traces.

## Idempotency
- Scheduled `requestId` is deterministic from parent workflow + step + target time + objective prompt.
- Retries of the same planner step converge on the same `requestId`, preventing accidental duplicate schedules.

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
