-- Clean setup for record_imprisonment_metric function
-- Matches your current backend code (12 parameters, no isDefense, no timing_offset)

-- Step 1: Drop ALL existing versions of the function
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

-- Step 2: Verify all versions are gone
SELECT 
    COUNT(*) as remaining_functions
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public' 
  AND p.proname = 'record_imprisonment_metric';
-- Should return 0

-- Step 3: Create the function matching your backend code
-- 12 parameters: user_id, connection_number, timestamp_ms, player_name, code_used, 
--                is_clan_member, is_success, timing_value, timing_type, 
--                ping_ms, context, adjustment_reason
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
    -- Insert record with all fields
    -- is_defense defaults to false (attack metric)
    -- timing_offset is NULL (not used)
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
        false  -- Always false for attack metrics
    );
END;
$$;

-- Step 4: Verify function exists with correct signature
SELECT 
    p.proname as function_name,
    pg_get_function_arguments(p.oid) as parameters
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public' 
  AND p.proname = 'record_imprisonment_metric';
-- Should show 12 parameters

-- Step 5: Test the function with all parameters
SELECT record_imprisonment_metric(
    '00000000-0000-0000-0000-000000000000'::UUID,  -- p_user_id
    1,                                              -- p_connection_number
    1000,                                           -- p_timestamp_ms
    'TestFunctionSetup',                            -- p_player_name
    'primary',                                      -- p_code_used
    false,                                          -- p_is_clan_member
    true,                                           -- p_is_success
    1800,                                           -- p_timing_value
    'attack',                                       -- p_timing_type
    200,                                            -- p_ping_ms (SHOULD BE SAVED)
    'SLOW',                                         -- p_context (SHOULD BE SAVED)
    'INIT'                                          -- p_adjustment_reason
);

-- Step 6: Verify the record was created with ping_ms and context
SELECT 
    player_name,
    timing_value,
    timing_type,
    ping_ms,           -- Should be 200
    context,           -- Should be 'SLOW'
    adjustment_reason, -- Should be 'INIT'
    is_defense,        -- Should be false
    created_at
FROM imprisonment_metrics
WHERE player_name = 'TestFunctionSetup'
ORDER BY created_at DESC
LIMIT 1;

-- Step 7: Clean up test data
DELETE FROM imprisonment_metrics WHERE player_name = 'TestFunctionSetup';

-- Step 8: Add comment
COMMENT ON FUNCTION record_imprisonment_metric IS 'Records imprisonment metrics (12 parameters, matches backend code, ping/context enabled)';

-- Success message
SELECT 
    '✅ Function setup complete!' as status,
    'Function has 12 parameters matching your backend code' as info,
    'ping_ms and context will be saved correctly' as note;
