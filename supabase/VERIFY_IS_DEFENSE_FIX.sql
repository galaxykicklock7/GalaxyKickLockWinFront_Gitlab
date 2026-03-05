-- =====================================================
-- VERIFY IS_DEFENSE FIX
-- Check that defense metrics are being captured correctly
-- =====================================================

-- 1. Check function signature (should have 13 parameters including p_is_defense)
SELECT 
  proname as function_name,
  pg_get_function_arguments(oid) as arguments
FROM pg_proc 
WHERE proname = 'record_imprisonment_metric';

-- Expected output:
-- function_name: record_imprisonment_metric
-- arguments: p_user_id uuid, p_connection_number integer, p_timestamp_ms integer, 
--            p_player_name text, p_code_used text, p_is_clan_member boolean, 
--            p_is_success boolean DEFAULT true, p_timing_value integer DEFAULT NULL::integer, 
--            p_timing_type text DEFAULT NULL::text, p_ping_ms integer DEFAULT NULL::integer, 
--            p_context text DEFAULT NULL::text, p_adjustment_reason text DEFAULT NULL::text,
--            p_is_defense boolean DEFAULT false

-- =====================================================

-- 2. Check current metrics distribution
SELECT 
  is_defense,
  COUNT(*) as count,
  COUNT(*) * 100.0 / SUM(COUNT(*)) OVER () as percentage
FROM imprisonment_metrics
GROUP BY is_defense
ORDER BY is_defense;

-- Expected BEFORE fix:
-- is_defense | count | percentage
-- FALSE      | 1871  | 100.00%
-- TRUE       | 0     | 0.00%

-- Expected AFTER fix (after getting kicked):
-- is_defense | count | percentage
-- FALSE      | 1871+ | ~95-99%
-- TRUE       | 1+    | ~1-5%

-- =====================================================

-- 3. View recent defense metrics (should show data after fix)
SELECT 
  player_name,
  timing_value,
  timing_type,
  is_defense,
  is_success,
  adjustment_reason,
  context,
  ping_ms,
  created_at
FROM imprisonment_metrics
WHERE is_defense = TRUE
ORDER BY created_at DESC
LIMIT 10;

-- Expected output (after getting kicked):
-- player_name | timing_value | timing_type | is_defense | is_success | adjustment_reason | context | ping_ms | created_at
-- Unknown     | 1975         | defense     | TRUE       | FALSE      | KICKED            | NORMAL  | 85      | 2026-02-13 ...

-- =====================================================

-- 4. View recent attack metrics (should still work)
SELECT 
  player_name,
  timing_value,
  timing_type,
  is_defense,
  is_success,
  adjustment_reason,
  context,
  ping_ms,
  created_at
FROM imprisonment_metrics
WHERE is_defense = FALSE
ORDER BY created_at DESC
LIMIT 10;

-- Expected output (should continue working):
-- player_name | timing_value | timing_type | is_defense | is_success | adjustment_reason | context | ping_ms | created_at
-- RivalName   | 1975         | attack      | FALSE      | TRUE       | SUCCESS           | NORMAL  | 85      | 2026-02-13 ...

-- =====================================================

-- 5. Test SmartMLAgent safety validation query
-- This is what SmartMLAgent uses to check if a range is safe
SELECT 
  COUNT(*) as total_attempts,
  COUNT(*) FILTER (WHERE is_defense = TRUE) as kicked_count,
  ROUND(
    COUNT(*) FILTER (WHERE is_defense = TRUE)::NUMERIC / 
    NULLIF(COUNT(*), 0) * 100, 
    2
  ) as kick_rate_percentage
FROM imprisonment_metrics
WHERE 
  user_id = 'YOUR_USER_ID_HERE'  -- Replace with actual user ID
  AND context = 'NORMAL'  -- Replace with target context
  AND created_at > NOW() - INTERVAL '7 days';

-- Expected BEFORE fix:
-- total_attempts | kicked_count | kick_rate_percentage
-- 100            | 0            | 0.00%

-- Expected AFTER fix (after getting kicked):
-- total_attempts | kicked_count | kick_rate_percentage
-- 100            | 15           | 15.00%

-- =====================================================

-- 6. Check adjustment_reason distribution (should still work)
SELECT 
  adjustment_reason,
  is_defense,
  COUNT(*) as count
FROM imprisonment_metrics
WHERE adjustment_reason IS NOT NULL
GROUP BY adjustment_reason, is_defense
ORDER BY is_defense, count DESC;

-- Expected output:
-- adjustment_reason | is_defense | count
-- SUCCESS           | FALSE      | 1500
-- 3S_ERROR          | FALSE      | 200
-- FAILURE           | FALSE      | 100
-- KICKED            | TRUE       | 15  (NEW - after fix)

-- =====================================================

-- 7. Verify backward compatibility (old records still valid)
SELECT 
  COUNT(*) as old_records_count,
  MIN(created_at) as oldest_record,
  MAX(created_at) as newest_record
FROM imprisonment_metrics
WHERE is_defense = FALSE
  AND created_at < NOW() - INTERVAL '1 hour';  -- Records before fix

-- Expected output:
-- old_records_count | oldest_record | newest_record
-- 1871              | 2026-02-10... | 2026-02-13...

-- =====================================================

-- SUMMARY:
-- ✅ Function has p_is_defense parameter with DEFAULT FALSE
-- ✅ Old attack records remain valid (is_defense = FALSE)
-- ✅ New defense records captured (is_defense = TRUE)
-- ✅ SmartMLAgent can calculate kick rates
-- ✅ adjustment_reason still works
-- ✅ Backward compatible - no breaking changes
