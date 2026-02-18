-- migrate:up
CREATE TABLE IF NOT EXISTS workflow_message_threads (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  workflow_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  channel_type TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  root_message_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  provider_team_id TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT workflow_message_threads_status_check CHECK (status IN ('active', 'closed'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_workflow_message_threads_provider_thread
  ON workflow_message_threads (tenant_id, workspace_id, channel_type, channel_id, thread_id);

CREATE INDEX IF NOT EXISTS idx_workflow_message_threads_lookup
  ON workflow_message_threads (channel_type, channel_id, thread_id, provider_team_id, status);

CREATE TABLE IF NOT EXISTS inbound_message_receipts (
  provider TEXT NOT NULL,
  provider_team_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (provider, provider_team_id, event_id)
);

CREATE INDEX IF NOT EXISTS idx_inbound_message_receipts_scope
  ON inbound_message_receipts (tenant_id, workspace_id, received_at DESC);

CREATE TABLE IF NOT EXISTS workflow_signal_inbox (
  signal_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  workflow_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  signal_type TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT workflow_signal_inbox_status_check CHECK (status IN ('pending', 'consumed'))
);

CREATE INDEX IF NOT EXISTS idx_workflow_signal_inbox_pending
  ON workflow_signal_inbox (tenant_id, workspace_id, workflow_id, status, occurred_at);

-- migrate:down
DROP TABLE IF EXISTS workflow_signal_inbox;
DROP TABLE IF EXISTS inbound_message_receipts;
DROP TABLE IF EXISTS workflow_message_threads;
