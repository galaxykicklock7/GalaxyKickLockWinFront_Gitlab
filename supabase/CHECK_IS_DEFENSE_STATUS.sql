-- =====================================================
-- CHECK is_defense STATUS
-- Verify if defense metrics are being captured
-- =====================================================

-- Query 1: Count records by is_defense
SELECT 
    is_defense,
    COUNT(*) as count,
    ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 2) as percentage
FROM imprisonment_metrics
GROUP BY is_defense
ORDER BY is_defense;

-- Expected Result:
-- is_defense | count | percentage
-- FALSE      | 6900  | 95.00
-- TRUE       | 50    | 5.00
-- (If TRUE count is 0, defense metrics are NOT being captured)

-- Query 2: Show recent defense records (if any)
SELECT 
    id,
    created_at,
    timing_value,
    is_success,
    is_defense,
    adjustment_reason,
    player_name,
    context
FROM imprisonment_metrics
WHERE is_defense = TRUE
ORDER BY created_at DESC
LIMIT 10;

-- Expected: Should show records where you got kicked
-- If empty, defense metrics are NOT being captured

-- Query 3: Show recent attack records
SELECT 
    id,
    created_at,
    timing_value,
    is_success,
    is_defense,
    adjustment_reason,
    player_name,
    context
FROM imprisonment_metrics
WHERE is_defense = FALSE
ORDER BY created_at DESC
LIMIT 10;

-- Expected: Should show records where you kicked opponents

-- Query 4: Check if defense endpoint is working
-- Look for records with timing_type = 'defense'
SELECT 
    COUNT(*) as defense_type_count
FROM imprisonment_metrics
WHERE timing_type = 'defense';

-- Expected: Should match is_defense = TRUE count

-- Query 5: Detailed analysis
SELECT 
    'Attack Records' as type,
    COUNT(*) as total,
    SUM(CASE WHEN is_success THEN 1 ELSE 0 END) as successes,
    SUM(CASE WHEN NOT is_success THEN 1 ELSE 0 END) as failures,
    ROUND(AVG(CASE WHEN is_success THEN 1 ELSE 0 END) * 100, 2) as success_rate
FROM imprisonment_metrics
WHERE is_defense = FALSE

UNION ALL

SELECT 
    'Defense Records' as type,
    COUNT(*) as total,
    SUM(CASE WHEN is_success THEN 1 ELSE 0 END) as successes,
    SUM(CASE WHEN NOT is_success THEN 1 ELSE 0 END) as failures,
    ROUND(AVG(CASE WHEN is_success THEN 1 ELSE 0 END) * 100, 2) as success_rate
FROM imprisonment_metrics
WHERE is_defense = TRUE;

-- Expected Result:
-- type            | total | successes | failures | success_rate
-- Attack Records  | 6900  | 6500      | 400      | 94.20
-- Defense Records | 50    | 0         | 50       | 0.00
-- (Defense records should have is_success = FALSE because you got kicked)

-- Query 6: Check if column exists and has correct type
SELECT 
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_name = 'imprisonment_metrics'
  AND column_name = 'is_defense';

-- Expected:
-- column_name | data_type | is_nullable | column_default
-- is_defense  | boolean   | NO          | false

-- =====================================================
-- INTERPRETATION:
-- =====================================================
-- If Query 1 shows TRUE count = 0:
--   → Defense metrics are NOT being captured
--   → Need to implement the fix
--
-- If Query 1 shows TRUE count > 0:
--   → Defense metrics ARE being captured
--   → System is working correctly
--
-- If Query 2 is empty:
--   → No defense records found
--   → Either you never got kicked, OR defense recording is broken
--
-- If Query 4 shows count > 0:
--   → Defense endpoint is working
--   → Records are being saved with is_defense = TRUE
-- =====================================================
