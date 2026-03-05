-- Step-by-step debugging

-- Step 1: Check if records exist with the exact name
SELECT COUNT(*) as total_records
FROM imprisonment_metrics
WHERE player_name = '[L][E][0]';

-- Step 2: Check after adding is_defense filter
SELECT COUNT(*) as records_with_defense_false
FROM imprisonment_metrics
WHERE player_name = '[L][E][0]'
  AND COALESCE(is_defense, false) = false;

-- Step 3: Check if adjustment_reason has values
SELECT 
    adjustment_reason,
    COUNT(*) as count
FROM imprisonment_metrics
WHERE player_name = '[L][E][0]'
  AND COALESCE(is_defense, false) = false
GROUP BY adjustment_reason;

-- Step 4: Test the CTE directly
WITH recent_records AS (
    SELECT 
        timing_value,
        adjustment_reason,
        created_at,
        CASE 
            WHEN timing_value < 1875 THEN 'SLOW'
            WHEN timing_value < 1975 THEN 'NORMAL'
            ELSE 'FAST'
        END as zone
    FROM imprisonment_metrics
    WHERE player_name = '[L][E][0]'
      AND COALESCE(is_defense, false) = false
    ORDER BY created_at DESC
)
SELECT COUNT(*) as cte_record_count
FROM recent_records;

-- Step 5: Test weighted calculation
WITH recent_records AS (
    SELECT 
        timing_value,
        adjustment_reason,
        created_at,
        CASE 
            WHEN timing_value < 1875 THEN 'SLOW'
            WHEN timing_value < 1975 THEN 'NORMAL'
            ELSE 'FAST'
        END as zone
    FROM imprisonment_metrics
    WHERE player_name = '[L][E][0]'
      AND COALESCE(is_defense, false) = false
),
weighted_calculation AS (
    SELECT
        COUNT(*) as total_count,
        SUM(CASE WHEN adjustment_reason = 'SUCCESS' THEN 2.0 ELSE 0 END) as success_weight,
        SUM(CASE WHEN adjustment_reason = 'KICKED' THEN 4.0 ELSE 0 END) as kicked_weight,
        SUM(CASE WHEN adjustment_reason = '3S_ERROR' THEN 1.0 ELSE 0 END) as error_weight,
        SUM(CASE WHEN adjustment_reason = 'LEFT_EARLY' THEN 3.0 ELSE 0 END) as left_early_weight
    FROM recent_records
)
SELECT 
    total_count,
    success_weight,
    kicked_weight,
    error_weight,
    left_early_weight,
    (success_weight + kicked_weight + error_weight + left_early_weight) as total_weight
FROM weighted_calculation;
