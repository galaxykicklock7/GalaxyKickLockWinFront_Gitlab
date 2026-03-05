-- =====================================================
-- SIMPLE VERIFICATION - No User ID Needed
-- =====================================================

-- 1. Check function exists with correct signature
SELECT 
  proname as function_name,
  pg_get_function_arguments(oid) as arguments
FROM pg_proc 
WHERE proname = 'record_imprisonment_metric';

-- Expected: ONE row with 13 parameters including p_is_defense

-- =====================================================

-- 2. Check only ONE version exists
SELECT COUNT(*) as function_count
FROM pg_proc 
WHERE proname = 'record_imprisonment_metric';

-- Expected: 1

-- =====================================================

-- 3. Check table has is_defense column
SELECT 
  column_name,
  data_type,
  column_default,
  is_nullable
FROM information_schema.columns
WHERE table_name = 'imprisonment_metrics'
  AND column_name IN ('is_defense', 'adjustment_reason')
ORDER BY column_name;

-- Expected:
-- adjustment_reason | character varying | NULL | YES
-- is_defense        | boolean          | false | NO

-- =====================================================

-- 4. Check current metrics distribution
SELECT 
  is_defense,
  COUNT(*) as count
FROM imprisonment_metrics
GROUP BY is_defense
ORDER BY is_defense;

-- Expected BEFORE getting kicked:
-- is_defense | count
-- FALSE      | 1871+

-- Expected AFTER getting kicked:
-- is_defense | count
-- FALSE      | 1871+
-- TRUE       | 1+

-- =====================================================

-- 5. View recent metrics (any user)
SELECT 
  player_name,
  is_defense,
  is_success,
  adjustment_reason,
  timing_type,
  created_at
FROM imprisonment_metrics
ORDER BY created_at DESC
LIMIT 10;

-- Check that records exist and is_defense is being set

-- =====================================================

-- 6. Check if any defense metrics exist yet
SELECT COUNT(*) as defense_count
FROM imprisonment_metrics
WHERE is_defense = TRUE;

-- Expected: 0 (before getting kicked), 1+ (after getting kicked)

-- =====================================================
-- ✅ VERIFICATION COMPLETE
-- 
-- If you see:
-- - ONE function with 13 parameters
-- - Table has is_defense column
-- - Metrics exist with is_defense = FALSE
-- 
-- Then the fix is READY! 
-- 
-- Next step: Restart backend and test by getting kicked
-- =====================================================
