-- Add missing adjustment_reason values: LEFT_EARLY and KICKED
-- Remove unused values: FAILURE, PRISON, STUCK_ESCAPE, INIT, DB_INIT
-- Final list: SUCCESS, 3S_ERROR, LEFT_EARLY, KICKED

-- Step 1: Drop the old constraint
ALTER TABLE imprisonment_metrics 
DROP CONSTRAINT IF EXISTS imprisonment_metrics_adjustment_reason_check;

-- Step 2: Add new constraint with ONLY the 4 values we use
ALTER TABLE imprisonment_metrics
ADD CONSTRAINT imprisonment_metrics_adjustment_reason_check 
CHECK (
    adjustment_reason IS NULL 
    OR adjustment_reason IN (
        'SUCCESS',       -- Bot kicked opponent successfully
        '3S_ERROR',      -- Bot tried to kick too early (within 3s rule)
        'LEFT_EARLY',    -- Opponent left before we could kick
        'KICKED'         -- Opponent kicked us first
    )
);

-- Verify the constraint was updated
SELECT 
    conname as constraint_name,
    pg_get_constraintdef(oid) as constraint_definition
FROM pg_constraint
WHERE conname = 'imprisonment_metrics_adjustment_reason_check';

-- Test inserting all 4 adjustment_reason values
DO $$
DECLARE
    test_user_id UUID := '00000000-0000-0000-0000-000000000000';
    test_reasons TEXT[] := ARRAY['SUCCESS', '3S_ERROR', 'LEFT_EARLY', 'KICKED'];
    reason TEXT;
BEGIN
    RAISE NOTICE 'Testing all 4 adjustment_reason values...';
    
    FOREACH reason IN ARRAY test_reasons
    LOOP
        BEGIN
            INSERT INTO imprisonment_metrics (
                user_id,
                connection_number,
                timestamp_ms,
                player_name,
                code_used,
                is_clan_member,
                is_success,
                adjustment_reason
            ) VALUES (
                test_user_id,
                1,
                1000,
                'Test_' || reason,
                'primary',
                false,
                CASE WHEN reason = 'SUCCESS' THEN true ELSE false END,
                reason
            );
            RAISE NOTICE '✅ % - OK', reason;
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE '❌ % - FAILED: %', reason, SQLERRM;
        END;
    END LOOP;
    
    -- Clean up test data
    DELETE FROM imprisonment_metrics WHERE player_name LIKE 'Test_%';
    RAISE NOTICE 'Test data cleaned up';
END $$;

-- Show current valid values
SELECT 
    'Valid adjustment_reason values (4 only):' as info,
    UNNEST(ARRAY[
        'SUCCESS',
        '3S_ERROR',
        'LEFT_EARLY',
        'KICKED'
    ]) as valid_values;
