-- =====================================================
-- ADD TIMING TRACKING TO IMPRISONMENT METRICS
-- =====================================================
-- Adds timing_value and timing_type to track exact timing used
-- =====================================================

-- Add timing columns to existing table
ALTER TABLE public.imprisonment_metrics 
ADD COLUMN IF NOT EXISTS timing_value INTEGER,
ADD COLUMN IF NOT EXISTS timing_type VARCHAR(10) CHECK (timing_type IN ('attack', 'defense'));

-- Create index for faster queries on timing
CREATE INDEX IF NOT EXISTS idx_imprisonment_timing ON public.imprisonment_metrics(user_id, connection_number, created_at DESC);

-- Drop existing function
DROP FUNCTION IF EXISTS public.record_imprisonment_metric(UUID, INTEGER, INTEGER, TEXT, TEXT, BOOLEAN, BOOLEAN);

-- Updated function with timing parameters
CREATE OR REPLACE FUNCTION public.record_imprisonment_metric(
  p_user_id UUID,
  p_connection_number INTEGER,
  p_timestamp_ms INTEGER,
  p_player_name TEXT,
  p_code_used TEXT,
  p_is_clan_member BOOLEAN,
  p_is_success BOOLEAN DEFAULT TRUE,
  p_timing_value INTEGER DEFAULT NULL,
  p_timing_type TEXT DEFAULT NULL
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
    timing_type
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
    p_timing_type
  );
  
  RETURN json_build_object('success', true);
  
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Error in record_imprisonment_metric: %', SQLERRM;
    RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- Function to check if stuck at max timing
CREATE OR REPLACE FUNCTION public.check_stuck_at_max(
  p_user_id UUID,
  p_connection_number INTEGER,
  p_max_attack INTEGER,
  p_max_defense INTEGER
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_last_3 RECORD;
  v_stuck_at_max BOOLEAN := false;
  v_stuck_type TEXT := NULL;
  v_count INTEGER := 0;
BEGIN
  -- Get last 3 records from the last 1 hour only (using TIMESTAMPTZ for timezone-aware comparison)
  SELECT 
    COUNT(*) as total_count,
    COUNT(*) FILTER (WHERE timing_type = 'attack' AND timing_value >= p_max_attack AND is_success = false) as attack_max_errors,
    COUNT(*) FILTER (WHERE timing_type = 'defense' AND timing_value >= p_max_defense AND is_success = false) as defense_max_errors,
    MAX(CASE WHEN timing_type = 'attack' THEN timing_value END) as last_attack_timing,
    MAX(CASE WHEN timing_type = 'defense' THEN timing_value END) as last_defense_timing
  INTO v_last_3
  FROM (
    SELECT timing_value, timing_type, is_success, created_at
    FROM public.imprisonment_metrics
    WHERE user_id = p_user_id 
      AND connection_number = p_connection_number
      AND timing_value IS NOT NULL
      AND timing_type IS NOT NULL
      AND created_at >= NOW() - INTERVAL '1 hour'  -- ✅ Only last 1 hour (timezone-aware)
    ORDER BY created_at DESC
    LIMIT 3
  ) recent;
  
  -- Check if stuck at attack max (all 3 recent are at max attack with errors)
  IF v_last_3.attack_max_errors >= 3 THEN
    v_stuck_at_max := true;
    v_stuck_type := 'attack';
  END IF;
  
  -- Check if stuck at defense max (all 3 recent are at max defense with errors)
  IF v_last_3.defense_max_errors >= 3 THEN
    v_stuck_at_max := true;
    v_stuck_type := 'defense';
  END IF;
  
  RETURN json_build_object(
    'success', true,
    'stuckAtMax', v_stuck_at_max,
    'stuckType', v_stuck_type,
    'lastAttackTiming', v_last_3.last_attack_timing,
    'lastDefenseTiming', v_last_3.last_defense_timing
  );
  
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Error in check_stuck_at_max: %', SQLERRM;
    RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION public.record_imprisonment_metric(UUID, INTEGER, INTEGER, TEXT, TEXT, BOOLEAN, BOOLEAN, INTEGER, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_stuck_at_max(UUID, INTEGER, INTEGER, INTEGER) TO anon, authenticated;

-- =====================================================
-- COMPLETE!
-- =====================================================
