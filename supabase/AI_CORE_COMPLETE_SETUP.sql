-- =====================================================
-- AI CORE - COMPLETE DATABASE SETUP
-- Ultra-Fast Learning System
-- =====================================================

-- Step 1: Add ping_ms to existing imprisonment_metrics table
ALTER TABLE public.imprisonment_metrics 
ADD COLUMN IF NOT EXISTS ping_ms INTEGER;

-- Step 2: Add context column (FAST/NORMAL/SLOW)
ALTER TABLE public.imprisonment_metrics 
ADD COLUMN IF NOT EXISTS context VARCHAR(20);

-- Step 3: Create index for AI queries
CREATE INDEX IF NOT EXISTS idx_ai_personal_history 
ON public.imprisonment_metrics(user_id, connection_number, timing_type, is_success, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_transfer_learning 
ON public.imprisonment_metrics(timing_type, is_success, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_context_lookup 
ON public.imprisonment_metrics(user_id, connection_number, context, timing_type);

-- Step 4: Create AI learning cache table (for speed)
CREATE TABLE IF NOT EXISTS public.ai_learning_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  connection_number INTEGER NOT NULL CHECK (connection_number BETWEEN 1 AND 5),
  
  -- Context
  context VARCHAR(20) NOT NULL, -- 'FAST', 'NORMAL', 'SLOW'
  timing_type VARCHAR(20) NOT NULL, -- 'attack' or 'defense'
  
  -- Learned optimal timing
  optimal_timing INTEGER NOT NULL,
  confidence_score DECIMAL(5,2) DEFAULT 0.00, -- 0-100
  
  -- Statistics
  total_attempts INTEGER DEFAULT 0,
  successful_attempts INTEGER DEFAULT 0,
  success_rate DECIMAL(5,2) DEFAULT 0.00,
  
  -- Timestamps
  last_updated TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Unique constraint
  UNIQUE(user_id, connection_number, context, timing_type)
);

-- Index for cache lookups
CREATE INDEX IF NOT EXISTS idx_ai_cache_lookup 
ON public.ai_learning_cache(user_id, connection_number, context, timing_type);

-- Step 5: Create AI context log table (track server conditions)
CREATE TABLE IF NOT EXISTS public.ai_context_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  connection_number INTEGER NOT NULL CHECK (connection_number BETWEEN 1 AND 5),
  
  -- Ping measurement
  ping_ms INTEGER NOT NULL,
  
  -- Detected context
  context VARCHAR(20) NOT NULL, -- 'FAST', 'NORMAL', 'SLOW'
  
  -- Timestamp
  detected_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for recent context queries
CREATE INDEX IF NOT EXISTS idx_ai_context_recent 
ON public.ai_context_log(user_id, connection_number, detected_at DESC);

-- =====================================================
-- AI FUNCTIONS
-- =====================================================

-- Function 1: Get personal optimal timing
CREATE OR REPLACE FUNCTION public.ai_get_personal_optimal(
  p_user_id UUID,
  p_connection_number INTEGER,
  p_context VARCHAR(20),
  p_timing_type VARCHAR(20)
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_optimal_timing INTEGER;
  v_success_rate DECIMAL(5,2);
  v_total_attempts INTEGER;
BEGIN
  -- Check cache first
  SELECT optimal_timing, success_rate, total_attempts
  INTO v_optimal_timing, v_success_rate, v_total_attempts
  FROM public.ai_learning_cache
  WHERE user_id = p_user_id
    AND connection_number = p_connection_number
    AND context = p_context
    AND timing_type = p_timing_type
    AND last_updated >= NOW() - INTERVAL '1 hour'; -- Cache valid for 1 hour
  
  IF FOUND AND v_total_attempts >= 5 THEN
    -- Return cached result
    RETURN json_build_object(
      'success', true,
      'source', 'cache',
      'optimal_timing', v_optimal_timing,
      'success_rate', v_success_rate,
      'total_attempts', v_total_attempts
    );
  END IF;
  
  -- Calculate from raw data
  WITH timing_stats AS (
    SELECT 
      timing_value,
      COUNT(*) as total,
      SUM(CASE WHEN is_success THEN 1 ELSE 0 END) as successes,
      (SUM(CASE WHEN is_success THEN 1 ELSE 0 END)::DECIMAL / COUNT(*)) * 100 as success_rate
    FROM public.imprisonment_metrics
    WHERE user_id = p_user_id
      AND connection_number = p_connection_number
      AND timing_type = p_timing_type
      AND created_at >= NOW() - INTERVAL '7 days' -- Last 7 days
    GROUP BY timing_value
    HAVING COUNT(*) >= 5 -- At least 5 attempts per timing
  )
  SELECT timing_value, success_rate, total
  INTO v_optimal_timing, v_success_rate, v_total_attempts
  FROM timing_stats
  WHERE success_rate >= 80 -- At least 80% success
  ORDER BY success_rate DESC, total DESC
  LIMIT 1;
  
  IF NOT FOUND THEN
    RETURN json_build_object(
      'success', false,
      'reason', 'Not enough personal data'
    );
  END IF;
  
  -- Update cache
  INSERT INTO public.ai_learning_cache (
    user_id, connection_number, context, timing_type,
    optimal_timing, confidence_score, total_attempts, 
    successful_attempts, success_rate
  )
  VALUES (
    p_user_id, p_connection_number, p_context, p_timing_type,
    v_optimal_timing, v_success_rate, v_total_attempts,
    ROUND(v_total_attempts * v_success_rate / 100), v_success_rate
  )
  ON CONFLICT (user_id, connection_number, context, timing_type)
  DO UPDATE SET
    optimal_timing = EXCLUDED.optimal_timing,
    confidence_score = EXCLUDED.confidence_score,
    total_attempts = EXCLUDED.total_attempts,
    successful_attempts = EXCLUDED.successful_attempts,
    success_rate = EXCLUDED.success_rate,
    last_updated = NOW();
  
  RETURN json_build_object(
    'success', true,
    'source', 'calculated',
    'optimal_timing', v_optimal_timing,
    'success_rate', v_success_rate,
    'total_attempts', v_total_attempts
  );
END;
$$;

-- Function 2: Get transfer learning optimal (from all users)
CREATE OR REPLACE FUNCTION public.ai_get_transfer_learning_optimal(
  p_context VARCHAR(20),
  p_timing_type VARCHAR(20)
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_optimal_timing INTEGER;
  v_user_count INTEGER;
  v_total_attempts INTEGER;
BEGIN
  -- Get most successful timing from all users
  WITH timing_popularity AS (
    SELECT 
      timing_value,
      COUNT(DISTINCT user_id) as user_count,
      COUNT(*) as total_attempts
    FROM public.imprisonment_metrics
    WHERE timing_type = p_timing_type
      AND is_success = true -- Only successful attempts
      AND created_at >= NOW() - INTERVAL '30 days' -- Last 30 days
    GROUP BY timing_value
    HAVING COUNT(DISTINCT user_id) >= 3 -- Used by at least 3 users
  )
  SELECT timing_value, user_count, total_attempts
  INTO v_optimal_timing, v_user_count, v_total_attempts
  FROM timing_popularity
  ORDER BY total_attempts DESC, user_count DESC
  LIMIT 1;
  
  IF NOT FOUND THEN
    RETURN json_build_object(
      'success', false,
      'reason', 'Not enough community data'
    );
  END IF;
  
  RETURN json_build_object(
    'success', true,
    'optimal_timing', v_optimal_timing,
    'user_count', v_user_count,
    'total_attempts', v_total_attempts
  );
END;
$$;

-- Function 3: Record context detection
CREATE OR REPLACE FUNCTION public.ai_record_context(
  p_user_id UUID,
  p_connection_number INTEGER,
  p_ping_ms INTEGER,
  p_context VARCHAR(20)
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.ai_context_log (
    user_id, connection_number, ping_ms, context
  )
  VALUES (
    p_user_id, p_connection_number, p_ping_ms, p_context
  );
  
  RETURN json_build_object('success', true);
END;
$$;

-- Function 4: Get recent context history
CREATE OR REPLACE FUNCTION public.ai_get_context_history(
  p_user_id UUID,
  p_connection_number INTEGER,
  p_limit INTEGER DEFAULT 10
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_history JSON;
BEGIN
  SELECT json_agg(
    json_build_object(
      'ping_ms', ping_ms,
      'context', context,
      'detected_at', detected_at
    )
    ORDER BY detected_at DESC
  )
  INTO v_history
  FROM (
    SELECT ping_ms, context, detected_at
    FROM public.ai_context_log
    WHERE user_id = p_user_id
      AND connection_number = p_connection_number
    ORDER BY detected_at DESC
    LIMIT p_limit
  ) recent;
  
  RETURN json_build_object(
    'success', true,
    'history', COALESCE(v_history, '[]'::json)
  );
END;
$$;

-- =====================================================
-- GRANT PERMISSIONS
-- =====================================================

GRANT EXECUTE ON FUNCTION public.ai_get_personal_optimal(UUID, INTEGER, VARCHAR, VARCHAR) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_get_transfer_learning_optimal(VARCHAR, VARCHAR) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_record_context(UUID, INTEGER, INTEGER, VARCHAR) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_get_context_history(UUID, INTEGER, INTEGER) TO anon, authenticated;

-- =====================================================
-- COMPLETE!
-- =====================================================
-- ✅ Added ping_ms and context to imprisonment_metrics
-- ✅ Created ai_learning_cache table
-- ✅ Created ai_context_log table
-- ✅ Created AI functions for fast queries
-- ✅ Created indexes for performance
-- =====================================================
