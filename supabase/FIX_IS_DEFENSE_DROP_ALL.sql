-- =====================================================
-- FIX IS_DEFENSE - DROP ALL VERSIONS FIRST
-- This handles the duplicate function issue
-- =====================================================

-- Drop ALL possible versions of the function
-- Version 1: With bigint timestamp (11 params)
DROP FUNCTION IF EXISTS public.record_imprisonment_metric(UUID, INTEGER, BIGINT, TEXT, TEXT, BOOLEAN, BOOLEAN, INTEGER, TEXT, INTEGER, TEXT);

-- Version 2: With integer timestamp (11 params)
DROP FUNCTION IF EXISTS public.record_imprisonment_metric(UUID, INTEGER, INTEGER, TEXT, TEXT, BOOLEAN, BOOLEAN, INTEGER, TEXT, INTEGER, TEXT);

-- Version 3: With bigint timestamp + adjustment_reason (12 params)
DROP FUNCTION IF EXISTS public.record_imprisonment_metric(UUID, INTEGER, BIGINT, TEXT, TEXT, BOOLEAN, BOOLEAN, INTEGER, TEXT, INTEGER, TEXT, TEXT);

-- Version 4: With integer timestamp + adjustment_reason (12 params)
DROP FUNCTION IF EXISTS public.record_imprisonment_metric(UUID, INTEGER, INTEGER, TEXT, TEXT, BOOLEAN, BOOLEAN, INTEGER, TEXT, INTEGER, TEXT, TEXT);

-- Version 5: With bigint timestamp + adjustment_reason + is_defense (13 params)
DROP FUNCTION IF EXISTS public.record_imprisonment_metric(UUID, INTEGER, BIGINT, TEXT, TEXT, BOOLEAN, BOOLEAN, INTEGER, TEXT, INTEGER, TEXT, TEXT, BOOLEAN);

-- Version 6: With integer timestamp + adjustment_reason + is_defense (13 params)
DROP FUNCTION IF EXISTS public.record_imprisonment_metric(UUID, INTEGER, INTEGER, TEXT, TEXT, BOOLEAN, BOOLEAN, INTEGER, TEXT, INTEGER, TEXT, TEXT, BOOLEAN);

-- Verify all versions are dropped
SELECT 
  proname as function_name,
  pg_get_function_arguments(oid) as arguments
FROM pg_proc 
WHERE proname = 'record_imprisonment_metric';

-- Expected: No rows (all versions dropped)

-- =====================================================
-- CREATE NEW FUNCTION WITH IS_DEFENSE
-- Using INTEGER for timestamp (matches your backend code)
-- =====================================================

CREATE OR REPLACE FUNCTION public.record_imprisonment_metric(
  p_user_id UUID,
  p_connection_number INTEGER,
  p_timestamp_ms INTEGER,
  p_player_name TEXT,
  p_code_used TEXT,
  p_is_clan_member BOOLEAN,
  p_is_success BOOLEAN DEFAULT TRUE,
  p_timing_value INTEGER DEFAULT NULL::INTEGER,
  p_timing_type TEXT DEFAULT NULL::TEXT,
  p_ping_ms INTEGER DEFAULT NULL::INTEGER,
  p_context TEXT DEFAULT NULL::TEXT,
  p_adjustment_reason TEXT DEFAULT NULL::TEXT,
  p_is_defense BOOLEAN DEFAULT FALSE  -- NEW: Default FALSE (backward compatible)
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Validation
  IF p_connection_number < 1 OR p_connection_number > 5 THEN
    RETURN json_build_object('success', false, 'error', 'Invalid connection number');
  END IF;
  
  IF p_code_used NOT IN ('primary', 'alt') THEN
    RETURN json_build_object('success', false, 'error', 'Invalid code type');
  END IF;
  
  IF p_timing_type IS NOT NULL AND p_timing_type NOT IN ('attack', 'defense') THEN
    RETURN json_build_object('success', false, 'error', 'Invalid timing type');
  END IF;
  
  IF p_context IS NOT NULL AND p_context NOT IN ('FAST', 'NORMAL', 'SLOW') THEN
    RETURN json_build_object('success', false, 'error', 'Invalid context');
  END IF;
  
  -- Insert metric (all fields including is_defense)
  INSERT INTO public.imprisonment_metrics (
    user_id, 
    connection_number, 
    timestamp_ms, 
    player_name, 
    code_used, 
    is_clan_member,
    is_success,
    timing_value,
    timing_type,
    ping_ms,
    context,
    adjustment_reason,
    is_defense  -- NEW: Capture defense flag
  )
  VALUES (
    p_user_id, 
    p_connection_number, 
    p_timestamp_ms, 
    p_player_name, 
    p_code_used, 
    p_is_clan_member,
    p_is_success,
    p_timing_value,
    p_timing_type,
    p_ping_ms,
    p_context,
    p_adjustment_reason,
    p_is_defense  -- NEW: Store defense flag
  );
  
  RETURN json_build_object('success', true);
  
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Error in record_imprisonment_metric: %', SQLERRM;
    RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION public.record_imprisonment_metric(UUID, INTEGER, INTEGER, TEXT, TEXT, BOOLEAN, BOOLEAN, INTEGER, TEXT, INTEGER, TEXT, TEXT, BOOLEAN) TO anon, authenticated;

-- Verify the function was created correctly
SELECT 
  proname as function_name,
  pg_get_function_arguments(oid) as arguments
FROM pg_proc 
WHERE proname = 'record_imprisonment_metric';

-- Expected output:
-- function_name: record_imprisonment_metric
-- arguments: p_user_id uuid, p_connection_number integer, p_timestamp_ms integer, 
--            p_player_name text, p_code_used text, p_is_clan_member boolean, 
--            p_is_success boolean DEFAULT true, p_timing_value integer DEFAULT NULL::integer, 
--            p_timing_type text DEFAULT NULL::text, p_ping_ms integer DEFAULT NULL::integer, 
--            p_context text DEFAULT NULL::text, p_adjustment_reason text DEFAULT NULL::text,
--            p_is_defense boolean DEFAULT false

-- =====================================================
-- VERIFICATION
-- =====================================================

-- Check that only ONE version exists now
SELECT COUNT(*) as function_count
FROM pg_proc 
WHERE proname = 'record_imprisonment_metric';

-- Expected: 1 (only one version)

-- Test the function works
SELECT public.record_imprisonment_metric(
  'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'::UUID,  -- dummy user_id
  1,                                               -- connection_number
  1000,                                            -- timestamp_ms
  'TestPlayer',                                    -- player_name
  'primary',                                       -- code_used
  false,                                           -- is_clan_member
  true,                                            -- is_success
  1975,                                            -- timing_value
  'attack',                                        -- timing_type
  85,                                              -- ping_ms
  'NORMAL',                                        -- context
  'SUCCESS',                                       -- adjustment_reason
  false                                            -- is_defense
);

-- Expected: {"success": true}

-- =====================================================
-- SUCCESS!
-- Function created with is_defense parameter
-- =====================================================
