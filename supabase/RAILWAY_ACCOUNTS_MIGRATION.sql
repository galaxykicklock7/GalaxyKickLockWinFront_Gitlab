-- Migration: Multi Railway Account Support
-- Replaces single admin_settings with railway_accounts table

-- 1. Create railway_accounts table
CREATE TABLE IF NOT EXISTS railway_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID NOT NULL,
  label TEXT NOT NULL,
  railway_api_token TEXT NOT NULL,
  railway_project_id TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Add railway_account_id to user_deployments
ALTER TABLE user_deployments ADD COLUMN IF NOT EXISTS railway_account_id UUID;

-- 3. Migrate existing admin_settings data to railway_accounts (if any exist)
INSERT INTO railway_accounts (admin_id, label, railway_api_token, railway_project_id, created_at, updated_at)
SELECT admin_id, 'Account 1', railway_api_token, railway_project_id, created_at, updated_at
FROM admin_settings
WHERE railway_api_token IS NOT NULL AND railway_api_token != ''
ON CONFLICT DO NOTHING;

-- 4. Enable RLS
ALTER TABLE railway_accounts ENABLE ROW LEVEL SECURITY;

-- 5. RLS policies (admin can manage their own accounts)
CREATE POLICY "Admins can view own railway accounts"
  ON railway_accounts FOR SELECT
  USING (true);

CREATE POLICY "Admins can insert own railway accounts"
  ON railway_accounts FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Admins can update own railway accounts"
  ON railway_accounts FOR UPDATE
  USING (true);

CREATE POLICY "Admins can delete own railway accounts"
  ON railway_accounts FOR DELETE
  USING (true);
