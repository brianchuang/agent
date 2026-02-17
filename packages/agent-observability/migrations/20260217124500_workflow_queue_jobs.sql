-- migrate:up
CREATE TABLE IF NOT EXISTS workflow_queue_jobs (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  workflow_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  objective_prompt TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'claimed', 'completed', 'failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  available_at TIMESTAMPTZ NOT NULL,
  lease_token TEXT,
  lease_expires_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_workflow_queue_request UNIQUE (tenant_id, workspace_id, request_id)
);

CREATE INDEX IF NOT EXISTS idx_workflow_queue_claim
  ON workflow_queue_jobs (status, available_at, lease_expires_at);

CREATE INDEX IF NOT EXISTS idx_workflow_queue_scope_status
  ON workflow_queue_jobs (tenant_id, workspace_id, status, available_at);

CREATE INDEX IF NOT EXISTS idx_workflow_queue_workflow
  ON workflow_queue_jobs (tenant_id, workspace_id, workflow_id);

-- migrate:down
DROP TABLE IF EXISTS workflow_queue_jobs;
