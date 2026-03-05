-- Diagnostic queries to check why ping_ms and context are NULL

-- 1. Check the function signature to ensure it has all parameters
SELECT 
    p.proname as function_name,
    pg_get_function_arguments(p.oid) as parameters
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public' 
  AND p.proname = 'record_imprisonment_metric';

-- 2. Check recent records to see if ping_ms and context are being saved
SELECT 
    id,
    player_name,
    timing_value,
    timing_type,
    ping_ms,
    context,
    timing_offset,
    adjustment_reason,
    is_defense,
    created_at
FROM imprisonment_metrics
ORDER BY created_at DESC
LIMIT 10;

-- 3. Count records with NULL ping_ms vs non-NULL
SELECT 
    COUNT(*) FILTER (WHERE ping_ms IS NULL) as null_ping_count,
    COUNT(*) FILTER (WHERE ping_ms IS NOT NULL) as non_null_ping_count,
    COUNT(*) FILTER (WHERE context IS NULL) as null_context_count,
    COUNT(*) FILTER (WHERE context IS NOT NULL) as non_null_context_count,
    COUNT(*) as total_records
FROM imprisonment_metrics;

-- 4. Check if there are any records created in the last hour
SELECT 
    COUNT(*) as records_last_hour,
    COUNT(*) FILTER (WHERE ping_ms IS NOT NULL) as with_ping,
    COUNT(*) FILTER (WHERE context IS NOT NULL) as with_context
FROM imprisonment_metrics
WHERE created_at > NOW() - INTERVAL '1 hour';

-- 5. Test the function with all parameters to ensure it works
SELECT record_imprisonment_metric(
    '00000000-0000-0000-0000-000000000000'::UUID,  -- p_user_id
    1,                                              -- p_connection_number
    1000,                                           -- p_timestamp_ms
    'DiagnosticTest',                               -- p_player_name
    'primary',                                      -- p_code_used
    false,                                          -- p_is_clan_member
    true,                                           -- p_is_success
    1800,                                           -- p_timing_value
    'attack',                                       -- p_timing_type
    200,                                            -- p_ping_ms (SHOULD BE SAVED)
    'SLOW',                                         -- p_context (SHOULD BE SAVED)
    'INIT',                                         -- p_adjustment_reason
    false                                           -- p_is_defense
);

-- 6. Verify the test record was created with ping_ms and context
SELECT 
    player_name,
    timing_value,
    ping_ms,
    context,
    timing_offset,
    timing_value - (1700 + ping_ms) as expected_offset,
    created_at
FROM imprisonment_metrics
WHERE player_name = 'DiagnosticTest'
ORDER BY created_at DESC
LIMIT 1;

-- 7. Clean up test data
DELETE FROM imprisonment_metrics WHERE player_name = 'DiagnosticTest';

-- EXPECTED RESULTS:
-- Query 1: Should show function has 13 parameters including p_ping_ms, p_context, p_is_defense
-- Query 2: Should show recent records (check if ping_ms and context are NULL or have values)
-- Query 3: Shows distribution of NULL vs non-NULL values
-- Query 4: Shows if any recent records have ping/context
-- Query 5: Creates test record with ping=200, context=SLOW
-- Query 6: Should show ping_ms=200, context=SLOW, timing_offset=100 (1800 - 1700 - 200)
-- Query 7: Cleans up test data
