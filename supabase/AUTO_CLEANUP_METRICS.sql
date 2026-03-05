-- =====================================================
-- AUTO CLEANUP IMPRISONMENT METRICS EVERY 1 HOUR
-- =====================================================
-- This sets up automatic cleanup of old metrics data
-- Keeps only the most recent 1000 records per user per connection
-- Runs every hour using pg_cron
-- =====================================================

-- Step 1: Enable pg_cron extension (if not already enabled)
-- Note: This may require superuser privileges
-- If you get an error, you may need to enable it from Supabase dashboard
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Step 2: Create cleanup function
CREATE OR REPLACE FUNCTION public.cleanup_old_imprisonment_metrics()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_deleted_count INTEGER := 0;
  v_user_record RECORD;
BEGIN
  -- Loop through each user and connection combination
  FOR v_user_record IN 
    SELECT DISTINCT user_id, connection_number 
    FROM public.imprisonment_metrics
  LOOP
    -- Delete old records, keeping only the most recent 1000 per user per connection
    WITH ranked_metrics AS (
      SELECT id,
             ROW_NUMBER() OVER (
               PARTITION BY user_id, connection_number 
               ORDER BY created_at DESC
             ) as row_num
      FROM public.imprisonment_metrics
      WHERE user_id = v_user_record.user_id
        AND connection_number = v_user_record.connection_number
    )
    DELETE FROM public.imprisonment_metrics
    WHERE id IN (
      SELECT id FROM ranked_metrics WHERE row_num > 1000
    );
    
    GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
    
    IF v_deleted_count > 0 THEN
      RAISE NOTICE 'Deleted % old metrics for user % connection %', 
        v_deleted_count, v_user_record.user_id, v_user_record.connection_number;
    END IF;
  END LOOP;
  
  RAISE NOTICE 'Cleanup completed';
END;
$$;

-- Step 3: Schedule the cleanup to run every hour
-- This uses pg_cron to schedule the job
SELECT cron.schedule(
  'cleanup-imprisonment-metrics-hourly',  -- Job name
  '0 * * * *',                            -- Cron expression: every hour at minute 0
  $$SELECT public.cleanup_old_imprisonment_metrics()$$
);

-- Step 4: Grant permissions
GRANT EXECUTE ON FUNCTION public.cleanup_old_imprisonment_metrics() TO postgres;

-- =====================================================
-- VERIFICATION AND MANAGEMENT QUERIES
-- =====================================================

-- View scheduled jobs
-- SELECT * FROM cron.job;

-- View job run history
-- SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 10;

-- Manually run the cleanup (for testing)
-- SELECT public.cleanup_old_imprisonment_metrics();

-- Unschedule the job (if needed)
-- SELECT cron.unschedule('cleanup-imprisonment-metrics-hourly');

-- =====================================================
-- ALTERNATIVE: SIMPLER CLEANUP (DELETE OLD RECORDS)
-- =====================================================
-- If you prefer to delete records older than X days instead:

/*
CREATE OR REPLACE FUNCTION public.cleanup_old_imprisonment_metrics_by_age()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_deleted_count INTEGER;
BEGIN
  -- Delete records older than 30 days
  DELETE FROM public.imprisonment_metrics
  WHERE created_at < NOW() - INTERVAL '30 days';
  
  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  
  RAISE NOTICE 'Deleted % old metrics (older than 30 days)', v_deleted_count;
END;
$$;

-- Schedule this version instead
SELECT cron.schedule(
  'cleanup-imprisonment-metrics-by-age',
  '0 * * * *',
  $$SELECT public.cleanup_old_imprisonment_metrics_by_age()$$
);
*/

-- =====================================================
-- NOTES
-- =====================================================
-- 1. pg_cron may not be available on all Supabase plans
--    Check your plan: https://supabase.com/docs/guides/database/extensions/pg_cron
--
-- 2. If pg_cron is not available, you can:
--    - Run the cleanup function manually periodically
--    - Use a backend cron job to call the function via API
--    - Upgrade your Supabase plan
--
-- 3. The cleanup keeps the 1000 most recent records per user per connection
--    Adjust the number (1000) in the function if needed
--
-- 4. The job runs at minute 0 of every hour (00:00, 01:00, 02:00, etc.)
--    Adjust the cron expression if you want different timing:
--    - Every 30 minutes: '*/30 * * * *'
--    - Every 2 hours: '0 */2 * * *'
--    - Daily at 2 AM: '0 2 * * *'
-- =====================================================
