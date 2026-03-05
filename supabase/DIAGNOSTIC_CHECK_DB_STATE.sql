-- ============================================
-- DIAGNOSTIC: Check Database State
-- Run this to identify version conflicts and issues
-- ============================================

-- 1. CHECK TABLE STRUCTURE
SELECT '=== TABLE STRUCTURE ===' as check_type;
SELECT 
    column_name,
    data_type,
    character_maximum_length,
    is_nullable,
    column_default
FROM information_schema.columns 
WHERE table_name = 'imprisonment_metrics'
ORDER BY ordinal_position;

-- 2. CHECK CONSTRAINTS
SELECT '=== CONSTRAINTS ===' as check_type;
SELECT 
    constraint_name,
    constraint_type
FROM information_schema.table_constraints
WHERE table_name = 'imprisonment_metrics';

-- 3. CHECK SPECIFIC CONSTRAINT DEFINITIONS
SELECT '=== CONSTRAINT DEFINITIONS ===' as check_type;
SELECT 
    conname as constraint_name,
    pg_get_constraintdef(oid) as definition
FROM pg_constraint
WHERE conrelid = 'public.imprisonment_metrics'::regclass;

-- 4. CHECK INDEXES
SELECT '=== INDEXES ===' as check_type;
SELECT 
    indexname,
    indexdef
FROM pg_indexes
WHERE tablename = 'imprisonment_metrics'
ORDER BY indexname;

-- 5. CHECK IF adjustment_reason COLUMN EXISTS
SELECT '=== ADJUSTMENT_REASON COLUMN CHECK ===' as check_type;
SELECT 
    CASE 
        WHEN EXISTS (
            SELECT 1 
            FROM information_schema.columns 
            WHERE table_name = 'imprisonment_metrics' 
            AND column_name = 'adjustment_reason'
        ) THEN '✅ adjustment_reason column EXISTS'
        ELSE '❌ adjustment_reason column MISSING'
    END as status;

-- 6. CHECK FUNCTION SIGNATURE
SELECT '=== FUNCTION SIGNATURE ===' as check_type;
SELECT 
    p.proname as function_name,
    pg_get_function_arguments(p.oid) as arguments,
    pg_get_functiondef(p.oid) as full_definition
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public' 
AND p.proname = 'record_imprisonment_metric';

-- 7. CHECK RECENT DATA (Last 5 records)
SELECT '=== RECENT DATA (Last 5 records) ===' as check_type;
SELECT 
    id,
    user_id,
    connection_number,
    timing_value,
    timing_type,
    adjustment_reason,
    is_success,
    created_at
FROM imprisonment_metrics
ORDER BY created_at DESC
LIMIT 5;

-- 8. CHECK IF DATA IS BEING INSERTED
SELECT '=== DATA INSERTION CHECK ===' as check_type;
SELECT 
    COUNT(*) as total_records,
    COUNT(CASE WHEN adjustment_reason IS NOT NULL THEN 1 END) as records_with_reason,
    COUNT(CASE WHEN adjustment_reason IS NULL THEN 1 END) as records_without_reason,
    MAX(created_at) as last_insert_time,
    EXTRACT(EPOCH FROM (NOW() - MAX(created_at)))/60 as minutes_since_last_insert
FROM imprisonment_metrics;

-- 9. CHECK FUNCTION PARAMETER COUNT
SELECT '=== FUNCTION PARAMETER COUNT ===' as check_type;
SELECT 
    p.proname as function_name,
    p.pronargs as parameter_count,
    CASE 
        WHEN p.pronargs = 12 THEN '✅ Has 12 parameters (includes adjustment_reason)'
        WHEN p.pronargs = 11 THEN '⚠️ Has 11 parameters (OLD VERSION - missing adjustment_reason)'
        ELSE '❌ Unexpected parameter count: ' || p.pronargs
    END as status
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public' 
AND p.proname = 'record_imprisonment_metric';

-- 10. CHECK FOR MULTIPLE FUNCTION VERSIONS
SELECT '=== MULTIPLE FUNCTION VERSIONS CHECK ===' as check_type;
SELECT 
    p.oid,
    p.proname as function_name,
    p.pronargs as param_count,
    pg_get_function_arguments(p.oid) as arguments
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public' 
AND p.proname = 'record_imprisonment_metric';

-- 11. TEST INSERT (Will show if function accepts adjustment_reason)
SELECT '=== TEST INSERT ===' as check_type;
SELECT public.record_imprisonment_metric(
    '00000000-0000-0000-0000-000000000000'::UUID,  -- p_user_id
    1,                                               -- p_connection_number
    9999,                                            -- p_timestamp_ms (unique for test)
    'DIAGNOSTIC_TEST',                               -- p_player_name
    'primary',                                       -- p_code_used
    FALSE,                                           -- p_is_clan_member
    TRUE,                                            -- p_is_success
    1922,                                            -- p_timing_value
    'attack',                                        -- p_timing_type
    175,                                             -- p_ping_ms
    'NORMAL',                                        -- p_context
    'INIT'                                           -- p_adjustment_reason (NEW)
) as test_result;

-- 12. VERIFY TEST INSERT
SELECT '=== VERIFY TEST INSERT ===' as check_type;
SELECT 
    id,
    player_name,
    timing_value,
    adjustment_reason,
    created_at
FROM imprisonment_metrics
WHERE player_name = 'DIAGNOSTIC_TEST'
ORDER BY created_at DESC
LIMIT 1;

-- 13. CLEANUP TEST DATA
DELETE FROM imprisonment_metrics WHERE player_name = 'DIAGNOSTIC_TEST';
SELECT '=== TEST DATA CLEANED UP ===' as check_type;

-- ============================================
-- SUMMARY
-- ============================================
SELECT '=== DIAGNOSTIC SUMMARY ===' as check_type;
SELECT 
    CASE 
        WHEN EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'imprisonment_metrics' 
            AND column_name = 'adjustment_reason'
        ) THEN '✅'
        ELSE '❌'
    END || ' adjustment_reason column' as check_1,
    
    CASE 
        WHEN EXISTS (
            SELECT 1 FROM pg_proc p
            JOIN pg_namespace n ON p.pronamespace = n.oid
            WHERE n.nspname = 'public' 
            AND p.proname = 'record_imprisonment_metric'
            AND p.pronargs = 12
        ) THEN '✅'
        ELSE '❌'
    END || ' Function has 12 parameters' as check_2,
    
    CASE 
        WHEN (SELECT COUNT(*) FROM pg_proc p
              JOIN pg_namespace n ON p.pronamespace = n.oid
              WHERE n.nspname = 'public' 
              AND p.proname = 'record_imprisonment_metric') > 1
        THEN '⚠️ MULTIPLE FUNCTION VERSIONS DETECTED!'
        ELSE '✅ Single function version'
    END as check_3;
