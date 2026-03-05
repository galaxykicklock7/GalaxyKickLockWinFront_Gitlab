-- Simple script to remove extra defense columns
-- Run this in Supabase SQL Editor

-- Step 1: Drop the index
DROP INDEX IF EXISTS idx_imprisonment_metrics_rival;

-- Step 2: Drop the extra columns
ALTER TABLE imprisonment_metrics DROP COLUMN IF EXISTS rival_userid CASCADE;
ALTER TABLE imprisonment_metrics DROP COLUMN IF EXISTS estimated_rival_timing CASCADE;

-- Step 3: Verify columns are gone
SELECT 
    column_name, 
    data_type
FROM information_schema.columns 
WHERE table_name = 'imprisonment_metrics' 
AND column_name IN ('is_defense', 'rival_userid', 'estimated_rival_timing');

-- Should only show is_defense (not the other two)
