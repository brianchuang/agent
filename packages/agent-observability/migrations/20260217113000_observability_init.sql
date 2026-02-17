-- migrate:up
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner TEXT NOT NULL,
  env TEXT NOT NULL CHECK (env IN ('prod', 'staging')),
  version TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('healthy', 'degraded', 'offline')),
  last_heartbeat_at TIMESTAMPTZ NOT NULL,
  error_rate NUMERIC(5,2) NOT NULL DEFAULT 0,
  avg_latency_ms INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agents_last_heartbeat_at
  ON agents (last_heartbeat_at DESC);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('success', 'failed', 'running', 'queued')),
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  latency_ms INTEGER,
  error_summary TEXT,
  trace_id TEXT NOT NULL,
  retries INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_runs_agent_started
  ON runs (agent_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_runs_status_started
  ON runs (status, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_runs_trace_id
  ON runs (trace_id);

CREATE TABLE IF NOT EXISTS run_events (
  event_sequence BIGSERIAL PRIMARY KEY,
  event_id UUID NOT NULL UNIQUE,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  stream_position BIGINT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('state', 'tool_call', 'log')),
  level TEXT NOT NULL CHECK (level IN ('info', 'warn', 'error')),
  message TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL,
  correlation_id TEXT,
  causation_id TEXT,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  workspace_id TEXT NOT NULL DEFAULT 'default',
  idempotency_key TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_run_events_stream_position UNIQUE (run_id, stream_position),
  CONSTRAINT chk_run_events_event_id_uuidv7 CHECK (substring(event_id::text from 15 for 1) = '7')
);

CREATE INDEX IF NOT EXISTS idx_run_events_run_stream
  ON run_events (run_id, stream_position DESC);

CREATE INDEX IF NOT EXISTS idx_run_events_run_occurred
  ON run_events (run_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_run_events_tenant_workspace_seq
  ON run_events (tenant_id, workspace_id, event_sequence DESC);

CREATE INDEX IF NOT EXISTS idx_run_events_idempotency_key
  ON run_events (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- migrate:down
DROP TABLE IF EXISTS run_events;
DROP TABLE IF EXISTS runs;
DROP TABLE IF EXISTS agents;
