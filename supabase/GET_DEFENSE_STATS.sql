-- Function to get defense statistics for ML dashboard
-- SIMPLE: Just query imprisonment_metrics where is_defense = TRUE
-- player_name = rival name, timing_value = rival timing

CREATE OR REPLACE FUNCTION get_defense_stats(
    p_user_id UUID,
    p_context TEXT DEFAULT NULL,
    p_limit INTEGER DEFAULT 100
)
RETURNS TABLE (
    total_kicks INTEGER,
    fastest_rival_timing INTEGER,
    average_rival_timing INTEGER,
    slowest_rival_timing INTEGER,
    unique_rivals INTEGER,
    most_dangerous_rival TEXT,
    most_dangerous_rival_kicks INTEGER,
    risk_level TEXT,
    speed_advantage INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_your_avg_timing INTEGER;
BEGIN
    -- Get your average attack timing for comparison
    SELECT AVG(timing_value)::INTEGER INTO v_your_avg_timing
    FROM imprisonment_metrics
    WHERE user_id = p_user_id
    AND is_defense = FALSE
    AND is_success = TRUE
    AND (p_context IS NULL OR context = p_context);
    
    -- Return defense statistics
    RETURN QUERY
    WITH defense_data AS (
        SELECT 
            timing_value as rival_timing,  -- Rival's timing
            player_name as rival_name      -- Rival's name
        FROM imprisonment_metrics
        WHERE user_id = p_user_id
        AND is_defense = TRUE
        AND (p_context IS NULL OR context = p_context)
        ORDER BY created_at DESC
        LIMIT p_limit
    ),
    rival_counts AS (
        SELECT 
            rival_name,
            COUNT(*) as kick_count
        FROM defense_data
        GROUP BY rival_name
        ORDER BY kick_count DESC
        LIMIT 1
    )
    SELECT 
        COUNT(*)::INTEGER as total_kicks,
        MIN(rival_timing)::INTEGER as fastest_rival_timing,
        AVG(rival_timing)::INTEGER as average_rival_timing,
        MAX(rival_timing)::INTEGER as slowest_rival_timing,
        COUNT(DISTINCT rival_name)::INTEGER as unique_rivals,
        (SELECT rival_name FROM rival_counts) as most_dangerous_rival,
        (SELECT kick_count FROM rival_counts)::INTEGER as most_dangerous_rival_kicks,
        CASE 
            WHEN v_your_avg_timing IS NULL THEN 'UNKNOWN'
            WHEN AVG(rival_timing) < v_your_avg_timing THEN 'HIGH'
            WHEN AVG(rival_timing) < v_your_avg_timing + 50 THEN 'MEDIUM'
            ELSE 'LOW'
        END as risk_level,
        (AVG(rival_timing) - v_your_avg_timing)::INTEGER as speed_advantage
    FROM defense_data;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION get_defense_stats TO authenticated;

-- Example usage:
-- SELECT * FROM get_defense_stats('user-uuid-here', 'NORMAL', 50);
