-- migrate:up
ALTER TABLE agents ADD COLUMN system_prompt TEXT;
ALTER TABLE agents ADD COLUMN enabled_tools JSONB NOT NULL DEFAULT '[]'::jsonb;

-- migrate:down
ALTER TABLE agents DROP COLUMN enabled_tools;
ALTER TABLE agents DROP COLUMN system_prompt;
