-- Admin settings table for storing Railway credentials
-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS admin_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID REFERENCES admins(id) ON DELETE CASCADE,
  railway_api_token TEXT NOT NULL,
  railway_project_id TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(admin_id)
);

-- RLS
ALTER TABLE admin_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated read" ON admin_settings FOR SELECT USING (true);
CREATE POLICY "Allow authenticated insert" ON admin_settings FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow authenticated update" ON admin_settings FOR UPDATE USING (true);

-- Add token_id column to user_deployments to link token <-> service
ALTER TABLE user_deployments ADD COLUMN IF NOT EXISTS token_id UUID;
