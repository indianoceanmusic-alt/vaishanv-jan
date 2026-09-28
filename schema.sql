-- Vaishnav Jan gratitude tree
CREATE TABLE IF NOT EXISTS notes (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL CHECK (kind IN ('thanks', 'wish')),
  to_whom     TEXT NOT NULL DEFAULT '',
  body        TEXT NOT NULL,
  color       TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending',  -- pending | live | hidden | rejected
  holds       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_notes_status_created ON notes (status, created_at);

-- Short-lived rate-limit log. Stores a salted daily hash, never an IP address.
CREATE TABLE IF NOT EXISTS hits (
  visitor  TEXT NOT NULL,
  action   TEXT NOT NULL,
  at       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_hits_lookup ON hits (visitor, action, at);
