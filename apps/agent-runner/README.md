# Agent Runner

`agent-runner` is the queue worker that claims workflow jobs and executes planner loops.

## Commands

- Start worker loop: `npm run worker`
- Process a single batch and exit: `npm run worker:once`
- Package-level run: `npm run start --workspace agent-runner`

## Planner/LLM Strategy

The planner call path is provider-agnostic through AI SDK (`ai` + `@ai-sdk/openai` using OpenAI-compatible endpoints).

## Prompt Layering

Runtime system prompt is composed in two layers:

- Base prompt (framework-owned): shared agentic workflow behavior for all agents.
- Agent overlay prompt (optional, plain text): per-agent domain/persona guidance.

Composition order enforces framework invariants:

- Base prompt
- Agent overlay
- Immutable framework rules (appended last)

This keeps one generic workflow while still allowing bounded agent specialization.

### Overlay Authoring + Migration

Existing agents that previously stored full runtime prompts should migrate `systemPrompt` to overlay-only content:

- Keep domain context, business rules, style guidance, and examples.
- Remove workflow-control directives (response format, tool-use policy, ask-user gating).
- Keep overlay plain text; disallowed instruction-override lines are ignored at runtime.
- Keep overlays concise; very long overlays are truncated to cap prompt growth.

Provider/model chain is configured via env vars:

- Primary: `LLM_API_KEY`, `LLM_API_BASE_URL`, `LLM_MODEL_CHAIN`
- Groq: `GROQ_API_KEY`, `GROQ_API_BASE_URL`, `GROQ_MODEL_CHAIN`
- OpenAI: `OPENAI_API_KEY`, `OPENAI_API_BASE_URL`, `OPENAI_MODEL_CHAIN`
- OpenRouter: `OPENROUTER_API_KEY`, `OPENROUTER_API_BASE_URL`, `OPENROUTER_MODEL_CHAIN`
- Shared: `LLM_TEMPERATURE`

The runner tries models/providers in order. Unknown tool outputs are rejected before execution.

## Hierarchical Memory

Planner context is split into short-term and long-term memory:

- Short-term memory: recent planner steps only (`SHORT_TERM_STEP_LIMIT`, default `6`)
- Long-term memory: durable facts retrieved from run events (`LONG_TERM_MEMORY_LIMIT`, default `5`)

Memory tools:

- `memory_write`: persist durable facts for future runs
- `memory_search`: retrieve durable facts by relevance

## Reliability Guards

- Job execution timeout in queue runner (`executeTimeoutMs`, default `120000`)
- Failed executions mark run status as `failed` and persist error summary

## Waiting-Signal Notifications

When a workflow pauses in `waiting_signal`, the worker can escalate the question via tenant messaging settings.
Current channel support: Slack.

Environment variables:

- `WAITING_SIGNAL_NOTIFIER=slack`
- `SLACK_BOT_TOKEN` (bot token with `chat:write`)
- Optional fallback only: `SLACK_DEFAULT_CHANNEL` (fallback channel ID, e.g. `C123...`)
- Optional fallback only: `SLACK_CHANNEL_BY_SCOPE_JSON` to route by tenant/workspace.
  - Format: `{"tenantId:workspaceId":"C123..."}`.
- Optional fallback channel order: `WAITING_SIGNAL_NOTIFIER_CASCADE` (comma-separated, currently `slack` only).
- Optional: `AGENT_DASHBOARD_BASE_URL` to include a run link in the Slack message.

Tenant settings are stored in `tenant_messaging_settings`:
- Workspace override row: `(tenant_id, workspace_id)`
- Tenant default row: `(tenant_id, '*')`

Resolution order:
1. Workspace-level settings
2. Tenant-level default settings
3. Env fallback channel mapping
