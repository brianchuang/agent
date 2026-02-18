# 07 - Slack Thread Reply Resume via Runtime Signals

## Status
Draft

## Goal
Enable Slack replies in a message thread to resume the same workflow through runtime signals, without adding provider-specific branching to core runtime logic.

## Constraints
- Keep planner-first runtime and current `ask_user` / `resumeWithSignal` contracts.
- Preserve tenant/workspace isolation on all ingress and egress paths.
- Maintain durable, replayable state via persisted signal and audit records.
- Keep composition boundaries: Slack-specific behavior stays outside `packages/agent-core` runtime orchestration.

## Problem
Current outbound wait questions post to Slack, but thread identity (`thread_ts`) is not persisted or reused. Inbound thread replies do not route to `user_input_signal`, and current debugging uses a follow-up run workaround instead of true workflow resume.

## Proposed Design

### 1) Conversation Link Persistence (provider-agnostic)
Add `workflow_message_threads` in `packages/agent-observability` to map workflow waiting state to provider conversation identity.

Fields:
- `tenant_id`
- `workspace_id`
- `workflow_id`
- `run_id`
- `channel_type`
- `channel_id`
- `root_message_id`
- `thread_id`
- `provider_team_id`
- `status`
- `created_at`, `updated_at`

### 2) Outbound Notifier Contract Extension
Extend notifier result from `{ channel, target }` to include:
- `messageId`
- `threadId`

Slack notifier behavior:
- Capture `ts` from `chat.postMessage`
- Treat `ts` as root thread identity for routing
- Persist mapping transactionally with run event append

### 3) Inbound Slack Ingress Boundary
Add Slack Events API route in `apps/dashboard`:
- Handle URL verification and callback events
- Verify Slack signature and timestamp
- Normalize inbound payload into internal `InboundMessageEvent`
- Resolve tenant/workspace/workflow via `workflow_message_threads`

### 4) Runtime Signal Dispatch
Create `WorkflowSignalV1` `user_input_signal` payload:
- `message`
- provider metadata: `channelId`, `userId`, `threadId`, `messageId`, raw provider event id

Dispatch path:
- Signal-ingest service calls `resumeWithSignal`
- Enqueue continuation job for workflow/run scope to continue planner loop

### 5) Idempotency and Ordering
Add `inbound_message_receipts` (observability) keyed by:
- `(provider, team_id, event_id)`
- plus `tenant_id` / `workspace_id`

Behavior:
- Duplicate event: return `200` and no-op
- Workflow not waiting: append audit event and optionally post in-thread "not waiting" response
- Preserve deterministic per-workflow ordering using provider timestamp

### 6) Core Runtime Boundary
Keep `packages/agent-core` provider-agnostic.
Allow only contract-safe additions for signal metadata typing when needed.
Do not add Slack-specific branching in `AgentRuntime`.

## Component Impact
- `packages/agent-observability`
  - Migrations for `workflow_message_threads` and `inbound_message_receipts`
  - Repository/store interfaces + types
- `apps/agent-runner/src/slackNotifier.ts`
  - Return message/thread identity
  - Persist thread mapping through observability interface
- `apps/agent-runner/src/runner.ts`
  - Record provider conversation metadata in run events
- `apps/dashboard/app/api/...`
  - New Slack Events ingest endpoint
  - Signature verification + normalized inbound message handling
- `apps/dashboard/lib/dashboard-service.ts`
  - Signal-ingest orchestration
  - Queue continuation trigger
- `packages/agent-core`
  - Minimal `WorkflowSignalV1` payload typing extension (if necessary)

## Security and Durability
- Never trust Slack channel identity alone; require signed request + persisted mapping.
- Route replies strictly by persisted `thread_id` mapping.
- Persist inbound event receipt and signal ack/failure paths for replay.
- Deduplicate before signal creation.

## Rollout Phases
1. Data model + outbound thread persistence.
2. Inbound Slack ingest + dedupe + signal dispatch.
3. In-thread UX improvements (ack/error responses).
4. Production hardening (SLOs, replay tooling for message-linked workflows).

## TDD Plan
Tests-first sequence:
1. Unit: Slack notifier captures and returns `ts`/thread identity.
2. Unit: Slack ingress signature verification, normalization, and mapping resolution.
3. Unit: Dedup idempotency with repeated Slack event IDs.
4. Integration: `ask_user` -> Slack post -> thread reply -> `user_input_signal` -> resumed completion.
5. Isolation: shared Slack workspace across multiple tenant/workspaces cannot cross-resume.
6. Replay: persisted run events + workflow signals reconstruct pause/resume timeline.

## Acceptance Criteria
- A Slack reply in the same thread resumes the exact waiting workflow (no follow-up run workaround).
- No cross-tenant or cross-workspace resume is possible.
- Duplicate provider events are no-op after first successful receipt.
- Planner loop continuation is observable and replayable from persisted records.
- Core runtime remains provider-agnostic.
