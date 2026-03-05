-- =====================================================
-- FINAL COMPLETE record_imprisonment_metric FUNCTION
-- =====================================================
-- This includes ALL parameters:
-- - username (for cleanup)
-- - timing_value and timing_type (for ML)
-- - ping_ms and context (for ML)
-- =====================================================

-- Drop all existing versions
DROP FUNCTION IF EXISTS public.record_imprisonment_metric(UUID, INTEGER, INTEGER, TEXT, TEXT, BOOLEAN, BOOLEAN);
DROP FUNCTION IF EXISTS public.record_imprisonment_metric(UUID, INTEGER, INTEGER, TEXT, TEXT, BOOLEAN, BOOLEAN, TEXT);
DROP FUNCTION IF EXISTS public.record_imprisonment_metric(UUID, INTEGER, INTEGER, TEXT, TEXT, BOOLEAN, BOOLEAN, INTEGER, TEXT);
DROP FUNCTION IF EXISTS public.record_imprisonment_metric(UUID, INTEGER, INTEGER, TEXT, TEXT, BOOLEAN, BOOLEAN, INTEGER, TEXT, INTEGER, TEXT);
DROP FUNCTION IF EXISTS public.record_imprisonment_metric(UUID, INTEGER, INTEGER, TEXT, TEXT, BOOLEAN, BOOLEAN, TEXT, INTEGER, TEXT, INTEGER, TEXT);

-- Create final complete function
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
  p_context TEXT DEFAULT NULL
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
  
  -- Insert metric with ALL fields
  INSERT INTO public.imprisonment_metrics (
    user_id, 
    connection_number, 
    timestamp_ms, 
    player_name, 
    code_used, 
    is_clan_member,
    is_success,
    username,
    timing_value,
    timing_type,
    ping_ms,
    context
  )
  VALUES (
    p_user_id, 
    p_connection_number, 
    p_timestamp_ms, 
    p_player_name, 
    p_code_used, 
    p_is_clan_member,
    p_is_success,
    p_username,
    p_timing_value,
    p_timing_type,
    p_ping_ms,
    p_context
  );
  
  RETURN json_build_object('success', true);
  
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Error in record_imprisonment_metric: %', SQLERRM;
    RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- Grant permissions for new function signature
GRANT EXECUTE ON FUNCTION public.record_imprisonment_metric(UUID, INTEGER, INTEGER, TEXT, TEXT, BOOLEAN, BOOLEAN, TEXT, INTEGER, TEXT, INTEGER, TEXT) TO anon, authenticated;

-- Verify the function was created
SELECT 
  proname as function_name,
  pg_get_function_arguments(oid) as arguments
FROM pg_proc 
WHERE proname = 'record_imprisonment_metric';
