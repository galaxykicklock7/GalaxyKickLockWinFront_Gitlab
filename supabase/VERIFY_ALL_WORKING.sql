-- Verify all imprisonment metrics are being recorded correctly
-- Check recent records to see if SUCCESS, 3S_ERROR, LEFT_EARLY, KICKED are present

-- 1. Check recent records (last 20)
SELECT 
    player_name,
    is_success,
    adjustment_reason,
    timing_value,
    timing_type,
    ping_ms,
    context,
    is_defense,
    TO_CHAR(created_at, 'YYYY-MM-DD HH24:MI:SS') as created_at
FROM imprisonment_metrics
ORDER BY created_at DESC
LIMIT 20;

-- 2. Count by result type
SELECT 
    CASE 
        WHEN is_success = true THEN 'SUCCESS'
        WHEN adjustment_reason = '3S_ERROR' THEN '3S_ERROR'
        WHEN adjustment_reason = 'LEFT_EARLY' THEN 'LEFT_EARLY'
        WHEN adjustment_reason = 'KICKED' THEN 'KICKED'
        ELSE 'OTHER'
    END as result_type,
    COUNT(*) as count,
    MAX(created_at) as last_occurrence
FROM imprisonment_metrics
WHERE created_at > NOW() - INTERVAL '1 hour'
GROUP BY result_type
ORDER BY count DESC;

-- 3. Check if all required columns exist and have data
SELECT 
    COUNT(*) as total_records,
    COUNT(CASE WHEN adjustment_reason IS NOT NULL THEN 1 END) as with_adjustment_reason,
    COUNT(CASE WHEN ping_ms IS NOT NULL THEN 1 END) as with_ping,
    COUNT(CASE WHEN context IS NOT NULL THEN 1 END) as with_context,
    COUNT(CASE WHEN is_defense = true THEN 1 END) as defense_records,
    COUNT(CASE WHEN is_success = true THEN 1 END) as success_records,
    COUNT(CASE WHEN is_success = false THEN 1 END) as failure_records
FROM imprisonment_metrics
WHERE created_at > NOW() - INTERVAL '1 hour';

-- 4. Show distribution of adjustment reasons
SELECT 
    adjustment_reason,
    is_defense,
    COUNT(*) as count
FROM imprisonment_metrics
WHERE created_at > NOW() - INTERVAL '1 hour'
  AND adjustment_reason IS NOT NULL
GROUP BY adjustment_reason, is_defense
ORDER BY is_defense, count DESC;
