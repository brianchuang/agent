-- migrate:up
ALTER TABLE tenant_messaging_settings
  ALTER COLUMN notifier_cascade SET DEFAULT '["web_ui","slack"]'::jsonb;

-- migrate:down
ALTER TABLE tenant_messaging_settings
  ALTER COLUMN notifier_cascade SET DEFAULT '["slack"]'::jsonb;
