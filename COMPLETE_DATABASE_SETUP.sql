-- =====================================================
-- GALAXY KICK LOCK 2.0 - COMPLETE DATABASE SETUP
-- =====================================================
-- This file contains ALL database setup including:
-- - Tables, indexes, and constraints
-- - All functions (register, authenticate, validate, etc.)
-- - Security improvements
-- - Single-session enforcement
-- - Token deletion detection
-- =====================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Drop existing objects (in correct order)
DROP TABLE IF EXISTS public.user_sessions CASCADE;
DROP TABLE IF EXISTS public.users CASCADE;
DROP TABLE IF EXISTS public.tokens CASCADE;
DROP TABLE IF EXISTS public.admins CASCADE;

DROP FUNCTION IF EXISTS public.register_user(TEXT, TEXT, TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.authenticate_user(TEXT, TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.validate_session(TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.logout_user(TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.logout_all_sessions(UUID) CASCADE;
DROP FUNCTION IF EXISTS public.register_admin(TEXT, TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.authenticate_admin(TEXT, TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.generate_token(INTEGER) CASCADE;
DROP FUNCTION IF EXISTS public.get_all_users() CASCADE;
DROP FUNCTION IF EXISTS public.get_tokens_by_duration(INTEGER) CASCADE;
DROP FUNCTION IF EXISTS public.renew_user_token(UUID, INTEGER) CASCADE;
DROP FUNCTION IF EXISTS public.delete_user(UUID) CASCADE;
DROP FUNCTION IF EXISTS public.delete_token(UUID) CASCADE;
DROP FUNCTION IF EXISTS public.update_updated_at_column() CASCADE;

-- =====================================================
-- TABLES
-- =====================================================

-- Tokens table for subscription management
CREATE TABLE public.tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_value TEXT UNIQUE NOT NULL,
  duration_months INTEGER NOT NULL CHECK (duration_months IN (3, 6, 12)),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expiry_date TIMESTAMPTZ NOT NULL,
  is_active BOOLEAN DEFAULT true,
  
  CONSTRAINT valid_duration CHECK (duration_months IN (3, 6, 12))
);

-- Admins table for admin authentication
CREATE TABLE public.admins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  last_login TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT true,
  
  CONSTRAINT admin_username_length CHECK (char_length(username) >= 3 AND char_length(username) <= 50),
  CONSTRAINT admin_username_format CHECK (username ~ '^[a-zA-Z0-9_-]+$')
);

-- Users table with security best practices
CREATE TABLE public.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  token_id UUID REFERENCES public.tokens(id) ON DELETE SET NULL,
  subscription_months INTEGER,
  token_expiry_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  last_login TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT true,
  
  CONSTRAINT username_length CHECK (char_length(username) >= 3 AND char_length(username) <= 200),
  CONSTRAINT username_format CHECK (username ~ '^([a-zA-Z0-9_-]+|DELETED_[a-zA-Z0-9_-]+_[0-9]+)$')
);

-- User sessions table for session management
CREATE TABLE public.user_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  session_token TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  last_activity TIMESTAMPTZ DEFAULT NOW(),
  is_active BOOLEAN DEFAULT true,
  user_agent TEXT,
  ip_address TEXT
);

-- =====================================================
-- INDEXES
-- =====================================================

CREATE INDEX idx_users_username ON public.users(username);
CREATE INDEX idx_users_token_id ON public.users(token_id);
CREATE INDEX idx_users_is_active ON public.users(is_active);
CREATE INDEX idx_tokens_token_value ON public.tokens(token_value);
CREATE INDEX idx_tokens_is_active ON public.tokens(is_active);
CREATE INDEX idx_admins_username ON public.admins(username);
CREATE INDEX idx_user_sessions_user_id ON public.user_sessions(user_id);
CREATE INDEX idx_user_sessions_token ON public.user_sessions(session_token);
CREATE INDEX idx_user_sessions_active ON public.user_sessions(is_active);
CREATE INDEX idx_user_sessions_created_at ON public.user_sessions(created_at);

-- =====================================================
-- TRIGGER FUNCTIONS
-- =====================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply triggers
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_admins_updated_at BEFORE UPDATE ON public.admins
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- USER FUNCTIONS
-- =====================================================

-- Register new user
CREATE OR REPLACE FUNCTION public.register_user(
  p_username TEXT,
  p_password TEXT,
  p_token_value TEXT
)
RETURNS JSON AS $$
DECLARE
  v_token RECORD;
  v_user_id UUID;
  v_password_hash TEXT;
BEGIN
  -- Validate token
  SELECT id, duration_months, expiry_date, is_active
  INTO v_token
  FROM public.tokens
  WHERE token_value = p_token_value;
  
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Invalid token');
  END IF;
  
  IF NOT v_token.is_active THEN
    RETURN json_build_object('success', false, 'error', 'Token is inactive');
  END IF;
  
  IF v_token.expiry_date < NOW() THEN
    RETURN json_build_object('success', false, 'error', 'Token has expired');
  END IF;
  
  -- Check if token already used
  IF EXISTS (SELECT 1 FROM public.users WHERE token_id = v_token.id) THEN
    RETURN json_build_object('success', false, 'error', 'Token already used');
  END IF;
  
  -- Hash password
  v_password_hash := crypt(p_password, gen_salt('bf', 10));
  
  -- Create user
  INSERT INTO public.users (username, password_hash, token_id, subscription_months, token_expiry_date)
  VALUES (p_username, v_password_hash, v_token.id, v_token.duration_months, v_token.expiry_date)
  RETURNING id INTO v_user_id;
  
  RETURN json_build_object(
    'success', true,
    'user_id', v_user_id,
    'username', p_username,
    'subscription_months', v_token.duration_months
  );
  
EXCEPTION
  WHEN unique_violation THEN
    RETURN json_build_object('success', false, 'error', 'Username already exists');
  WHEN OTHERS THEN
    RETURN json_build_object('success', false, 'error', 'Registration failed');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Authenticate user (login) with SINGLE SESSION ENFORCEMENT
CREATE OR REPLACE FUNCTION public.authenticate_user(
  p_username TEXT,
  p_password TEXT
)
RETURNS JSON AS $$
DECLARE
  v_user RECORD;
  v_token RECORD;
  v_session_token TEXT;
  v_session_id UUID;
  v_expires_at TIMESTAMPTZ;
BEGIN
  SELECT id, username, password_hash, token_id, subscription_months, token_expiry_date, is_active
  INTO v_user
  FROM public.users
  WHERE username = p_username;
  
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Invalid username or password');
  END IF;
  
  IF NOT v_user.is_active THEN
    RETURN json_build_object('success', false, 'error', 'Account is disabled');
  END IF;
  
  IF v_user.password_hash != crypt(p_password, v_user.password_hash) THEN
    RETURN json_build_object('success', false, 'error', 'Invalid username or password');
  END IF;
  
  -- Check if user has a token assigned
  IF v_user.token_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Your access token was removed by admin. Please contact admin to get a new token.');
  END IF;
  
  -- Verify the token still exists and is active
  SELECT id, expiry_date, is_active
  INTO v_token
  FROM public.tokens
  WHERE id = v_user.token_id;
  
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Your access token was removed by admin. Please contact admin to get a new token.');
  END IF;
  
  IF NOT v_token.is_active THEN
    RETURN json_build_object('success', false, 'error', 'Your access token has been deactivated by admin. Please contact admin.');
  END IF;
  
  -- SINGLE SESSION ENFORCEMENT: Invalidate all previous sessions for this user
  UPDATE public.user_sessions
  SET is_active = false
  WHERE user_id = v_user.id AND is_active = true;
  
  -- Generate session token
  v_session_token := encode(
    digest(v_user.id::text || extract(epoch from now())::text || gen_random_bytes(16)::text, 'sha256'),
    'hex'
  );
  
  -- Session expires in 24 hours
  v_expires_at := NOW() + INTERVAL '24 hours';
  
  -- Create session record
  INSERT INTO public.user_sessions (user_id, session_token, expires_at)
  VALUES (v_user.id, v_session_token, v_expires_at)
  RETURNING id INTO v_session_id;
  
  -- Update last login
  UPDATE public.users
  SET last_login = NOW()
  WHERE id = v_user.id;
  
  RETURN json_build_object(
    'success', true,
    'user_id', v_user.id,
    'username', v_user.username,
    'subscription_months', v_user.subscription_months,
    'token_expiry_date', v_user.token_expiry_date,
    'session_token', v_session_token,
    'session_id', v_session_id,
    'expires_at', v_expires_at
  );
  
EXCEPTION
  WHEN OTHERS THEN
    RETURN json_build_object('success', false, 'error', 'Authentication failed');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Validate session with SINGLE SESSION + TOKEN DELETION detection
CREATE OR REPLACE FUNCTION public.validate_session(
  p_session_token TEXT
)
RETURNS JSON AS $$
DECLARE
  v_session RECORD;
  v_user RECORD;
  v_token RECORD;
  v_latest_session_id UUID;
BEGIN
  -- Get session
  SELECT s.id, s.user_id, s.expires_at, s.is_active, s.created_at
  INTO v_session
  FROM public.user_sessions s
  WHERE s.session_token = p_session_token;
  
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'valid', false, 'reason', 'Session not found');
  END IF;
  
  IF NOT v_session.is_active THEN
    RETURN json_build_object('success', false, 'valid', false, 'reason', 'Session inactive');
  END IF;
  
  IF v_session.expires_at < NOW() THEN
    UPDATE public.user_sessions SET is_active = false WHERE id = v_session.id;
    RETURN json_build_object('success', false, 'valid', false, 'reason', 'Session expired');
  END IF;
  
  -- SINGLE SESSION ENFORCEMENT: Check if this is the latest session
  SELECT id INTO v_latest_session_id
  FROM public.user_sessions
  WHERE user_id = v_session.user_id
    AND is_active = true
  ORDER BY created_at DESC
  LIMIT 1;
  
  IF v_latest_session_id IS NOT NULL AND v_latest_session_id != v_session.id THEN
    -- This is not the latest session - user logged in elsewhere
    UPDATE public.user_sessions SET is_active = false WHERE id = v_session.id;
    RETURN json_build_object(
      'success', false,
      'valid', false,
      'new_session', true,
      'reason', 'You have been logged in on another device'
    );
  END IF;
  
  -- Get user
  SELECT id, token_id, token_expiry_date, is_active
  INTO v_user
  FROM public.users
  WHERE id = v_session.user_id;
  
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'valid', false, 'user_deleted', true, 'reason', 'Your account has been removed by admin');
  END IF;
  
  IF NOT v_user.is_active THEN
    RETURN json_build_object('success', false, 'valid', false, 'reason', 'Account is inactive');
  END IF;
  
  -- TOKEN DELETION DETECTION: Check if user's token still exists
  IF v_user.token_id IS NOT NULL THEN
    SELECT id, expiry_date, is_active
    INTO v_token
    FROM public.tokens
    WHERE id = v_user.token_id;
    
    IF NOT FOUND THEN
      -- Token was deleted by admin
      UPDATE public.user_sessions SET is_active = false WHERE id = v_session.id;
      RETURN json_build_object(
        'success', false,
        'valid', false,
        'token_deleted', true,
        'reason', 'Your access token has been revoked by admin'
      );
    END IF;
    
    IF NOT v_token.is_active THEN
      UPDATE public.user_sessions SET is_active = false WHERE id = v_session.id;
      RETURN json_build_object(
        'success', false,
        'valid', false,
        'token_invalid', true,
        'reason', 'Your access token has been deactivated by admin'
      );
    END IF;
  END IF;
  
  -- Update last activity
  UPDATE public.user_sessions 
  SET last_activity = NOW() 
  WHERE id = v_session.id;
  
  -- Session is valid
  RETURN json_build_object(
    'success', true,
    'valid', true,
    'user_id', v_session.user_id
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Logout user (invalidate current session)
CREATE OR REPLACE FUNCTION public.logout_user(
  p_session_token TEXT
)
RETURNS JSON AS $$
BEGIN
  UPDATE public.user_sessions
  SET is_active = false
  WHERE session_token = p_session_token;
  
  RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Logout all sessions for a user
CREATE OR REPLACE FUNCTION public.logout_all_sessions(
  p_user_id UUID
)
RETURNS JSON AS $$
BEGIN
  UPDATE public.user_sessions
  SET is_active = false
  WHERE user_id = p_user_id AND is_active = true;
  
  RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- ADMIN FUNCTIONS
-- =====================================================

-- Register admin
CREATE OR REPLACE FUNCTION public.register_admin(
  p_username TEXT,
  p_password TEXT
)
RETURNS JSON AS $$
DECLARE
  v_admin_id UUID;
  v_password_hash TEXT;
BEGIN
  v_password_hash := crypt(p_password, gen_salt('bf', 10));
  
  INSERT INTO public.admins (username, password_hash)
  VALUES (p_username, v_password_hash)
  RETURNING id INTO v_admin_id;
  
  RETURN json_build_object(
    'success', true,
    'admin_id', v_admin_id,
    'username', p_username
  );
  
EXCEPTION
  WHEN unique_violation THEN
    RETURN json_build_object('success', false, 'error', 'Admin username already exists');
  WHEN OTHERS THEN
    RETURN json_build_object('success', false, 'error', 'Admin registration failed');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Authenticate admin
CREATE OR REPLACE FUNCTION public.authenticate_admin(
  p_username TEXT,
  p_password TEXT
)
RETURNS JSON AS $$
DECLARE
  v_admin RECORD;
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
  
  UPDATE public.admins
  SET last_login = NOW()
  WHERE id = v_admin.id;
  
  RETURN json_build_object(
    'success', true,
    'admin_id', v_admin.id,
    'username', v_admin.username
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Generate token
CREATE OR REPLACE FUNCTION public.generate_token(
  p_duration_months INTEGER
)
RETURNS JSON AS $$
DECLARE
  v_token_value TEXT;
  v_token_id UUID;
  v_expiry_date TIMESTAMPTZ;
BEGIN
  IF p_duration_months NOT IN (3, 6, 12) THEN
    RETURN json_build_object('success', false, 'error', 'Invalid duration');
  END IF;
  
  v_token_value := encode(gen_random_bytes(16), 'hex');
  v_expiry_date := NOW() + (p_duration_months || ' months')::INTERVAL;
  
  INSERT INTO public.tokens (token_value, duration_months, expiry_date)
  VALUES (v_token_value, p_duration_months, v_expiry_date)
  RETURNING id INTO v_token_id;
  
  RETURN json_build_object(
    'success', true,
    'token_id', v_token_id,
    'token_value', v_token_value,
    'duration_months', p_duration_months,
    'expiry_date', v_expiry_date
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Get all users
CREATE OR REPLACE FUNCTION public.get_all_users()
RETURNS JSON AS $$
DECLARE
  v_users JSON;
BEGIN
  SELECT json_agg(user_data)
  INTO v_users
  FROM (
    SELECT json_build_object(
      'id', u.id,
      'username', u.username,
      'subscription_months', u.subscription_months,
      'token_expiry_date', u.token_expiry_date,
      'created_at', u.created_at,
      'last_login', u.last_login,
      'is_active', u.is_active,
      'token_id', u.token_id,
      'token_value', t.token_value
    ) as user_data
    FROM public.users u
    LEFT JOIN public.tokens t ON u.token_id = t.id
    ORDER BY u.created_at DESC
  ) subquery;
  
  RETURN json_build_object('success', true, 'users', COALESCE(v_users, '[]'::json));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Get tokens by duration
CREATE OR REPLACE FUNCTION public.get_tokens_by_duration(
  p_duration_months INTEGER
)
RETURNS JSON AS $$
DECLARE
  v_tokens JSON;
BEGIN
  SELECT json_agg(token_data)
  INTO v_tokens
  FROM (
    SELECT json_build_object(
      'id', t.id,
      'token_value', t.token_value,
      'duration_months', t.duration_months,
      'created_at', t.created_at,
      'expiry_date', t.expiry_date,
      'is_active', t.is_active,
      'is_used', EXISTS(SELECT 1 FROM public.users WHERE token_id = t.id),
      'used_by', (SELECT username FROM public.users WHERE token_id = t.id LIMIT 1)
    ) as token_data
    FROM public.tokens t
    WHERE (p_duration_months IS NULL OR t.duration_months = p_duration_months)
    ORDER BY t.created_at DESC
  ) subquery;
  
  RETURN json_build_object('success', true, 'tokens', COALESCE(v_tokens, '[]'::json));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Renew user token
CREATE OR REPLACE FUNCTION public.renew_user_token(
  p_user_id UUID,
  p_duration_months INTEGER
)
RETURNS JSON AS $$
DECLARE
  v_new_expiry TIMESTAMPTZ;
  v_token_value TEXT;
  v_token_id UUID;
BEGIN
  -- Generate new token
  v_token_value := encode(gen_random_bytes(16), 'hex');
  v_new_expiry := NOW() + (p_duration_months || ' months')::INTERVAL;
  
  -- Create new token
  INSERT INTO public.tokens (token_value, duration_months, expiry_date)
  VALUES (v_token_value, p_duration_months, v_new_expiry)
  RETURNING id INTO v_token_id;
  
  -- Update user with new token
  UPDATE public.users
  SET token_id = v_token_id,
      subscription_months = p_duration_months,
      token_expiry_date = v_new_expiry
  WHERE id = p_user_id;
  
  RETURN json_build_object(
    'success', true,
    'token_value', v_token_value,
    'expiry_date', v_new_expiry
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Delete user
CREATE OR REPLACE FUNCTION public.delete_user(
  p_user_id UUID
)
RETURNS JSON AS $$
DECLARE
  v_token_id UUID;
  v_sessions_invalidated INTEGER;
  v_token_deleted BOOLEAN := false;
BEGIN
  -- Get user's token_id before deleting user
  SELECT token_id INTO v_token_id
  FROM public.users
  WHERE id = p_user_id;
  
  -- Invalidate all sessions for this user
  UPDATE public.user_sessions
  SET is_active = false
  WHERE user_id = p_user_id AND is_active = true;
  
  GET DIAGNOSTICS v_sessions_invalidated = ROW_COUNT;
  
  -- Delete the user (this will set token_id to NULL due to ON DELETE SET NULL)
  DELETE FROM public.users WHERE id = p_user_id;
  
  -- Delete the token if it existed
  IF v_token_id IS NOT NULL THEN
    DELETE FROM public.tokens WHERE id = v_token_id;
    v_token_deleted := true;
  END IF;
  
  RETURN json_build_object(
    'success', true,
    'sessions_invalidated', v_sessions_invalidated,
    'token_deleted', v_token_deleted
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN json_build_object('success', false, 'error', 'Failed to delete user');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Delete token
CREATE OR REPLACE FUNCTION public.delete_token(
  p_token_id UUID
)
RETURNS JSON AS $$
DECLARE
  v_sessions_invalidated INTEGER;
  v_user_ids UUID[];
BEGIN
  -- Get all user IDs that have this token
  SELECT ARRAY_AGG(id) INTO v_user_ids
  FROM public.users
  WHERE token_id = p_token_id;
  
  -- Invalidate all sessions for users with this token
  IF v_user_ids IS NOT NULL THEN
    UPDATE public.user_sessions
    SET is_active = false
    WHERE user_id = ANY(v_user_ids) AND is_active = true;
    
    GET DIAGNOSTICS v_sessions_invalidated = ROW_COUNT;
    
    -- Remove token reference from users (prevent login)
    UPDATE public.users
    SET token_id = NULL,
        subscription_months = NULL,
        token_expiry_date = NULL
    WHERE token_id = p_token_id;
  ELSE
    v_sessions_invalidated := 0;
  END IF;
  
  -- Delete the token
  DELETE FROM public.tokens WHERE id = p_token_id;
  
  RETURN json_build_object(
    'success', true,
    'sessions_invalidated', v_sessions_invalidated
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN json_build_object('success', false, 'error', 'Failed to delete token');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- PERMISSIONS
-- =====================================================

GRANT EXECUTE ON FUNCTION public.register_user(TEXT, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.authenticate_user(TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.validate_session(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.logout_user(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.logout_all_sessions(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_admin(TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.authenticate_admin(TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_token(INTEGER) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_all_users() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_tokens_by_duration(INTEGER) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.renew_user_token(UUID, INTEGER) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_user(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_token(UUID) TO anon, authenticated;

-- =====================================================
-- COMPLETE - ALL FEATURES INCLUDED
-- =====================================================
-- ✅ User registration and authentication
-- ✅ Admin registration and authentication
-- ✅ Token generation and management
-- ✅ Session management with expiry
-- ✅ SINGLE SESSION ENFORCEMENT (latest login wins)
-- ✅ TOKEN DELETION DETECTION (admin revocation)
-- ✅ User and token management functions
-- ✅ Security best practices (password hashing, constraints)
-- ✅ Indexes for performance
-- ✅ Proper foreign keys and cascades
-- =====================================================
