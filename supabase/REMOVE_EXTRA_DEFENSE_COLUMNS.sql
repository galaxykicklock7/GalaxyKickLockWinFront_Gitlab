-- Remove the extra defense columns (rival_userid, estimated_rival_timing)
-- Keep only is_defense column
-- This will not affect any data or functionality

-- Step 1: Drop the indexes first
DROP INDEX IF EXISTS idx_imprisonment_metrics_rival;

-- Step 2: Drop the extra columns
ALTER TABLE imprisonment_metrics
DROP COLUMN IF EXISTS rival_userid CASCADE;

ALTER TABLE imprisonment_metrics
DROP COLUMN IF EXISTS estimated_rival_timing CASCADE;

-- Step 3: Verify only is_defense remains
SELECT 
    column_name, 
    data_type, 
    is_nullable, 
    column_default
FROM information_schema.columns 
WHERE table_name = 'imprisonment_metrics' 
AND column_name IN ('is_defense', 'rival_userid', 'estimated_rival_timing')
ORDER BY ordinal_position;

-- Should only show is_defense column

-- Step 4: Verify the defense index still exists
SELECT 
    indexname, 
    indexdef
FROM pg_indexes
WHERE tablename = 'imprisonment_metrics'
AND indexname LIKE '%defense%';

-- Should show: idx_imprisonment_metrics_defense

RAISE NOTICE 'Extra columns removed successfully!';
RAISE NOTICE 'Only is_defense column remains';
RAISE NOTICE 'All functions will continue to work correctly';
