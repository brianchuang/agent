-- migrate:up
CREATE TABLE IF NOT EXISTS tenant_messaging_settings (
  tenant_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL DEFAULT '*',
  notifier_cascade JSONB NOT NULL DEFAULT '["slack"]'::jsonb,
  slack_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  slack_default_channel TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, workspace_id)
);

CREATE INDEX IF NOT EXISTS idx_tenant_messaging_settings_tenant
  ON tenant_messaging_settings (tenant_id, workspace_id);

-- migrate:down
DROP TABLE IF EXISTS tenant_messaging_settings;
