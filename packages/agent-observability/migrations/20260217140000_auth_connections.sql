-- migrate:up
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  image TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider_id TEXT NOT NULL, -- e.g., 'google'
  provider_account_id TEXT NOT NULL, -- e.g., google sub
  access_token TEXT, -- encrypted
  refresh_token TEXT, -- encrypted
  expires_at BIGINT, -- unix timestamp
  scope TEXT,
  token_type TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_connections_provider_user UNIQUE (user_id, provider_id)
);

CREATE INDEX IF NOT EXISTS idx_connections_user_id ON connections(user_id);

-- migrate:down
DROP TABLE IF EXISTS connections;
DROP TABLE IF EXISTS users;
