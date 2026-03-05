-- ============================================
-- QUICK CHECK: Run this first to see the issue
-- ============================================

-- 1. Does adjustment_reason column exist?
SELECT 
    CASE 
        WHEN EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'imprisonment_metrics' 
            AND column_name = 'adjustment_reason'
        ) THEN '✅ Column EXISTS'
        ELSE '❌ Column MISSING - Run ADD_ADJUSTMENT_REASON_COLUMN.sql'
    END as column_status;

-- 2. How many parameters does the function have?
SELECT 
    proname as function_name,
    pronargs as param_count,
    CASE 
        WHEN pronargs = 12 THEN '✅ CORRECT (has adjustment_reason)'
        WHEN pronargs = 11 THEN '❌ OLD VERSION (missing adjustment_reason) - Run UPDATE_RECORD_FUNCTION_WITH_ADJUSTMENT_REASON.sql'
        ELSE '⚠️ UNEXPECTED: ' || pronargs || ' parameters'
    END as function_status
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public' 
AND p.proname = 'record_imprisonment_metric';

-- 3. Are there multiple versions of the function?
SELECT 
    COUNT(*) as function_count,
    CASE 
        WHEN COUNT(*) > 1 THEN '⚠️ MULTIPLE VERSIONS - Need to drop old ones!'
        WHEN COUNT(*) = 1 THEN '✅ Single version'
        ELSE '❌ Function missing'
    END as version_status
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public' 
AND p.proname = 'record_imprisonment_metric';

-- 4. Recent data check
SELECT 
    COUNT(*) as total_records,
    COUNT(CASE WHEN adjustment_reason IS NOT NULL THEN 1 END) as with_reason,
    COUNT(CASE WHEN adjustment_reason IS NULL THEN 1 END) as without_reason,
    MAX(created_at) as last_insert,
    CASE 
        WHEN MAX(created_at) > NOW() - INTERVAL '5 minutes' THEN '✅ Recent data'
        WHEN MAX(created_at) > NOW() - INTERVAL '1 hour' THEN '⚠️ Data is old (>5 min)'
        ELSE '❌ No recent data (>1 hour)'
    END as data_status
FROM imprisonment_metrics;

-- 5. Show last 3 records
SELECT 
    id,
    TO_CHAR(created_at, 'HH24:MI:SS') as time,
    timing_value,
    adjustment_reason,
    CASE WHEN is_success THEN 'SUCCESS' ELSE '3S_ERROR' END as result
FROM imprisonment_metrics
ORDER BY created_at DESC
LIMIT 3;
