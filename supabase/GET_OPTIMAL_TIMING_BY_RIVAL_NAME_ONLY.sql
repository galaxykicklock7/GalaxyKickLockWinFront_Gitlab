-- Function to calculate optimal timing for a specific rival
-- Returns optimal timing + zone danger analysis
--
-- Weights:
-- KICKED     4.0 — highest priority, we got punished here
-- SUCCESS    3.0 — most trusted, this timing actually worked
-- 3S_ERROR   2.0 — direct measurement of failure
-- LEFT_EARLY 1.5 — ceiling hint only (rival's leave time), capped at avg 3S_ERROR floor

DROP FUNCTION IF EXISTS get_optimal_timing_for_rival(TEXT, BOOLEAN);
DROP FUNCTION IF EXISTS get_optimal_timing_for_rival(UUID, TEXT, BOOLEAN);

CREATE OR REPLACE FUNCTION get_optimal_timing_for_rival(
    p_user_id UUID,
    p_rival_name TEXT,
    p_is_defense BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
    optimal_timing INTEGER,
    record_count INTEGER,
    success_count INTEGER,
    kicked_count INTEGER,
    error_count INTEGER,
    left_early_count INTEGER,
    slow_zone_kicked INTEGER,
    normal_zone_kicked INTEGER,
    fast_zone_kicked INTEGER
) AS $$
BEGIN
    RETURN QUERY
    WITH recent_records AS (
        SELECT
            timing_value,
            adjustment_reason,
            created_at,
            CASE
                WHEN timing_value < 1875 THEN 'SLOW'
                WHEN timing_value < 1975 THEN 'NORMAL'
                ELSE 'FAST'
            END as zone,
            CASE
                WHEN ROW_NUMBER() OVER (ORDER BY created_at DESC) <= 10 THEN 1.5
                WHEN ROW_NUMBER() OVER (ORDER BY created_at DESC) <= 30 THEN 1.0
                ELSE 0.5
            END as recency_weight
        FROM imprisonment_metrics
        WHERE user_id = p_user_id
          AND player_name = p_rival_name
          AND COALESCE(is_defense, false) = p_is_defense
        ORDER BY created_at DESC
    ),
    zone_analysis AS (
        SELECT
            COUNT(CASE WHEN zone = 'SLOW' AND adjustment_reason = 'KICKED' THEN 1 END) as slow_kicked,
            COUNT(CASE WHEN zone = 'NORMAL' AND adjustment_reason = 'KICKED' THEN 1 END) as normal_kicked,
            COUNT(CASE WHEN zone = 'FAST' AND adjustment_reason = 'KICKED' THEN 1 END) as fast_kicked
        FROM recent_records
    ),
    -- Floor set by 3S_ERROR — LEFT_EARLY capped here so it never pulls optimal above a known failing point
    error_floor AS (
        SELECT COALESCE(AVG(timing_value), 9999) as avg_error_timing
        FROM recent_records
        WHERE adjustment_reason = '3S_ERROR'
    ),
    weighted_calculation AS (
        SELECT
            -- KICKED: weight 4.0, -30ms safety margin
            SUM(CASE
                WHEN adjustment_reason = 'KICKED' THEN
                    (timing_value - 30) * 4.0 * recency_weight *
                    CASE zone
                        WHEN 'SLOW' THEN CASE WHEN (SELECT slow_kicked FROM zone_analysis) >= 8 THEN 1.5
                                              WHEN (SELECT slow_kicked FROM zone_analysis) >= 4 THEN 1.2
                                              ELSE 0.8 END
                        WHEN 'NORMAL' THEN CASE WHEN (SELECT normal_kicked FROM zone_analysis) >= 8 THEN 1.5
                                                WHEN (SELECT normal_kicked FROM zone_analysis) >= 4 THEN 1.2
                                                ELSE 0.8 END
                        WHEN 'FAST' THEN CASE WHEN (SELECT fast_kicked FROM zone_analysis) >= 8 THEN 1.5
                                              WHEN (SELECT fast_kicked FROM zone_analysis) >= 4 THEN 1.2
                                              ELSE 0.8 END
                    END
                ELSE 0
            END) as kicked_weighted,

            -- LEFT_EARLY: weight 1.5, -10ms, capped at avg 3S_ERROR timing
            SUM(CASE
                WHEN adjustment_reason = 'LEFT_EARLY'
                THEN (LEAST(timing_value, (SELECT avg_error_timing FROM error_floor)::INTEGER) - 10)
                     * 1.5 * recency_weight
                ELSE 0
            END) as left_early_weighted,

            -- SUCCESS: weight 3.0, no adjustment
            SUM(CASE
                WHEN adjustment_reason = 'SUCCESS'
                THEN timing_value * 3.0 * recency_weight
                ELSE 0
            END) as success_weighted,

            -- 3S_ERROR: weight 2.0, -15ms
            SUM(CASE
                WHEN adjustment_reason = '3S_ERROR'
                THEN (timing_value - 15) * 2.0 * recency_weight
                ELSE 0
            END) as error_weighted,

            -- Total weights
            SUM(CASE
                WHEN adjustment_reason = 'KICKED' THEN
                    4.0 * recency_weight * CASE zone
                        WHEN 'SLOW' THEN CASE WHEN (SELECT slow_kicked FROM zone_analysis) >= 8 THEN 1.5
                                              WHEN (SELECT slow_kicked FROM zone_analysis) >= 4 THEN 1.2
                                              ELSE 0.8 END
                        WHEN 'NORMAL' THEN CASE WHEN (SELECT normal_kicked FROM zone_analysis) >= 8 THEN 1.5
                                                WHEN (SELECT normal_kicked FROM zone_analysis) >= 4 THEN 1.2
                                                ELSE 0.8 END
                        WHEN 'FAST' THEN CASE WHEN (SELECT fast_kicked FROM zone_analysis) >= 8 THEN 1.5
                                              WHEN (SELECT fast_kicked FROM zone_analysis) >= 4 THEN 1.2
                                              ELSE 0.8 END
                    END
                ELSE 0
            END) as kicked_weight,
            SUM(CASE WHEN adjustment_reason = 'LEFT_EARLY' THEN 1.5 * recency_weight ELSE 0 END) as left_early_weight,
            SUM(CASE WHEN adjustment_reason = 'SUCCESS' THEN 3.0 * recency_weight ELSE 0 END) as success_weight,
            SUM(CASE WHEN adjustment_reason = '3S_ERROR' THEN 2.0 * recency_weight ELSE 0 END) as error_weight,

            COUNT(*) as total_count,
            COUNT(CASE WHEN adjustment_reason = 'SUCCESS' THEN 1 END) as success_cnt,
            COUNT(CASE WHEN adjustment_reason = 'KICKED' THEN 1 END) as kicked_cnt,
            COUNT(CASE WHEN adjustment_reason = '3S_ERROR' THEN 1 END) as error_cnt,
            COUNT(CASE WHEN adjustment_reason = 'LEFT_EARLY' THEN 1 END) as left_early_cnt
        FROM recent_records
    )
    SELECT
        ROUND(
            (kicked_weighted + left_early_weighted + success_weighted + error_weighted) /
            NULLIF(kicked_weight + left_early_weight + success_weight + error_weight, 0)
        )::INTEGER as optimal_timing,
        total_count::INTEGER as record_count,
        success_cnt::INTEGER as success_count,
        kicked_cnt::INTEGER as kicked_count,
        error_cnt::INTEGER as error_count,
        left_early_cnt::INTEGER as left_early_count,
        (SELECT slow_kicked FROM zone_analysis)::INTEGER as slow_zone_kicked,
        (SELECT normal_kicked FROM zone_analysis)::INTEGER as normal_zone_kicked,
        (SELECT fast_kicked FROM zone_analysis)::INTEGER as fast_zone_kicked
    FROM weighted_calculation
    WHERE (kicked_weight + left_early_weight + success_weight + error_weight) > 0;
END;
$$ LANGUAGE plpgsql;

-- Example usage:
-- SELECT * FROM get_optimal_timing_for_rival('h3ll', false);
-- SELECT * FROM get_optimal_timing_for_rival('PlayerX', true);
