-- FINAL FIX: Complete cleanup and setup for ping_ms and context
-- This will fix the NULL values issue

-- ============================================================
-- STEP 1: Drop ALL versions of the function
-- ============================================================
DO $$
DECLARE
    func_oid OID;
BEGIN
    FOR func_oid IN 
        SELECT p.oid
        FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname = 'public' 
          AND p.proname = 'record_imprisonment_metric'
    LOOP
        EXECUTE 'DROP FUNCTION ' || func_oid::regprocedure;
        RAISE NOTICE 'Dropped function with OID: %', func_oid;
    END LOOP;
END $$;

-- ============================================================
-- STEP 2: Verify table has correct columns
-- ============================================================
SELECT 
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_schema = 'public' 
  AND table_name = 'imprisonment_metrics'
  AND column_name IN ('ping_ms', 'context', 'adjustment_reason', 'is_defense')
ORDER BY ordinal_position;

-- Should show:
-- ping_ms | integer | YES | NULL
-- context | character varying | YES | NULL
-- adjustment_reason | character varying | YES | NULL
-- is_defense | boolean | NO | false

-- ============================================================
-- STEP 3: Create the correct function (12 parameters)
-- ============================================================
CREATE FUNCTION record_imprisonment_metric(
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
    p_adjustment_reason TEXT DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
    -- Insert with all fields including ping_ms and context
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
        false
    );
    
    RAISE NOTICE 'Inserted record: ping_ms=%, context=%', p_ping_ms, p_context;
END;
$$;

-- ============================================================
-- STEP 4: Verify function signature
-- ============================================================
SELECT 
    p.proname as function_name,
    pg_get_function_arguments(p.oid) as parameters
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public' 
  AND p.proname = 'record_imprisonment_metric';

-- Should show 12 parameters ending with:
-- ..., p_ping_ms integer DEFAULT NULL, p_context text DEFAULT NULL, p_adjustment_reason text DEFAULT NULL

-- ============================================================
-- STEP 5: Test with explicit values
-- ============================================================
SELECT record_imprisonment_metric(
    '00000000-0000-0000-0000-000000000000'::UUID,
    1,
    1000,
    'TestPingContext',
    'primary',
    false,
    true,
    1925,
    'attack',
    150,      -- ping_ms
    'NORMAL', -- context
    'INIT'
);

-- ============================================================
-- STEP 6: Verify the test record
-- ============================================================
SELECT 
    id,
    player_name,
    timing_value,
    timing_type,
    ping_ms,
    context,
    adjustment_reason,
    is_defense,
    created_at
FROM imprisonment_metrics
WHERE player_name = 'TestPingContext'
ORDER BY created_at DESC
LIMIT 1;

-- EXPECTED RESULT:
-- ping_ms should be 150 (NOT NULL)
-- context should be 'NORMAL' (NOT NULL)

-- ============================================================
-- STEP 7: Clean up test data
-- ============================================================
DELETE FROM imprisonment_metrics WHERE player_name = 'TestPingContext';

-- ============================================================
-- STEP 8: Check recent real records
-- ============================================================
SELECT 
    id,
    player_name,
    timing_value,
    ping_ms,
    context,
    created_at
FROM imprisonment_metrics
ORDER BY created_at DESC
LIMIT 5;

-- If ping_ms and context are still NULL, the issue is in the backend code
-- not sending the values, not in the database function.

-- ============================================================
-- SUCCESS MESSAGE
-- ============================================================
SELECT 
    '✅ Database function fixed!' as status,
    'Function has 12 parameters and will save ping_ms and context' as info,
    'If new records still have NULL, check backend logs' as next_step;
