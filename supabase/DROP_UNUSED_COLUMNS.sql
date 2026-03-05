-- Drop unused columns from imprisonment_metrics table
-- WARNING: This will permanently delete timing_offset data!
-- Make sure you have a backup before running this.

-- Step 1: Check if columns exist and show sample data
SELECT 
    COUNT(*) as total_records,
    COUNT(timing_offset) FILTER (WHERE timing_offset IS NOT NULL) as records_with_offset
FROM imprisonment_metrics;

-- Step 2: Drop the timing_offset column
ALTER TABLE imprisonment_metrics 
DROP COLUMN IF EXISTS timing_offset;

-- Step 3: Drop the index on timing_offset (if it exists)
DROP INDEX IF EXISTS idx_timing_offset;

-- Step 4: Verify columns are gone
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' 
  AND table_name = 'imprisonment_metrics'
ORDER BY ordinal_position;

-- Step 5: Show remaining columns
SELECT 
    'Columns remaining in imprisonment_metrics:' as info,
    string_agg(column_name, ', ' ORDER BY ordinal_position) as columns
FROM information_schema.columns
WHERE table_schema = 'public' 
  AND table_name = 'imprisonment_metrics';

-- Success message
SELECT '✅ Unused columns dropped successfully!' as status;
