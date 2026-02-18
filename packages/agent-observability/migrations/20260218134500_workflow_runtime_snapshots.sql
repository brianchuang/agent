-- migrate:up
CREATE TABLE IF NOT EXISTS workflow_runtime_snapshots (
  tenant_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  workflow_id TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, workspace_id, workflow_id)
);

CREATE INDEX IF NOT EXISTS idx_workflow_runtime_snapshots_updated
  ON workflow_runtime_snapshots (updated_at DESC);

-- migrate:down
DROP TABLE IF EXISTS workflow_runtime_snapshots;
