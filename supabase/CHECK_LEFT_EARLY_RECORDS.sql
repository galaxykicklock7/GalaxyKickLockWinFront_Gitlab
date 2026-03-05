-- Check if LEFT_EARLY records are being captured in the database

-- 1. Check for LEFT_EARLY in adjustment_reason column
SELECT 
    COUNT(*) as total_left_early,
    COUNT(*) * 100.0 / (SELECT COUNT(*) FROM imprisonment_metrics) as percentage
FROM imprisonment_metrics
WHERE adjustment_reason = 'LEFT_EARLY';

-- 2. Show recent LEFT_EARLY records
SELECT 
    player_name,
    timestamp_ms,
    timing_value,
    timing_type,
    adjustment_reason,
    is_success,
    is_defense,
    created_at
FROM imprisonment_metrics
WHERE adjustment_reason = 'LEFT_EARLY'
ORDER BY created_at DESC
LIMIT 10;

-- 3. Check all distinct adjustment_reason values
SELECT 
    adjustment_reason,
    COUNT(*) as count,
    COUNT(*) * 100.0 / (SELECT COUNT(*) FROM imprisonment_metrics) as percentage
FROM imprisonment_metrics
GROUP BY adjustment_reason
ORDER BY count DESC;

-- 4. Check if adjustment_reason column exists and its type
SELECT 
    column_name,
    data_type,
    is_nullable
FROM information_schema.columns
WHERE table_name = 'imprisonment_metrics'
  AND column_name = 'adjustment_reason';

-- 5. Check recent records with NULL adjustment_reason (might be LEFT_EARLY not captured)
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
  AND is_success = false
  AND is_defense = false
ORDER BY created_at DESC
LIMIT 10;
