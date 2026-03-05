-- Drop all versions of record_imprisonment_metric function using OID
-- This avoids the "function name not unique" error

-- Step 1: Find all versions and their OIDs
SELECT 
    p.oid,
    p.proname as function_name,
    pg_get_function_identity_arguments(p.oid) as arguments
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public' 
  AND p.proname = 'record_imprisonment_metric';

-- Step 2: Drop all versions by OID
-- Run this query first to get the OIDs, then manually drop each one
-- Or use the DO block below to drop all automatically

DO $$
DECLARE
    func_oid OID;
BEGIN
    -- Loop through all versions of the function and drop them
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

-- Step 3: Verify all versions are gone
SELECT 
    p.proname as function_name,
    pg_get_function_identity_arguments(p.oid) as arguments
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public' 
  AND p.proname = 'record_imprisonment_metric';
-- Should return 0 rows

-- Step 4: Create the correct version (13 parameters, no timing_offset calculation)
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
    p_adjustment_reason TEXT DEFAULT NULL,
    p_is_defense BOOLEAN DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
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
END;
$$;

-- Step 5: Verify only one version exists
SELECT 
    p.proname as function_name,
    pg_get_function_identity_arguments(p.oid) as arguments,
    pg_get_function_arguments(p.oid) as full_signature
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public' 
  AND p.proname = 'record_imprisonment_metric';
-- Should return exactly 1 row

-- Step 6: Test the function
SELECT record_imprisonment_metric(
    '00000000-0000-0000-0000-000000000000'::UUID,
    1,
    1000,
    'TestCleanFunction',
    'primary',
    false,
    true,
    1800,
    'attack',
    200,
    'SLOW',
    'INIT',
    false
);

-- Step 7: Verify the record
SELECT 
    player_name,
    timing_value,
    ping_ms,
    context,
    is_defense,
    created_at
FROM imprisonment_metrics
WHERE player_name = 'TestCleanFunction'
ORDER BY created_at DESC
LIMIT 1;

-- Step 8: Clean up
DELETE FROM imprisonment_metrics WHERE player_name = 'TestCleanFunction';

-- Success message
SELECT 'Function cleaned up successfully! Only one version exists now.' as status;
