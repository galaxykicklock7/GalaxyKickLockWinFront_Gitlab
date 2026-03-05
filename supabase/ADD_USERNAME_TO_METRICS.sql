-- =====================================================
-- ADD USERNAME COLUMN TO METRICS
-- =====================================================

-- Add username column to track who is logged in
ALTER TABLE public.imprisonment_metrics 
ADD COLUMN IF NOT EXISTS username VARCHAR(255);

-- Create index for faster cleanup queries
CREATE INDEX IF NOT EXISTS idx_imprisonment_username ON public.imprisonment_metrics(username);

-- Update the record function to accept username
DROP FUNCTION IF EXISTS public.record_imprisonment_metric(UUID, INTEGER, INTEGER, TEXT, TEXT, BOOLEAN, BOOLEAN);

CREATE OR REPLACE FUNCTION public.record_imprisonment_metric(
  p_user_id UUID,
  p_connection_number INTEGER,
  p_timestamp_ms INTEGER,
  p_player_name TEXT,
  p_code_used TEXT,
  p_is_clan_member BOOLEAN,
  p_is_success BOOLEAN DEFAULT TRUE,
  p_username TEXT DEFAULT NULL
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
  
  -- Insert metric with username
  INSERT INTO public.imprisonment_metrics (
    user_id, 
    connection_number, 
    timestamp_ms, 
    player_name, 
    code_used, 
    is_clan_member,
    is_success,
    username
  )
  VALUES (
    p_user_id, 
    p_connection_number, 
    p_timestamp_ms, 
    p_player_name, 
    p_code_used, 
    p_is_clan_member,
    p_is_success,
    p_username
  );
  
  RETURN json_build_object('success', true);
  
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Error in record_imprisonment_metric: %', SQLERRM;
    RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- Create cleanup function to delete old metrics for a user
CREATE OR REPLACE FUNCTION public.cleanup_user_metrics(
  p_username TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_deleted_count INTEGER;
BEGIN
  -- Delete all metrics for this username
  DELETE FROM public.imprisonment_metrics
  WHERE username = p_username;
  
  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  
  RAISE NOTICE 'Deleted % metrics for username: %', v_deleted_count, p_username;
  
  RETURN json_build_object(
    'success', true, 
    'deleted', v_deleted_count,
    'username', p_username
  );
  
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Error in cleanup_user_metrics: %', SQLERRM;
    RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION public.record_imprisonment_metric(UUID, INTEGER, INTEGER, TEXT, TEXT, BOOLEAN, BOOLEAN, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_user_metrics(TEXT) TO anon, authenticated;

-- =====================================================
-- TEST
-- =====================================================

-- Test cleanup
SELECT public.cleanup_user_metrics('testuser@example.com');

-- Expected: {"success": true, "deleted": 0, "username": "testuser@example.com"}
