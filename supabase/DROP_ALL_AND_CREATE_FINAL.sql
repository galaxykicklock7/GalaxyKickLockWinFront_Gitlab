-- =====================================================
-- DROP ALL VERSIONS AND CREATE FINAL CORRECT VERSION
-- This will remove all duplicate functions
-- =====================================================

-- Drop ALL possible versions (comprehensive list)
DROP FUNCTION IF EXISTS public.record_imprisonment_metric(UUID, INTEGER, INTEGER, TEXT, TEXT, BOOLEAN, BOOLEAN) CASCADE;
DROP FUNCTION IF EXISTS public.record_imprisonment_metric(UUID, INTEGER, INTEGER, TEXT, TEXT, BOOLEAN, BOOLEAN, TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.record_imprisonment_metric(UUID, INTEGER, INTEGER, TEXT, TEXT, BOOLEAN, BOOLEAN, INTEGER, TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.record_imprisonment_metric(UUID, INTEGER, INTEGER, TEXT, TEXT, BOOLEAN, BOOLEAN, INTEGER, TEXT, INTEGER, TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.record_imprisonment_metric(UUID, INTEGER, INTEGER, TEXT, TEXT, BOOLEAN, BOOLEAN, TEXT, INTEGER, TEXT, INTEGER, TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.record_imprisonment_metric(UUID, INTEGER, INTEGER, TEXT, TEXT, BOOLEAN, BOOLEAN, TEXT, INTEGER, TEXT, INTEGER, TEXT, TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.record_imprisonment_metric(UUID, INTEGER, INTEGER, TEXT, TEXT, BOOLEAN, BOOLEAN, TEXT, INTEGER, TEXT, INTEGER, TEXT, TEXT, BOOLEAN) CASCADE;

-- Verify all versions are dropped
SELECT 
  proname as function_name,
  pronargs as num_arguments
FROM pg_proc 
WHERE proname = 'record_imprisonment_metric';
-- Should return 0 rows

-- =====================================================
-- CREATE FINAL CORRECT VERSION (14 parameters)
-- =====================================================
CREATE OR REPLACE FUNCTION public.record_imprisonment_metric(
  p_user_id UUID,                    -- 1
  p_connection_number INTEGER,       -- 2
  p_timestamp_ms INTEGER,            -- 3
  p_player_name TEXT,                -- 4
  p_code_used TEXT,                  -- 5
  p_is_clan_member BOOLEAN,          -- 6
  p_is_success BOOLEAN DEFAULT TRUE, -- 7
  p_username TEXT DEFAULT NULL,      -- 8 (not used but kept for compatibility)
  p_timing_value INTEGER DEFAULT NULL,    -- 9
  p_timing_type TEXT DEFAULT NULL,        -- 10
  p_ping_ms INTEGER DEFAULT NULL,         -- 11
  p_context TEXT DEFAULT NULL,            -- 12
  p_adjustment_reason TEXT DEFAULT NULL,  -- 13 (LEFT_EARLY, SUCCESS, 3S_ERROR, KICKED)
  p_is_defense BOOLEAN DEFAULT FALSE      -- 14
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
  
  -- Insert metric (adjustment_reason is stored directly, no result_type column)
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
    is_defense
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
    p_is_defense
  );
  
  RETURN json_build_object(
    'success', true, 
    'adjustment_reason', p_adjustment_reason,
    'is_defense', p_is_defense
  );
  
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Error in record_imprisonment_metric: %', SQLERRM;
    RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION public.record_imprisonment_metric(UUID, INTEGER, INTEGER, TEXT, TEXT, BOOLEAN, BOOLEAN, TEXT, INTEGER, TEXT, INTEGER, TEXT, TEXT, BOOLEAN) TO anon, authenticated;

-- =====================================================
-- VERIFY ONLY ONE VERSION EXISTS
-- =====================================================
SELECT 
  proname as function_name,
  pronargs as num_arguments,
  pg_get_function_arguments(oid) as arguments
FROM pg_proc 
WHERE proname = 'record_imprisonment_metric';
-- Should return exactly 1 row with 14 arguments

-- =====================================================
-- TEST ALL RESULT TYPES
-- =====================================================

-- Test 1: LEFT_EARLY
SELECT public.record_imprisonment_metric(
  '00000000-0000-0000-0000-000000000000'::UUID,
  1, 1950, 'TestRival1', 'primary', false, false, null,
  1925, 'attack', 100, 'NORMAL', 'LEFT_EARLY', false
);

-- Test 2: SUCCESS
SELECT public.record_imprisonment_metric(
  '00000000-0000-0000-0000-000000000000'::UUID,
  1, 1910, 'TestRival2', 'primary', false, true, null,
  1925, 'attack', 100, 'NORMAL', 'SUCCESS', false
);

-- Test 3: 3S_ERROR
SELECT public.record_imprisonment_metric(
  '00000000-0000-0000-0000-000000000000'::UUID,
  1, 2050, 'TestRival3', 'primary', false, false, null,
  1925, 'attack', 100, 'NORMAL', '3S_ERROR', false
);

-- Test 4: KICKED
SELECT public.record_imprisonment_metric(
  '00000000-0000-0000-0000-000000000000'::UUID,
  1, 1880, 'TestRival4', 'primary', false, false, null,
  1925, 'defense', 100, 'NORMAL', 'KICKED', true
);

-- Verify all 4 test records
SELECT 
  player_name,
  adjustment_reason,
  is_defense,
  timestamp_ms,
  timing_value
FROM imprisonment_metrics
WHERE player_name LIKE 'TestRival%'
ORDER BY created_at DESC
LIMIT 4;

-- Expected results:
-- TestRival4 | KICKED     | true  | 1880 | 1925
-- TestRival3 | 3S_ERROR   | false | 2050 | 1925
-- TestRival2 | SUCCESS    | false | 1910 | 1925
-- TestRival1 | LEFT_EARLY | false | 1950 | 1925
