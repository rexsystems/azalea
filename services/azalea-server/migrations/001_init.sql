-- Azalea sync server schema v1

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro')),
  disabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS vaults (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  version INTEGER NOT NULL DEFAULT 0,
  kdf_salt TEXT NOT NULL,
  verifier TEXT NOT NULL,
  recovery_envelope TEXT,
  ciphertext TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  signup_enabled INTEGER NOT NULL DEFAULT 0,
  captcha_provider TEXT NOT NULL DEFAULT 'none',
  captcha_site_key TEXT NOT NULL DEFAULT '',
  captcha_secret_key TEXT NOT NULL DEFAULT '',
  free_limit_bytes INTEGER NOT NULL DEFAULT 262144,
  pro_limit_bytes INTEGER NOT NULL DEFAULT 10485760,
  instance_name TEXT NOT NULL DEFAULT 'Azalea'
);

INSERT OR IGNORE INTO settings (id) VALUES (1);
