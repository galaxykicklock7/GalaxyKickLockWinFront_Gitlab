-- =====================================================
-- DIAGNOSE IS_DEFENSE ISSUE
-- Check why is_defense is not being set correctly
-- =====================================================

-- Step 1: Check if function exists with is_defense parameter
SELECT 
  proname as function_name,
  pg_get_function_arguments(oid) as arguments,
  pronargs as num_arguments
FROM pg_proc 
WHERE proname = 'record_imprisonment_metric';

-- Expected: Should show 13 arguments with p_is_defense at the end

-- Step 2: Check recent records in database
SELECT 
  id,
  player_name,
  is_success,
  is_defense,
  adjustment_reason,
  timing_value,
  timing_type,
  created_at
FROM imprisonment_metrics
ORDER BY created_at DESC
LIMIT 10;

-- Step 3: Test the function directly with is_defense = TRUE
SELECT public.record_imprisonment_metric(
  'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'::UUID,  -- dummy user_id
  1,                                               -- connection_number
  1000,                                            -- timestamp_ms
  'TestDefense',                                   -- player_name
  'primary',                                       -- code_used
  false,                                           -- is_clan_member
  false,                                           -- is_success (got kicked)
  2100,                                            -- timing_value
  'defense',                                       -- timing_type
  85,                                              -- ping_ms
  'NORMAL',                                        -- context
  'KICKED',                                        -- adjustment_reason
  true                                             -- is_defense = TRUE
);

-- Step 4: Check if the test record was inserted correctly
SELECT 
  player_name,
  is_success,
  is_defense,
  adjustment_reason,
  timing_value
FROM imprisonment_metrics
WHERE player_name = 'TestDefense'
ORDER BY created_at DESC
LIMIT 1;

-- Expected: is_defense should be TRUE

-- Step 5: Check if there are any triggers or policies blocking updates
SELECT 
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual
FROM pg_policies
WHERE tablename = 'imprisonment_metrics';

-- Step 6: Check table structure
SELECT 
  column_name,
  data_type,
  column_default,
  is_nullable
FROM information_schema.columns
WHERE table_name = 'imprisonment_metrics'
  AND column_name IN ('is_success', 'is_defense', 'adjustment_reason')
ORDER BY ordinal_position;

-- =====================================================
-- TROUBLESHOOTING GUIDE
-- =====================================================

-- If function shows 12 arguments (not 13):
--   → Function not updated correctly
--   → Re-run FIX_IS_DEFENSE_DROP_ALL.sql

-- If test record shows is_defense = FALSE:
--   → Function parameter not being passed correctly
--   → Check function definition

-- If test record shows is_defense = TRUE:
--   → Function is correct
--   → Backend needs restart
--   → Check backend logs for errors

-- If no test record inserted:
--   → Function has an error
--   → Check function definition for syntax errors

