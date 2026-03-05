-- ============================================
-- FIX: Remove old function versions and install new one
-- Run this if QUICK_CHECK shows multiple versions
-- ============================================

-- 1. Drop ALL versions of the function
DROP FUNCTION IF EXISTS public.record_imprisonment_metric(UUID, INTEGER, INTEGER, VARCHAR, VARCHAR, BOOLEAN, BOOLEAN, INTEGER, VARCHAR, INTEGER, VARCHAR);
DROP FUNCTION IF EXISTS public.record_imprisonment_metric(UUID, INTEGER, INTEGER, VARCHAR, VARCHAR, BOOLEAN, BOOLEAN, INTEGER, VARCHAR, INTEGER, VARCHAR, VARCHAR);
DROP FUNCTION IF EXISTS public.record_imprisonment_metric;

-- 2. Create the NEW version with adjustment_reason
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

-- 3. Grant permissions
GRANT EXECUTE ON FUNCTION public.record_imprisonment_metric TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_imprisonment_metric TO anon;

-- 4. Verify
SELECT 
    proname as function_name,
    pronargs as param_count,
    CASE 
        WHEN pronargs = 12 THEN '✅ FIXED! Function now has 12 parameters'
        ELSE '❌ Still wrong: ' || pronargs || ' parameters'
    END as status
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public' 
AND p.proname = 'record_imprisonment_metric';

-- 5. Test insert
SELECT public.record_imprisonment_metric(
    '00000000-0000-0000-0000-000000000000'::UUID,
    1, 9999, 'TEST_FIX', 'primary',
    FALSE, TRUE, 1922, 'attack',
    175, 'NORMAL', 'SUCCESS'
) as test_result;

-- 6. Verify test
SELECT 
    id, player_name, adjustment_reason, created_at
FROM imprisonment_metrics
WHERE player_name = 'TEST_FIX'
ORDER BY created_at DESC
LIMIT 1;

-- 7. Cleanup
DELETE FROM imprisonment_metrics WHERE player_name = 'TEST_FIX';

SELECT '✅ FIX COMPLETE! Function updated and tested.' as result;
