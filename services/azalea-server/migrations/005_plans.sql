CREATE TABLE plans (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  limit_bytes INTEGER NOT NULL CHECK (limit_bytes BETWEEN 1024 AND 1073741824)
);
INSERT INTO plans SELECT 'free', 'Free', free_limit_bytes FROM settings WHERE id = 1;
INSERT INTO plans SELECT 'pro', 'Pro', pro_limit_bytes FROM settings WHERE id = 1;

CREATE TABLE users_new (
  id TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  plan TEXT NOT NULL DEFAULT 'free' REFERENCES plans(id),
  quota_override_bytes INTEGER CHECK (quota_override_bytes BETWEEN 1024 AND 1073741824),
  disabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
INSERT INTO users_new (id, email, password_hash, role, plan, disabled, created_at, updated_at)
  SELECT id, email, password_hash, role, plan, disabled, created_at, updated_at FROM users;
DROP TABLE users;
ALTER TABLE users_new RENAME TO users;

CREATE TRIGGER legacy_free_quota AFTER UPDATE OF free_limit_bytes ON settings
BEGIN UPDATE plans SET limit_bytes = NEW.free_limit_bytes WHERE id = 'free'; END;
CREATE TRIGGER legacy_pro_quota AFTER UPDATE OF pro_limit_bytes ON settings
BEGIN UPDATE plans SET limit_bytes = NEW.pro_limit_bytes WHERE id = 'pro'; END;
CREATE TRIGGER plan_free_quota AFTER UPDATE OF limit_bytes ON plans
WHEN NEW.id = 'free' AND NEW.limit_bytes != (SELECT free_limit_bytes FROM settings WHERE id = 1)
BEGIN UPDATE settings SET free_limit_bytes = NEW.limit_bytes WHERE id = 1; END;
CREATE TRIGGER plan_pro_quota AFTER UPDATE OF limit_bytes ON plans
WHEN NEW.id = 'pro' AND NEW.limit_bytes != (SELECT pro_limit_bytes FROM settings WHERE id = 1)
BEGIN UPDATE settings SET pro_limit_bytes = NEW.limit_bytes WHERE id = 1; END;
INSERT INTO meta (key, value) VALUES ('schema_005_plans', '1');
