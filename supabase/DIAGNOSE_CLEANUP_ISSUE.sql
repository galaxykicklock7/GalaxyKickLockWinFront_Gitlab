-- =====================================================
-- DIAGNOSE CLEANUP ISSUE
-- =====================================================
-- Run these queries to see what's being deleted
-- =====================================================

-- 1. Show current data with row numbers (what the function sees)
WITH ranked_metrics AS (
  SELECT 
    id,
    user_id,
    connection_number,
    created_at,
    ping_ms,
    is_success,
    ROW_NUMBER() OVER (
      PARTITION BY user_id, connection_number 
      ORDER BY created_at DESC  -- Newest first
    ) as row_num
  FROM public.imprisonment_metrics
)
SELECT 
  user_id,
  connection_number,
  row_num,
  created_at,
  ping_ms,
  is_success,
  CASE 
    WHEN row_num <= 1000 THEN 'KEEP'
    ELSE 'DELETE'
  END as action
FROM ranked_metrics
ORDER BY user_id, connection_number, row_num
LIMIT 50;

-- Expected: 
-- - row_num 1 should be the NEWEST record (most recent created_at)
-- - row_num 1-1000 should be marked 'KEEP'
-- - row_num > 1000 should be marked 'DELETE' (oldest records)

-- 2. Show what WOULD be deleted (summary)
WITH ranked_metrics AS (
  SELECT 
    id,
    user_id,
    connection_number,
    created_at,
    ROW_NUMBER() OVER (
      PARTITION BY user_id, connection_number 
      ORDER BY created_at DESC
    ) as row_num
  FROM public.imprisonment_metrics
)
SELECT 
  user_id,
  connection_number,
  COUNT(*) as total_records,
  COUNT(CASE WHEN row_num <= 1000 THEN 1 END) as records_to_keep,
  COUNT(CASE WHEN row_num > 1000 THEN 1 END) as records_to_delete,
  MIN(CASE WHEN row_num <= 1000 THEN created_at END) as oldest_kept,
  MAX(CASE WHEN row_num <= 1000 THEN created_at END) as newest_kept,
  MIN(CASE WHEN row_num > 1000 THEN created_at END) as oldest_deleted,
  MAX(CASE WHEN row_num > 1000 THEN created_at END) as newest_deleted
FROM ranked_metrics
GROUP BY user_id, connection_number
ORDER BY user_id, connection_number;

-- Expected:
-- - newest_kept should be MORE RECENT than newest_deleted
-- - If newest_deleted is MORE RECENT than oldest_kept, the logic is WRONG

-- 3. Show the actual records that would be deleted (first 20)
WITH ranked_metrics AS (
  SELECT 
    id,
    user_id,
    connection_number,
    created_at,
    ping_ms,
    is_success,
    ROW_NUMBER() OVER (
      PARTITION BY user_id, connection_number 
      ORDER BY created_at DESC
    ) as row_num
  FROM public.imprisonment_metrics
)
SELECT 
  user_id,
  connection_number,
  row_num,
  created_at,
  ping_ms,
  is_success
FROM ranked_metrics
WHERE row_num > 1000
ORDER BY user_id, connection_number, created_at DESC
LIMIT 20;

-- Expected: These should be OLD records (old created_at dates)
-- If these are RECENT records, the ORDER BY is wrong

-- =====================================================
-- IF THE ISSUE IS CONFIRMED
-- =====================================================
-- If query #3 shows RECENT records being deleted, then we need to:
-- 1. Check if created_at column has correct data type (timestamp)
-- 2. Check if created_at has correct values (not NULL, not future dates)
-- 3. Possibly the ORDER BY needs to be ASC instead of DESC

-- Run this to check created_at column:
SELECT 
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_name = 'imprisonment_metrics'
  AND column_name = 'created_at';

-- Expected: data_type should be 'timestamp with time zone' or similar

-- =====================================================
