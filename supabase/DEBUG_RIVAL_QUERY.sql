-- Debug query to check why function returns no records

-- 1. Check if records exist for the rival
SELECT 
    player_name,
    COUNT(*) as record_count,
    COUNT(CASE WHEN adjustment_reason IS NOT NULL THEN 1 END) as records_with_reason,
    COUNT(CASE WHEN adjustment_reason IS NULL THEN 1 END) as records_without_reason,
    array_agg(DISTINCT adjustment_reason) as unique_reasons,
    array_agg(DISTINCT is_defense) as defense_values
FROM imprisonment_metrics
WHERE player_name = '[L][E][0]'
GROUP BY player_name;

-- 2. Check sample records
SELECT 
    player_name,
    timing_value,
    adjustment_reason,
    is_defense,
    created_at
FROM imprisonment_metrics
WHERE player_name = '[L][E][0]'
ORDER BY created_at DESC
LIMIT 10;

-- 3. Check if is_defense column exists and has correct values
SELECT 
    column_name,
    data_type,
    is_nullable
FROM information_schema.columns
WHERE table_name = 'imprisonment_metrics'
  AND column_name IN ('player_name', 'adjustment_reason', 'is_defense', 'timing_value');

-- 4. Test the WHERE clause directly
SELECT COUNT(*) as matching_records
FROM imprisonment_metrics
WHERE player_name = '[L][E][0]'
  AND is_defense = false;

-- 5. Check for NULL is_defense values
SELECT 
    COUNT(*) as total_records,
    COUNT(CASE WHEN is_defense IS NULL THEN 1 END) as null_is_defense,
    COUNT(CASE WHEN is_defense = true THEN 1 END) as defense_true,
    COUNT(CASE WHEN is_defense = false THEN 1 END) as defense_false
FROM imprisonment_metrics
WHERE player_name = '[L][E][0]';
