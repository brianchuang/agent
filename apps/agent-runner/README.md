# Agent Runner

`agent-runner` is the queue worker that claims workflow jobs and executes planner loops.

## Commands

- Start worker loop: `npm run worker`
- Process a single batch and exit: `npm run worker:once`
- Package-level run: `npm run start --workspace agent-runner`

## Planner/LLM Strategy

The planner call path is provider-agnostic through AI SDK (`ai` + `@ai-sdk/openai` using OpenAI-compatible endpoints).

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
