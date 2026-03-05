-- =====================================================
-- FIX LEFT_EARLY - Use adjustment_reason (no result_type column)
-- The table only has adjustment_reason, not result_type
-- =====================================================

-- Drop all existing versions
DROP FUNCTION IF EXISTS public.record_imprisonment_metric(UUID, INTEGER, INTEGER, TEXT, TEXT, BOOLEAN, BOOLEAN);
DROP FUNCTION IF EXISTS public.record_imprisonment_metric(UUID, INTEGER, INTEGER, TEXT, TEXT, BOOLEAN, BOOLEAN, TEXT);
DROP FUNCTION IF EXISTS public.record_imprisonment_metric(UUID, INTEGER, INTEGER, TEXT, TEXT, BOOLEAN, BOOLEAN, INTEGER, TEXT);
DROP FUNCTION IF EXISTS public.record_imprisonment_metric(UUID, INTEGER, INTEGER, TEXT, TEXT, BOOLEAN, BOOLEAN, INTEGER, TEXT, INTEGER, TEXT);
DROP FUNCTION IF EXISTS public.record_imprisonment_metric(UUID, INTEGER, INTEGER, TEXT, TEXT, BOOLEAN, BOOLEAN, TEXT, INTEGER, TEXT, INTEGER, TEXT);
DROP FUNCTION IF EXISTS public.record_imprisonment_metric(UUID, INTEGER, INTEGER, TEXT, TEXT, BOOLEAN, BOOLEAN, TEXT, INTEGER, TEXT, INTEGER, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.record_imprisonment_metric(UUID, INTEGER, INTEGER, TEXT, TEXT, BOOLEAN, BOOLEAN, TEXT, INTEGER, TEXT, INTEGER, TEXT, TEXT, BOOLEAN);

-- Create updated function with adjustment_reason and is_defense
CREATE OR REPLACE FUNCTION public.record_imprisonment_metric(
  p_user_id UUID,
  p_connection_number INTEGER,
  p_timestamp_ms INTEGER,
  p_player_name TEXT,
  p_code_used TEXT,
  p_is_clan_member BOOLEAN,
  p_is_success BOOLEAN DEFAULT TRUE,
  p_username TEXT DEFAULT NULL,
  p_timing_value INTEGER DEFAULT NULL,
  p_timing_type TEXT DEFAULT NULL,
  p_ping_ms INTEGER DEFAULT NULL,
  p_context TEXT DEFAULT NULL,
  p_adjustment_reason TEXT DEFAULT NULL,
  p_is_defense BOOLEAN DEFAULT FALSE
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
  
  -- ✅ Insert metric - adjustment_reason is stored directly (no result_type column)
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
  
  RETURN json_build_object('success', true, 'adjustment_reason', p_adjustment_reason);
  
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Error in record_imprisonment_metric: %', SQLERRM;
    RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION public.record_imprisonment_metric(UUID, INTEGER, INTEGER, TEXT, TEXT, BOOLEAN, BOOLEAN, TEXT, INTEGER, TEXT, INTEGER, TEXT, TEXT, BOOLEAN) TO anon, authenticated;

-- Verify the function
SELECT 
  proname as function_name,
  pg_get_function_arguments(oid) as arguments
FROM pg_proc 
WHERE proname = 'record_imprisonment_metric';

-- Test the function with LEFT_EARLY
SELECT public.record_imprisonment_metric(
  '00000000-0000-0000-0000-000000000000'::UUID,  -- test user_id
  1,                                               -- connection_number
  1950,                                            -- timestamp_ms
  'TestRival',                                     -- player_name
  'primary',                                       -- code_used
  false,                                           -- is_clan_member
  false,                                           -- is_success
  'testuser',                                      -- username
  1925,                                            -- timing_value
  'attack',                                        -- timing_type
  100,                                             -- ping_ms
  'NORMAL',                                        -- context
  'LEFT_EARLY',                                    -- adjustment_reason
  false                                            -- is_defense
);

-- Check if LEFT_EARLY was recorded correctly
SELECT adjustment_reason, player_name, timestamp_ms, is_success
FROM imprisonment_metrics
WHERE player_name = 'TestRival'
ORDER BY created_at DESC
LIMIT 1;
