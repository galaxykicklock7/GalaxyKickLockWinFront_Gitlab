-- =====================================================
-- IMPRISONMENT METRICS - FIXED VERSION
-- =====================================================
-- This version has proper error handling and logging
-- =====================================================

-- Drop existing functions if they exist
DROP FUNCTION IF EXISTS public.record_imprisonment_metric(UUID, INTEGER, INTEGER, TEXT, TEXT, BOOLEAN);
DROP FUNCTION IF EXISTS public.get_imprisonment_metrics(UUID, INTEGER);

-- Create imprisonment metrics table (if not exists)
CREATE TABLE IF NOT EXISTS public.imprisonment_metrics (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL,
  connection_number INTEGER NOT NULL CHECK (connection_number BETWEEN 1 AND 5),
  timestamp_ms INTEGER NOT NULL,
  player_name VARCHAR(255) NOT NULL,
  code_used VARCHAR(10) NOT NULL CHECK (code_used IN ('primary', 'alt')),
  is_clan_member BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_imprisonment_user_conn ON public.imprisonment_metrics(user_id, connection_number);
CREATE INDEX IF NOT EXISTS idx_imprisonment_created_at ON public.imprisonment_metrics(created_at);

-- Record imprisonment metric function
CREATE OR REPLACE FUNCTION public.record_imprisonment_metric(
  p_user_id UUID,
  p_connection_number INTEGER,
  p_timestamp_ms INTEGER,
  p_player_name TEXT,
  p_code_used TEXT,
  p_is_clan_member BOOLEAN
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
    is_clan_member
  )
  VALUES (
    p_user_id, 
    p_connection_number, 
    p_timestamp_ms, 
    p_player_name, 
    p_code_used, 
    p_is_clan_member
  );
  
  RETURN json_build_object('success', true);
  
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Error in record_imprisonment_metric: %', SQLERRM;
    RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- Get imprisonment metrics function
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
      'isClan', is_clan_member
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
GRANT EXECUTE ON FUNCTION public.record_imprisonment_metric(UUID, INTEGER, INTEGER, TEXT, TEXT, BOOLEAN) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_imprisonment_metrics(UUID, INTEGER) TO anon, authenticated;

-- =====================================================
-- TEST THE FUNCTIONS
-- =====================================================

-- Test 1: Get metrics (should return empty array)
SELECT public.get_imprisonment_metrics(
  '9c8db54f-b77f-464d-882c-b770534b756e'::uuid,
  1
);

-- Expected: {"success": true, "data": []}

-- Test 2: Record a test metric
SELECT public.record_imprisonment_metric(
  '9c8db54f-b77f-464d-882c-b770534b756e'::uuid,
  1,
  1800,
  'TestPlayer',
  'primary',
  false
);

-- Expected: {"success": true}

-- Test 3: Get metrics again (should return the test data)
SELECT public.get_imprisonment_metrics(
  '9c8db54f-b77f-464d-882c-b770534b756e'::uuid,
  1
);

-- Expected: {"success": true, "data": [{"timestamp": 1800, "playerName": "TestPlayer", "code": "primary", "isClan": false}]}

-- =====================================================
-- COMPLETE!
-- =====================================================
