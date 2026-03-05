-- Create or replace get_defense_stats function
-- This function returns defense statistics for a user

CREATE OR REPLACE FUNCTION get_defense_stats(
    p_user_id UUID,
    p_context TEXT DEFAULT NULL,
    p_limit INTEGER DEFAULT 100
)
RETURNS TABLE (
    total_kicks INTEGER,
    avg_rival_timing NUMERIC,
    fastest_rival INTEGER,
    slowest_rival INTEGER,
    kick_rate NUMERIC
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        COUNT(*)::INTEGER as total_kicks,
        AVG(timing_value)::NUMERIC as avg_rival_timing,
        MIN(timing_value)::INTEGER as fastest_rival,
        MAX(timing_value)::INTEGER as slowest_rival,
        (COUNT(*)::NUMERIC / NULLIF((
            SELECT COUNT(*) 
            FROM imprisonment_metrics 
            WHERE user_id = p_user_id 
              AND (p_context IS NULL OR context = p_context)
        ), 0) * 100)::NUMERIC as kick_rate
    FROM imprisonment_metrics
    WHERE user_id = p_user_id
      AND is_defense = true
      AND (p_context IS NULL OR context = p_context)
    LIMIT p_limit;
END;
$$;

-- Test the function
SELECT * FROM get_defense_stats(
    '00000000-0000-0000-0000-000000000000'::UUID,
    NULL,
    100
);

-- Should return one row with stats (or zeros if no defense records)
