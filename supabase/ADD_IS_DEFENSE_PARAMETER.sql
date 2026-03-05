-- =====================================================
-- ADD IS_DEFENSE PARAMETER TO RECORD FUNCTION
-- Backward compatible - adds p_is_defense with DEFAULT FALSE
-- =====================================================

-- Drop existing function (11 params without is_defense)
DROP FUNCTION IF EXISTS public.record_imprisonment_metric(UUID, INTEGER, INTEGER, TEXT, TEXT, BOOLEAN, BOOLEAN, INTEGER, TEXT, INTEGER, TEXT);

-- Create function with is_defense parameter (12 params total)
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

-- Verify the function was created
SELECT 
  proname as function_name,
  pg_get_function_arguments(oid) as arguments
FROM pg_proc 
WHERE proname = 'record_imprisonment_metric';

-- =====================================================
-- VERIFICATION QUERY
-- Check that defense metrics can be captured
-- =====================================================

-- After running this SQL, test by:
-- 1. Getting kicked by opponent
-- 2. Run this query to verify defense metric was captured:
--
-- SELECT 
--   player_name,
--   timing_value,
--   is_defense,
--   adjustment_reason,
--   context,
--   created_at
-- FROM imprisonment_metrics
-- WHERE is_defense = TRUE
-- ORDER BY created_at DESC
-- LIMIT 10;
