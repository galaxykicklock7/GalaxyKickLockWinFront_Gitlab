-- Supabase table for storing Railway backend URLs per user
-- Run this in the Supabase SQL Editor (Dashboard > SQL Editor)

CREATE TABLE IF NOT EXISTS user_deployments (
  user_id TEXT PRIMARY KEY,             -- clean username (e.g. "bharanitest")
  railway_service_id TEXT,              -- Railway service ID (UUID)
  backend_url TEXT,                     -- stable Railway URL (e.g. "https://chic-luck-production.up.railway.app")
  status TEXT DEFAULT 'stopped',        -- stopped | active
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- RLS Policies
ALTER TABLE user_deployments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read"
  ON user_deployments FOR SELECT
  USING (true);

CREATE POLICY "Allow service role insert"
  ON user_deployments FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Allow service role update"
  ON user_deployments FOR UPDATE
  USING (true);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_user_deployments_status ON user_deployments (status);

-- ─────────────────────────────────────────────────────────
-- ADMIN: Assign a Railway backend to a user
-- Run this manually for each user you want to set up.
-- The CI pipeline only toggles status (active/stopped).
-- ─────────────────────────────────────────────────────────
-- INSERT INTO user_deployments (user_id, railway_service_id, backend_url, status)
-- VALUES ('bharanitest', 'chic-luck', 'https://chic-luck-production.up.railway.app', 'stopped');
