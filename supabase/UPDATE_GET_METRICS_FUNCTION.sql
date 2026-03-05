-- =====================================================
-- UPDATE get_imprisonment_metrics TO INCLUDE ML FIELDS
-- =====================================================
-- Adds timing_value, timing_type, ping_ms, context to the response
-- =====================================================

DROP FUNCTION IF EXISTS public.get_imprisonment_metrics(UUID, INTEGER);

CREATE OR REPLACE FUNCTION public.get_imprisonment_metrics(
  p_user_id UUID,
  p_connection_number INTEGER
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_metrics JSON;
  v_count INTEGER;
BEGIN
  -- Validation
  IF p_connection_number < 1 OR p_connection_number > 5 THEN
    RETURN json_build_object('success', false, 'error', 'Invalid connection number');
  END IF;
  
  -- Count total metrics for debugging
  SELECT COUNT(*) INTO v_count
  FROM public.imprisonment_metrics
  WHERE user_id = p_user_id 
    AND connection_number = p_connection_number;
  
  RAISE NOTICE 'Found % metrics for user % conn %', v_count, p_user_id, p_connection_number;
  
  -- Get metrics with ALL fields including ML data
  SELECT json_agg(metric_data)
  INTO v_metrics
  FROM (
    SELECT json_build_object(
      'timestamp', timestamp_ms,
      'playerName', player_name,
      'code', code_used,
      'isClan', is_clan_member,
      'isSuccess', is_success,
      'timingValue', timing_value,
      'timingType', timing_type,
      'pingMs', ping_ms,
      'context', context,
      'createdAt', created_at
    ) as metric_data
    FROM public.imprisonment_metrics
    WHERE user_id = p_user_id 
      AND connection_number = p_connection_number
    ORDER BY created_at DESC
    LIMIT 1000
  ) subquery;
  
  RETURN json_build_object(
    'success', true, 
    'data', COALESCE(v_metrics, '[]'::json)
  );
  
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Error in get_imprisonment_metrics: %', SQLERRM;
    RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION public.get_imprisonment_metrics(UUID, INTEGER) TO anon, authenticated;

-- Verify the function was created
SELECT 
  proname as function_name,
  pg_get_function_arguments(oid) as arguments
FROM pg_proc 
WHERE proname = 'get_imprisonment_metrics';
