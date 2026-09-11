-- Desktop PKCE authorization codes for the browser -> desktop-app handoff.
-- Row lifecycle:
--   1. Desktop calls /v1/auth/desktop/begin -> row created with handle_hash + challenge, user_id NULL.
--   2. Web user visits /authorize?handle=... and calls /v1/auth/desktop/approve -> code_hash set, user_id bound.
--   3. Desktop calls /v1/auth/desktop/exchange with handle + code + verifier -> row is deleted on success.
-- Rows past expires_at are pruned on every begin/approve/exchange call.

CREATE TABLE IF NOT EXISTS desktop_auth_codes (
  handle_hash TEXT PRIMARY KEY NOT NULL,
  code_challenge TEXT NOT NULL,
  client_state TEXT NOT NULL,
  code_hash TEXT,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  approved_at TEXT,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_desktop_auth_codes_expires_at ON desktop_auth_codes(expires_at);
