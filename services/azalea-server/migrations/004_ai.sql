CREATE TABLE IF NOT EXISTS ai_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  enabled INTEGER NOT NULL DEFAULT 0,
  default_model TEXT NOT NULL DEFAULT '',
  requests_per_minute INTEGER NOT NULL DEFAULT 30,
  max_output_tokens INTEGER NOT NULL DEFAULT 4096
);
INSERT OR IGNORE INTO ai_settings (id) VALUES (1);

CREATE TABLE IF NOT EXISTS ai_providers (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  provider TEXT NOT NULL,
  dialect TEXT NOT NULL,
  base_url TEXT NOT NULL,
  key_ciphertext TEXT NOT NULL DEFAULT '',
  models_json TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS ai_usage (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  window_start INTEGER NOT NULL,
  requests INTEGER NOT NULL
);
