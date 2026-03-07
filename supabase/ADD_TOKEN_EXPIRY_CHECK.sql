-- Fix: Add token expiry check to authenticate_user
-- Currently it checks token exists + is_active but NOT expiry date
-- Run this in Supabase SQL Editor

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

  -- CHECK TOKEN EXPIRY
  IF v_token.expiry_date < NOW() THEN
    RETURN json_build_object('success', false, 'error', 'Your subscription has expired. Please contact admin to renew.');
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

  -- Create new session
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
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
