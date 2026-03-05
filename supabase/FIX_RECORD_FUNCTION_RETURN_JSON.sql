-- Fix record_imprisonment_metric to return JSON instead of void
-- This ensures compatibility with the backend API that expects JSON response

-- Drop ALL existing versions of the function with different signatures
DROP FUNCTION IF EXISTS record_imprisonment_metric(UUID, INTEGER, BIGINT, TEXT, TEXT, BOOLEAN, BOOLEAN, INTEGER, TEXT, INTEGER, TEXT, TEXT, BOOLEAN);
DROP FUNCTION IF EXISTS record_imprisonment_metric(UUID, INTEGER, INTEGER, TEXT, TEXT, BOOLEAN, BOOLEAN, INTEGER, TEXT, INTEGER, TEXT, TEXT, BOOLEAN);
DROP FUNCTION IF EXISTS record_imprisonment_metric(UUID, INTEGER, BIGINT, TEXT, TEXT, BOOLEAN, BOOLEAN, INTEGER, TEXT, INTEGER, TEXT);
DROP FUNCTION IF EXISTS record_imprisonment_metric(UUID, INTEGER, INTEGER, TEXT, TEXT, BOOLEAN, BOOLEAN, INTEGER, TEXT, INTEGER, TEXT);
DROP FUNCTION IF EXISTS record_imprisonment_metric(UUID, INTEGER, INTEGER, TEXT, TEXT, BOOLEAN, BOOLEAN, TEXT, INTEGER, TEXT, INTEGER, TEXT);
DROP FUNCTION IF EXISTS record_imprisonment_metric(UUID, INTEGER, INTEGER, TEXT, TEXT, BOOLEAN, BOOLEAN);
DROP FUNCTION IF EXISTS public.record_imprisonment_metric CASCADE;

-- Create function with JSON return type (using INTEGER for timestamp_ms)
CREATE OR REPLACE FUNCTION record_imprisonment_metric(
    p_user_id UUID,
    p_connection_number INTEGER,
    p_timestamp_ms INTEGER,  -- Changed from BIGINT to INTEGER for consistency
    p_player_name TEXT,
    p_code_used TEXT,
    p_is_clan_member BOOLEAN,
    p_is_success BOOLEAN DEFAULT true,
    p_timing_value INTEGER DEFAULT NULL,
    p_timing_type TEXT DEFAULT NULL,
    p_ping_ms INTEGER DEFAULT NULL,
    p_context TEXT DEFAULT NULL,
    p_adjustment_reason TEXT DEFAULT NULL,
    p_is_defense BOOLEAN DEFAULT false
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
    INSERT INTO imprisonment_metrics (
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
    ) VALUES (
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
    
    RETURN json_build_object('success', true, 'message', 'Metric recorded successfully');
    
EXCEPTION
    WHEN OTHERS THEN
        RAISE NOTICE 'Error in record_imprisonment_metric: %', SQLERRM;
        RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION record_imprisonment_metric(UUID, INTEGER, INTEGER, TEXT, TEXT, BOOLEAN, BOOLEAN, INTEGER, TEXT, INTEGER, TEXT, TEXT, BOOLEAN) TO anon, authenticated;

-- Verify the function
SELECT 
    p.proname as function_name,
    pg_get_function_arguments(p.oid) as parameters,
    pg_get_function_result(p.oid) as return_type
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public' 
  AND p.proname = 'record_imprisonment_metric';

-- Test the function (should return JSON)
SELECT record_imprisonment_metric(
    '00000000-0000-0000-0000-000000000000'::UUID,
    1,
    1000,
    'TestJSONReturn',
    'primary',
    false,
    true,
    1800,
    'attack',
    200,
    'SLOW',
    'SUCCESS',
    false
);

-- Verify record was created
SELECT 
    player_name,
    timing_value,
    ping_ms,
    context,
    adjustment_reason,
    is_defense,
    is_success,
    created_at
FROM imprisonment_metrics
WHERE player_name = 'TestJSONReturn'
ORDER BY created_at DESC
LIMIT 1;

-- Clean up test data
DELETE FROM imprisonment_metrics WHERE player_name = 'TestJSONReturn';

COMMENT ON FUNCTION record_imprisonment_metric IS 'Records imprisonment metrics with JSON return type for API compatibility';
