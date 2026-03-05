-- =====================================================
-- FORCE DROP BY EXACT SIGNATURE
-- Drop both 13 and 14 parameter versions
-- =====================================================

-- Get exact OIDs and drop them
DO $$
DECLARE
    func_oid OID;
BEGIN
    -- Drop all versions by OID
    FOR func_oid IN 
        SELECT oid FROM pg_proc WHERE proname = 'record_imprisonment_metric'
    LOOP
        EXECUTE 'DROP FUNCTION ' || func_oid::regprocedure || ' CASCADE';
        RAISE NOTICE 'Dropped function: %', func_oid::regprocedure;
    END LOOP;
END $$;

-- Verify all are gone
SELECT 
  proname,
  pronargs,
  oid
FROM pg_proc 
WHERE proname = 'record_imprisonment_metric';
-- Should return 0 rows

-- =====================================================
-- CREATE ONLY 14-PARAMETER VERSION
-- =====================================================
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
  
  -- Insert metric
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
    'adjustment_reason', p_adjustment_reason
  );
  
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Error: %', SQLERRM;
    RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION public.record_imprisonment_metric TO anon, authenticated;

-- Verify ONLY ONE version exists
SELECT 
  proname,
  pronargs as parameters,
  pg_get_function_arguments(oid) as signature
FROM pg_proc 
WHERE proname = 'record_imprisonment_metric';
-- Should show exactly 1 row with 14 parameters

-- Test it works
SELECT public.record_imprisonment_metric(
  '00000000-0000-0000-0000-000000000000'::UUID,
  1, 1950, 'FinalTest', 'primary', false, false, null,
  1925, 'attack', 100, 'NORMAL', 'LEFT_EARLY', false
);

SELECT adjustment_reason, player_name 
FROM imprisonment_metrics 
WHERE player_name = 'FinalTest'
ORDER BY created_at DESC LIMIT 1;
