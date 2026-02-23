-- =====================================================
-- IMPRISONMENT METRICS - WITH 3S ERROR TRACKING
-- =====================================================
-- Tracks both SUCCESS and 3-SECOND ERROR metrics
-- =====================================================

-- Drop existing functions if they exist
DROP FUNCTION IF EXISTS public.record_imprisonment_metric(UUID, INTEGER, INTEGER, TEXT, TEXT, BOOLEAN);
DROP FUNCTION IF EXISTS public.record_imprisonment_metric(UUID, INTEGER, INTEGER, TEXT, TEXT, BOOLEAN, BOOLEAN);
DROP FUNCTION IF EXISTS public.get_imprisonment_metrics(UUID, INTEGER);

-- Add is_success column to existing table (if not exists)
ALTER TABLE public.imprisonment_metrics 
ADD COLUMN IF NOT EXISTS is_success BOOLEAN NOT NULL DEFAULT TRUE;

-- Create index on is_success for filtering
CREATE INDEX IF NOT EXISTS idx_imprisonment_is_success ON public.imprisonment_metrics(is_success);

-- Record imprisonment metric function (with is_success parameter)
CREATE OR REPLACE FUNCTION public.record_imprisonment_metric(
  p_user_id UUID,
  p_connection_number INTEGER,
  p_timestamp_ms INTEGER,
  p_player_name TEXT,
  p_code_used TEXT,
  p_is_clan_member BOOLEAN,
  p_is_success BOOLEAN DEFAULT TRUE
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
  
  -- Insert metric
  INSERT INTO public.imprisonment_metrics (
    user_id, 
    connection_number, 
    timestamp_ms, 
    player_name, 
    code_used, 
    is_clan_member,
    is_success
  )
  VALUES (
    p_user_id, 
    p_connection_number, 
    p_timestamp_ms, 
    p_player_name, 
    p_code_used, 
    p_is_clan_member,
    p_is_success
  );
  
  RETURN json_build_object('success', true);
  
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Error in record_imprisonment_metric: %', SQLERRM;
    RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- Get imprisonment metrics function (includes is_success)
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
  
  -- Get metrics
  SELECT json_agg(metric_data)
  INTO v_metrics
  FROM (
    SELECT json_build_object(
      'timestamp', timestamp_ms,
      'playerName', player_name,
      'code', code_used,
      'isClan', is_clan_member,
      'isSuccess', is_success
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
GRANT EXECUTE ON FUNCTION public.record_imprisonment_metric(UUID, INTEGER, INTEGER, TEXT, TEXT, BOOLEAN, BOOLEAN) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_imprisonment_metrics(UUID, INTEGER) TO anon, authenticated;

-- =====================================================
-- TEST THE FUNCTIONS
-- =====================================================

-- Test 1: Record a SUCCESS metric
SELECT public.record_imprisonment_metric(
  '9c8db54f-b77f-464d-882c-b770534b756e'::uuid,
  1,
  1500,
  'SuccessPlayer',
  'primary',
  false,
  true  -- SUCCESS
);

-- Test 2: Record a 3S ERROR metric
SELECT public.record_imprisonment_metric(
  '9c8db54f-b77f-464d-882c-b770534b756e'::uuid,
  1,
  2100,
  'SlowPlayer',
  'primary',
  false,
  false  -- 3S ERROR
);

-- Test 3: Get metrics (should return both)
SELECT public.get_imprisonment_metrics(
  '9c8db54f-b77f-464d-882c-b770534b756e'::uuid,
  1
);

-- Expected: 
-- {
--   "success": true, 
--   "data": [
--     {"timestamp": 1500, "playerName": "SuccessPlayer", "code": "primary", "isClan": false, "isSuccess": true},
--     {"timestamp": 2100, "playerName": "SlowPlayer", "code": "primary", "isClan": false, "isSuccess": false}
--   ]
-- }

-- =====================================================
-- COMPLETE!
-- =====================================================
