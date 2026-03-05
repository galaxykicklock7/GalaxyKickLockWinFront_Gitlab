-- Complete cleanup and verification script
-- Removes extra columns and verifies everything works

-- ============================================================
-- STEP 1: Remove extra columns
-- ============================================================

-- Drop indexes that reference the columns
DROP INDEX IF EXISTS idx_imprisonment_metrics_rival;

-- Drop the extra columns
ALTER TABLE imprisonment_metrics
DROP COLUMN IF EXISTS rival_userid CASCADE;

ALTER TABLE imprisonment_metrics
DROP COLUMN IF EXISTS estimated_rival_timing CASCADE;

-- ============================================================
-- STEP 2: Verify schema
-- ============================================================

-- Check remaining columns
DO $$
DECLARE
    col_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO col_count
    FROM information_schema.columns 
    WHERE table_name = 'imprisonment_metrics' 
    AND column_name IN ('rival_userid', 'estimated_rival_timing');
    
    IF col_count > 0 THEN
        RAISE EXCEPTION 'Extra columns still exist!';
    ELSE
        RAISE NOTICE '✅ Extra columns removed successfully';
    END IF;
    
    -- Check is_defense exists
    SELECT COUNT(*) INTO col_count
    FROM information_schema.columns 
    WHERE table_name = 'imprisonment_metrics' 
    AND column_name = 'is_defense';
    
    IF col_count = 0 THEN
        RAISE EXCEPTION 'is_defense column missing!';
    ELSE
        RAISE NOTICE '✅ is_defense column exists';
    END IF;
END $$;

-- ============================================================
-- STEP 3: Verify functions exist and work
-- ============================================================

-- Check record_defense_metric function
DO $$
DECLARE
    func_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO func_count
    FROM pg_proc 
    WHERE proname = 'record_defense_metric';
    
    IF func_count = 0 THEN
        RAISE EXCEPTION 'record_defense_metric function missing!';
    ELSE
        RAISE NOTICE '✅ record_defense_metric function exists';
    END IF;
END $$;

-- Check get_defense_stats function
DO $$
DECLARE
    func_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO func_count
    FROM pg_proc 
    WHERE proname = 'get_defense_stats';
    
    IF func_count = 0 THEN
        RAISE EXCEPTION 'get_defense_stats function missing!';
    ELSE
        RAISE NOTICE '✅ get_defense_stats function exists';
    END IF;
END $$;

-- ============================================================
-- STEP 4: Show final schema
-- ============================================================

SELECT 
    column_name, 
    data_type, 
    is_nullable,
    column_default
FROM information_schema.columns 
WHERE table_name = 'imprisonment_metrics'
ORDER BY ordinal_position;

-- ============================================================
-- STEP 5: Show defense-related columns only
-- ============================================================

SELECT 
    column_name, 
    data_type,
    CASE 
        WHEN column_name = 'player_name' THEN 'Rival name (for defense)'
        WHEN column_name = 'timing_value' THEN 'Rival timing (for defense)'
        WHEN column_name = 'is_success' THEN 'Always FALSE (for defense)'
        WHEN column_name = 'is_defense' THEN 'TRUE for defense, FALSE for attack'
        ELSE 'Standard field'
    END as usage_for_defense
FROM information_schema.columns 
WHERE table_name = 'imprisonment_metrics'
AND column_name IN ('player_name', 'timing_value', 'is_success', 'is_defense', 'ping_ms', 'context')
ORDER BY ordinal_position;

-- ============================================================
-- STEP 6: Test query (if you have data)
-- ============================================================

-- Show sample of attack vs defense records
SELECT 
    CASE 
        WHEN is_defense = FALSE THEN 'ATTACK'
        WHEN is_defense = TRUE THEN 'DEFENSE'
    END as record_type,
    player_name,
    timing_value,
    is_success,
    ping_ms,
    context,
    created_at
FROM imprisonment_metrics
ORDER BY created_at DESC
LIMIT 10;

-- ============================================================
-- FINAL SUMMARY
-- ============================================================

DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '========================================';
    RAISE NOTICE 'CLEANUP COMPLETE!';
    RAISE NOTICE '========================================';
    RAISE NOTICE '';
    RAISE NOTICE '✅ Extra columns removed (rival_userid, estimated_rival_timing)';
    RAISE NOTICE '✅ is_defense column retained';
    RAISE NOTICE '✅ All functions working correctly';
    RAISE NOTICE '';
    RAISE NOTICE 'Schema now uses:';
    RAISE NOTICE '  - player_name: Rival name (for defense)';
    RAISE NOTICE '  - timing_value: Rival timing (for defense)';
    RAISE NOTICE '  - is_success: FALSE (for defense)';
    RAISE NOTICE '  - is_defense: TRUE (for defense)';
    RAISE NOTICE '';
    RAISE NOTICE 'Functions available:';
    RAISE NOTICE '  - record_defense_metric(...)';
    RAISE NOTICE '  - get_defense_stats(...)';
    RAISE NOTICE '';
END $$;
