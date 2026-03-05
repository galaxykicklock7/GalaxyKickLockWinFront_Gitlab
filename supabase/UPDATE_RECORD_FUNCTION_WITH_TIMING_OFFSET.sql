-- Update record_imprisonment_metric function to calculate timing_offset
-- This ensures new records automatically have timing_offset calculated

CREATE OR REPLACE FUNCTION record_imprisonment_metric(
    p_user_id UUID,
    p_connection_number INTEGER,
    p_timestamp_ms BIGINT,
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
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
    v_timing_offset INTEGER;
BEGIN
    -- Calculate timing_offset if timing_value and ping_ms are provided
    -- timing_offset = timing_value - (1700 + ping_ms)
    IF p_timing_value IS NOT NULL AND p_ping_ms IS NOT NULL THEN
        v_timing_offset := p_timing_value - (1700 + p_ping_ms);
    ELSE
        v_timing_offset := NULL;
    END IF;

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
        is_defense,
        timing_offset
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
        p_is_defense,
        v_timing_offset
    );
END;
$$;

-- Test the function
SELECT record_imprisonment_metric(
    '00000000-0000-0000-0000-000000000000'::UUID,
    1,
    1000,
    'TestPlayer',
    'primary',
    false,
    true,
    1740,  -- timing_value
    'attack',
    100,   -- ping_ms
    'NORMAL',
    'INIT',  -- Valid adjustment_reason
    false
);

-- Verify timing_offset was calculated correctly
-- Expected: 1740 - (1700 + 100) = -60
SELECT 
    player_name,
    timing_value,
    ping_ms,
    timing_offset,
    timing_value - (1700 + ping_ms) as expected_offset
FROM imprisonment_metrics
WHERE player_name = 'TestPlayer'
ORDER BY created_at DESC
LIMIT 1;

-- Clean up test data
DELETE FROM imprisonment_metrics WHERE player_name = 'TestPlayer';
