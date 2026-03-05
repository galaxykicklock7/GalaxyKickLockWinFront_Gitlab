-- =====================================================
-- FIX CLEANUP FUNCTION - KEEP NEWEST, DELETE OLDEST
-- =====================================================
-- This fixes the cleanup function to keep the 1000 NEWEST records
-- and delete the OLDEST records (not the other way around)
-- =====================================================

-- Drop and recreate the function with correct logic
CREATE OR REPLACE FUNCTION public.cleanup_old_imprisonment_metrics()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_deleted_count INTEGER := 0;
  v_total_deleted INTEGER := 0;
  v_user_record RECORD;
BEGIN
  -- Loop through each user and connection combination
  FOR v_user_record IN 
    SELECT DISTINCT user_id, connection_number 
    FROM public.imprisonment_metrics
  LOOP
    -- Delete OLD records, keeping only the most recent 1000 per user per connection
    -- CRITICAL: ORDER BY created_at DESC keeps the NEWEST records
    WITH ranked_metrics AS (
      SELECT id,
             ROW_NUMBER() OVER (
               PARTITION BY user_id, connection_number 
               ORDER BY created_at DESC  -- DESC = newest first
             ) as row_num
      FROM public.imprisonment_metrics
      WHERE user_id = v_user_record.user_id
        AND connection_number = v_user_record.connection_number
    )
    DELETE FROM public.imprisonment_metrics
    WHERE id IN (
      SELECT id FROM ranked_metrics WHERE row_num > 1000  -- Delete rows beyond 1000
    );
    
    GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
    v_total_deleted := v_total_deleted + v_deleted_count;
    
    IF v_deleted_count > 0 THEN
      RAISE NOTICE 'Deleted % old metrics for user % connection %', 
        v_deleted_count, v_user_record.user_id, v_user_record.connection_number;
    END IF;
  END LOOP;
  
  RAISE NOTICE 'Cleanup completed - Total deleted: %', v_total_deleted;
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION public.cleanup_old_imprisonment_metrics() TO postgres;

-- =====================================================
-- TEST THE FIXED FUNCTION
-- =====================================================

-- 1. Check current record counts BEFORE cleanup
SELECT 
  user_id,
  connection_number,
  COUNT(*) as total_records,
  MIN(created_at) as oldest_record,
  MAX(created_at) as newest_record
FROM public.imprisonment_metrics
GROUP BY user_id, connection_number
ORDER BY user_id, connection_number;

-- 2. Run the cleanup manually to test
SELECT public.cleanup_old_imprisonment_metrics();

-- 3. Check record counts AFTER cleanup
SELECT 
  user_id,
  connection_number,
  COUNT(*) as total_records,
  MIN(created_at) as oldest_record,
  MAX(created_at) as newest_record
FROM public.imprisonment_metrics
GROUP BY user_id, connection_number
ORDER BY user_id, connection_number;

-- Expected result:
-- - Each user/connection should have <= 1000 records
-- - oldest_record should be MORE RECENT than before (old records deleted)
-- - newest_record should be THE SAME as before (new records kept)

-- =====================================================
-- VERIFY THE LOGIC IS CORRECT
-- =====================================================

-- This query shows what WOULD be deleted (without actually deleting)
-- Run this to verify it's targeting the OLD records, not new ones
WITH ranked_metrics AS (
  SELECT 
    id,
    user_id,
    connection_number,
    created_at,
    ROW_NUMBER() OVER (
      PARTITION BY user_id, connection_number 
      ORDER BY created_at DESC  -- DESC = newest first
    ) as row_num
  FROM public.imprisonment_metrics
)
SELECT 
  user_id,
  connection_number,
  COUNT(*) as records_to_delete,
  MIN(created_at) as oldest_to_delete,
  MAX(created_at) as newest_to_delete
FROM ranked_metrics
WHERE row_num > 1000  -- These would be deleted
GROUP BY user_id, connection_number
ORDER BY user_id, connection_number;

-- Expected: 
-- - oldest_to_delete should be OLD dates
-- - newest_to_delete should be OLDER than your current newest records
-- - If this shows RECENT dates, the logic is still wrong

-- =====================================================
-- ALTERNATIVE: DELETE BY AGE (SIMPLER)
-- =====================================================
-- If you prefer to delete records older than X days:

CREATE OR REPLACE FUNCTION public.cleanup_old_imprisonment_metrics_by_age()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_deleted_count INTEGER;
BEGIN
  -- Delete records older than 7 days
  DELETE FROM public.imprisonment_metrics
  WHERE created_at < NOW() - INTERVAL '7 days';
  
  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  
  RAISE NOTICE 'Deleted % old metrics (older than 7 days)', v_deleted_count;
END;
$$;

-- To use this version instead:
-- 1. Unschedule the old job:
-- SELECT cron.unschedule('cleanup-imprisonment-metrics-hourly');

-- 2. Schedule the new job:
-- SELECT cron.schedule(
--   'cleanup-imprisonment-metrics-by-age',
--   '0 * * * *',
--   $$SELECT public.cleanup_old_imprisonment_metrics_by_age()$$
-- );

-- =====================================================
-- NOTES
-- =====================================================
-- The key is: ORDER BY created_at DESC
-- - DESC = Descending = Newest first
-- - row_num 1-1000 = The 1000 newest records (KEEP these)
-- - row_num > 1000 = Older records (DELETE these)
-- =====================================================
