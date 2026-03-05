-- Fix duplicate record_imprisonment_metric functions
-- Drop all versions and create the correct one

-- Step 1: List all versions of the function
SELECT 
    p.proname as function_name,
    pg_get_function_identity_arguments(p.oid) as arguments,
    p.oid
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public' 
  AND p.proname = 'record_imprisonment_metric';

-- Step 2: Drop ALL versions of the function
-- This will remove all overloaded versions
DROP FUNCTION IF EXISTS record_imprisonment_metric(UUID, INTEGER, BIGINT, TEXT, TEXT, BOOLEAN, BOOLEAN, INTEGER, TEXT, INTEGER, TEXT, TEXT, BOOLEAN);
DROP FUNCTION IF EXISTS record_imprisonment_metric(UUID, INTEGER, BIGINT, TEXT, TEXT, BOOLEAN, BOOLEAN, INTEGER, TEXT, INTEGER, TEXT, TEXT);
DROP FUNCTION IF EXISTS record_imprisonment_metric(UUID, INTEGER, BIGINT, TEXT, TEXT, BOOLEAN, BOOLEAN, INTEGER, TEXT, INTEGER, TEXT);
DROP FUNCTION IF EXISTS record_imprisonment_metric(UUID, INTEGER, BIGINT, TEXT, TEXT, BOOLEAN, BOOLEAN, INTEGER, TEXT);
DROP FUNCTION IF EXISTS record_imprisonment_metric(UUID, INTEGER, BIGINT, TEXT, TEXT, BOOLEAN);

-- Step 3: Create the correct version (13 parameters, no timing_offset calculation)
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
BEGIN
    -- Insert without timing_offset calculation
    -- timing_offset column will be NULL for new records
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

-- Step 4: Verify only one version exists now
SELECT 
    p.proname as function_name,
    pg_get_function_identity_arguments(p.oid) as arguments,
    pg_get_function_arguments(p.oid) as full_signature
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public' 
  AND p.proname = 'record_imprisonment_metric';

-- Step 5: Test the function
SELECT record_imprisonment_metric(
    '00000000-0000-0000-0000-000000000000'::UUID,
    1,
    1000,
    'TestFunctionFix',
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

-- Step 6: Verify the record was created correctly
SELECT 
    player_name,
    timing_value,
    ping_ms,
    context,
    timing_offset,
    is_defense,
    created_at
FROM imprisonment_metrics
WHERE player_name = 'TestFunctionFix'
ORDER BY created_at DESC
LIMIT 1;

-- Step 7: Clean up test data
DELETE FROM imprisonment_metrics WHERE player_name = 'TestFunctionFix';

COMMENT ON FUNCTION record_imprisonment_metric IS 'Records imprisonment metrics with FAST/NORMAL/SLOW context system (13 parameters, timing_offset not calculated)';
