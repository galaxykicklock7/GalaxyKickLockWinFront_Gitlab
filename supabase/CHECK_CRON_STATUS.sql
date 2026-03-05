-- =====================================================
-- CHECK CRON JOB STATUS
-- =====================================================
-- Run these queries in Supabase SQL Editor to verify
-- if the auto-cleanup job is running
-- =====================================================

-- 1. Check if pg_cron extension is enabled
SELECT * FROM pg_extension WHERE extname = 'pg_cron';
-- Expected: Should return 1 row if enabled
-- If empty: pg_cron is not enabled (may not be available on your plan)

-- 2. View all scheduled cron jobs
SELECT 
  jobid,
  schedule,
  command,
  nodename,
  nodeport,
  database,
  username,
  active,
  jobname
FROM cron.job
ORDER BY jobid;
-- Expected: Should show 'cleanup-imprisonment-metrics-hourly' job
-- Look for: schedule = '0 * * * *' (runs every hour)

-- 3. View recent job execution history (last 10 runs)
SELECT 
  jobid,
  runid,
  job_pid,
  database,
  username,
  command,
  status,
  return_message,
  start_time,
  end_time,
  (end_time - start_time) as duration
FROM cron.job_run_details
ORDER BY start_time DESC
LIMIT 10;
-- Expected: Should show recent executions with status 'succeeded'
-- If empty: Job hasn't run yet or pg_cron is not working
-- Check 'return_message' for any errors

-- 4. Check when the job last ran successfully
SELECT 
  j.jobname,
  j.schedule,
  j.active,
  MAX(jrd.start_time) as last_run,
  MAX(jrd.end_time) as last_completed,
  COUNT(CASE WHEN jrd.status = 'succeeded' THEN 1 END) as successful_runs,
  COUNT(CASE WHEN jrd.status = 'failed' THEN 1 END) as failed_runs
FROM cron.job j
LEFT JOIN cron.job_run_details jrd ON j.jobid = jrd.jobid
WHERE j.jobname = 'cleanup-imprisonment-metrics-hourly'
GROUP BY j.jobname, j.schedule, j.active;
-- Expected: Shows summary of job execution
-- last_run should be within the last hour if working

-- 5. Check current record count in imprisonment_metrics
SELECT 
  user_id,
  connection_number,
  COUNT(*) as total_records,
  MIN(created_at) as oldest_record,
  MAX(created_at) as newest_record
FROM public.imprisonment_metrics
GROUP BY user_id, connection_number
ORDER BY user_id, connection_number;
-- Expected: Each user/connection should have <= 1000 records if cleanup is working
-- If you see > 1000 records, cleanup may not be running

-- 6. Manually trigger the cleanup (for testing)
-- Uncomment and run this to test if the function works:
-- SELECT public.cleanup_old_imprisonment_metrics();
-- Expected: Should return success and show NOTICE messages about deleted records

-- =====================================================
-- TROUBLESHOOTING
-- =====================================================

-- If pg_cron is not available (common on free tier):
-- Option 1: Manually run cleanup periodically
-- SELECT public.cleanup_old_imprisonment_metrics();

-- Option 2: Check if you can enable pg_cron
-- Go to: Supabase Dashboard > Database > Extensions
-- Search for "pg_cron" and enable it

-- Option 3: Use backend cron job instead
-- Create a Node.js cron job that calls the cleanup function via Supabase client

-- =====================================================
-- EXPECTED RESULTS IF WORKING CORRECTLY
-- =====================================================
-- Query 1: 1 row (pg_cron enabled)
-- Query 2: 1 row with jobname 'cleanup-imprisonment-metrics-hourly'
-- Query 3: Multiple rows showing recent executions with status 'succeeded'
-- Query 4: last_run within last hour, successful_runs > 0
-- Query 5: Each user/connection has <= 1000 records
-- =====================================================
