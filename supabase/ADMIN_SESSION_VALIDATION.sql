-- =====================================================
-- Admin Session Validation - Server-side session management
-- Run this AFTER COMPLETE_DATABASE_SETUP.sql
-- =====================================================

-- Admin sessions table
CREATE TABLE IF NOT EXISTS public.admin_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID NOT NULL REFERENCES public.admins(id) ON DELETE CASCADE,
  session_token TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  is_active BOOLEAN DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_admin_sessions_token ON public.admin_sessions(session_token);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_admin_id ON public.admin_sessions(admin_id);

-- Enable RLS
ALTER TABLE public.admin_sessions ENABLE ROW LEVEL SECURITY;

-- No direct access — only via RPC functions
CREATE POLICY "No direct access to admin_sessions"
  ON public.admin_sessions
  FOR ALL
  USING (false);

-- =====================================================
-- Replace authenticate_admin to create a real session
-- =====================================================
CREATE OR REPLACE FUNCTION public.authenticate_admin(
  p_username TEXT,
  p_password TEXT
)
RETURNS JSON AS $$
DECLARE
  v_admin RECORD;
  v_session_token TEXT;
  v_session_id UUID;
  v_expires_at TIMESTAMPTZ;
BEGIN
  SELECT id, username, password_hash, is_active
  INTO v_admin
  FROM public.admins
  WHERE username = p_username;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Invalid credentials');
  END IF;

  IF NOT v_admin.is_active THEN
    RETURN json_build_object('success', false, 'error', 'Admin account is disabled');
  END IF;

  IF v_admin.password_hash != crypt(p_password, v_admin.password_hash) THEN
    RETURN json_build_object('success', false, 'error', 'Invalid credentials');
  END IF;

  -- Update last login
  UPDATE public.admins
  SET last_login = NOW()
  WHERE id = v_admin.id;

  -- Invalidate old sessions for this admin (single active session)
  UPDATE public.admin_sessions
  SET is_active = false
  WHERE admin_id = v_admin.id AND is_active = true;

  -- Create new session (24-hour expiry)
  v_session_token := encode(gen_random_bytes(32), 'hex');
  v_expires_at := NOW() + INTERVAL '24 hours';

  INSERT INTO public.admin_sessions (admin_id, session_token, expires_at)
  VALUES (v_admin.id, v_session_token, v_expires_at)
  RETURNING id INTO v_session_id;

  RETURN json_build_object(
    'success', true,
    'admin_id', v_admin.id,
    'username', v_admin.username,
    'session_token', v_session_token,
    'expires_at', v_expires_at
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- Validate admin session (server-side check)
-- =====================================================
CREATE OR REPLACE FUNCTION public.validate_admin_session(
  p_session_token TEXT
)
RETURNS JSON AS $$
DECLARE
  v_session RECORD;
BEGIN
  IF p_session_token IS NULL OR p_session_token = '' THEN
    RETURN json_build_object('valid', false, 'error', 'No session token');
  END IF;

  SELECT s.id, s.admin_id, s.expires_at, s.is_active, a.is_active AS admin_active
  INTO v_session
  FROM public.admin_sessions s
  JOIN public.admins a ON a.id = s.admin_id
  WHERE s.session_token = p_session_token;

  IF NOT FOUND THEN
    RETURN json_build_object('valid', false, 'error', 'Session not found');
  END IF;

  IF NOT v_session.is_active THEN
    RETURN json_build_object('valid', false, 'error', 'Session has been invalidated');
  END IF;

  IF NOT v_session.admin_active THEN
    -- Admin account disabled — invalidate session
    UPDATE public.admin_sessions SET is_active = false WHERE id = v_session.id;
    RETURN json_build_object('valid', false, 'error', 'Admin account is disabled');
  END IF;

  IF v_session.expires_at < NOW() THEN
    -- Session expired — mark inactive
    UPDATE public.admin_sessions SET is_active = false WHERE id = v_session.id;
    RETURN json_build_object('valid', false, 'error', 'Session expired');
  END IF;

  RETURN json_build_object('valid', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION public.validate_admin_session(TEXT) TO anon, authenticated;

-- Cleanup: delete expired admin sessions older than 7 days (run periodically)
-- DELETE FROM public.admin_sessions WHERE expires_at < NOW() - INTERVAL '7 days';
