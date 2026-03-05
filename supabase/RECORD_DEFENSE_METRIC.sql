-- Function to record defense metric (when rival kicks you)
-- SIMPLE: Uses same imprisonment_metrics table, just set is_defense = TRUE
-- Uses existing columns: player_name (rival name), timing_value (rival timing)

CREATE OR REPLACE FUNCTION record_defense_metric(
    p_user_id UUID,
    p_connection_number INTEGER,
    p_timestamp_ms BIGINT,
    p_rival_name TEXT,
    p_rival_timing INTEGER,
    p_your_timing INTEGER,
    p_ping_ms INTEGER,
    p_context TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    INSERT INTO imprisonment_metrics (
        user_id,
        connection_number,
        timestamp_ms,
        player_name,        -- Rival name
        code_used,
        is_clan_member,
        is_success,         -- Always FALSE (you got kicked)
        timing_value,       -- Rival's timing (how fast they kicked you)
        timing_type,
        ping_ms,
        context,
        is_defense          -- TRUE (this is defense data)
    ) VALUES (
        p_user_id,
        p_connection_number,
        p_timestamp_ms,
        p_rival_name,
        'N/A',              -- Not applicable for defense
        FALSE,              -- Not applicable for defense
        FALSE,              -- You got kicked = not success
        p_rival_timing,     -- Rival's timing
        'defense',
        p_ping_ms,
        p_context,
        TRUE                -- This is defense metric
    );
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION record_defense_metric TO authenticated;

-- Test the function
DO $$
BEGIN
    RAISE NOTICE 'Defense metric function created successfully';
    RAISE NOTICE 'Usage: SELECT record_defense_metric(user_id, conn, timestamp, rival_name, rival_timing, your_timing, ping, context)';
END $$;
