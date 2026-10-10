
-- Hive Census
-- Migration 0004: Administrator authentication

CREATE TABLE IF NOT EXISTS admin_auth_challenges (
    nonce TEXT PRIMARY KEY,
    account TEXT NOT NULL,
    message TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    consumed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_admin_challenges_expiry
ON admin_auth_challenges(expires_at);

CREATE TABLE IF NOT EXISTS admin_sessions (
    token_hash TEXT PRIMARY KEY,
    account TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TEXT NOT NULL,
    revoked_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_admin_sessions_expiry
ON admin_sessions(expires_at);
