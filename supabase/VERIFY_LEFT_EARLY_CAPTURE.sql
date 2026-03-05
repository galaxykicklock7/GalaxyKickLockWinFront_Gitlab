-- Comprehensive check for LEFT_EARLY capture

-- 1. Count all records by adjustment_reason
SELECT 
    COALESCE(adjustment_reason, 'NULL') as reason,
    COUNT(*) as count,
    ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 2) as percentage
FROM imprisonment_metrics
GROUP BY adjustment_reason
ORDER BY count DESC;

-- 2. Check for records that might be LEFT_EARLY but not labeled
-- (is_success = false, is_defense = false, adjustment_reason might be NULL or something else)
SELECT 
    adjustment_reason,
    is_success,
    is_defense,
    COUNT(*) as count
FROM imprisonment_metrics
WHERE is_success = false 
  AND is_defense = false
GROUP BY adjustment_reason, is_success, is_defense
ORDER BY count DESC;

-- 3. Show sample of records with NULL adjustment_reason
SELECT 
    player_name,
    timestamp_ms,
    timing_value,
    is_success,
    is_defense,
    adjustment_reason,
    created_at
FROM imprisonment_metrics
WHERE adjustment_reason IS NULL
ORDER BY created_at DESC
LIMIT 5;

-- 4. Check if there are any LEFT_EARLY records at all
SELECT COUNT(*) as left_early_count
FROM imprisonment_metrics
WHERE adjustment_reason = 'LEFT_EARLY';

-- 5. Show most recent records to see what's being captured
SELECT 
    player_name,
    timestamp_ms,
    timing_value,
    timing_type,
    is_success,
    is_defense,
    adjustment_reason,
    created_at
FROM imprisonment_metrics
ORDER BY created_at DESC
LIMIT 20;
