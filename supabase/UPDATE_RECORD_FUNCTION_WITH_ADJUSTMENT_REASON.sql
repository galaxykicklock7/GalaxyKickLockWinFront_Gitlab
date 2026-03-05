-- Update record_imprisonment_metric function to include adjustment_reason parameter
-- This tracks what caused the ML timing change: 3S_ERROR, SUCCESS, FAILURE, STUCK_ESCAPE, INIT, DB_INIT

CREATE OR REPLACE FUNCTION public.record_imprisonment_metric(
    p_user_id UUID,
    p_connection_number INTEGER,
    p_timestamp_ms INTEGER,
    p_player_name VARCHAR(255),
    p_code_used VARCHAR(10),
    p_is_clan_member BOOLEAN DEFAULT FALSE,
    p_is_success BOOLEAN DEFAULT TRUE,
    p_timing_value INTEGER DEFAULT NULL,
    p_timing_type VARCHAR(10) DEFAULT NULL,
    p_ping_ms INTEGER DEFAULT NULL,
    p_context VARCHAR(20) DEFAULT NULL,
    p_adjustment_reason VARCHAR(20) DEFAULT NULL  -- NEW PARAMETER
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_result JSON;
BEGIN
    -- Insert the metric
    INSERT INTO public.imprisonment_metrics (
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
        adjustment_reason,  -- NEW COLUMN
        created_at
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
        p_adjustment_reason,  -- NEW VALUE
        NOW()
    );
    
    -- Return success
    v_result := json_build_object(
        'success', TRUE,
        'message', 'Metric recorded successfully',
        'adjustment_reason', p_adjustment_reason
    );
    
    RETURN v_result;
    
EXCEPTION
    WHEN OTHERS THEN
        -- Return error
        v_result := json_build_object(
            'success', FALSE,
            'error', SQLERRM
        );
        RETURN v_result;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION public.record_imprisonment_metric TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_imprisonment_metric TO anon;

-- Test the function
SELECT public.record_imprisonment_metric(
    '00000000-0000-0000-0000-000000000000'::UUID,  -- test user_id
    1,                                               -- connection_number
    1500,                                            -- timestamp_ms
    'TestPlayer',                                    -- player_name
    'primary',                                       -- code_used
    FALSE,                                           -- is_clan_member
    TRUE,                                            -- is_success
    1922,                                            -- timing_value
    'attack',                                        -- timing_type
    175,                                             -- ping_ms
    'NORMAL',                                        -- context
    'SUCCESS'                                        -- adjustment_reason (NEW)
);
