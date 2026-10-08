
-- Hive Census: Hive Profile Map
-- Migration 0001
-- Independent from census_current and the hive_census v1 protocol.

CREATE TABLE IF NOT EXISTS profile_locations (
    account TEXT PRIMARY KEY,
    raw_location TEXT,
    normalized_location TEXT,
    location_key TEXT,
    match_id INTEGER,
    match_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (match_status IN (
            'pending', 'matched', 'ambiguous', 'rejected'
        )),
    last_account_update TEXT,
    fetched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (match_id)
        REFERENCES location_matches(id)
);

CREATE INDEX IF NOT EXISTS idx_profile_location_key
    ON profile_locations(location_key);

CREATE INDEX IF NOT EXISTS idx_profile_match_status
    ON profile_locations(match_status);

CREATE TABLE IF NOT EXISTS location_matches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    location_key TEXT NOT NULL UNIQUE,
    original_example TEXT NOT NULL,
    country TEXT,
    country_name TEXT,
    region TEXT,
    region_name TEXT,
    city TEXT,
    lat REAL,
    lon REAL,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN (
            'pending', 'matched', 'ambiguous', 'rejected'
        )),
    confidence REAL,
    source TEXT,
    reviewed_by TEXT,
    reviewed_at TEXT,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_location_matches_status
    ON location_matches(status);

CREATE TABLE IF NOT EXISTS profile_location_overrides (
    account TEXT PRIMARY KEY,
    match_id INTEGER,
    status TEXT NOT NULL
        CHECK (status IN ('matched', 'rejected')),
    reviewed_by TEXT NOT NULL,
    reviewed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (match_id)
        REFERENCES location_matches(id)
);

CREATE TABLE IF NOT EXISTS profile_import_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

INSERT OR IGNORE INTO profile_import_meta (key, value)
VALUES
    ('last_account', ''),
    ('accounts_scanned', '0'),
    ('accounts_with_location', '0'),
    ('import_complete', 'false'),
    ('last_import_run', ''),
    ('last_import_error', '');
