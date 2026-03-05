-- Remove timing_offset feature and revert to original FAST/NORMAL/SLOW system

-- Step 1: Update the record function to NOT calculate timing_offset
CREATE OR REPLACE FUNCTION record_imprisonment_metric(
    p_user_id UUID,
    p_connection_number INTEGER,
    p_timestamp_ms BIGINT,
    p_player_name TEXT,
    p_code_used TEXT,
    p_is_clan_member BOOLEAN,
    p_is_success BOOLEAN DEFAULT true,
    p_timing_value INTEGER DEFAULT NULL,
    p_timing_type TEXT DEFAULT NULL,
    p_ping_ms INTEGER DEFAULT NULL,
    p_context TEXT DEFAULT NULL,
    p_adjustment_reason TEXT DEFAULT NULL,
    p_is_defense BOOLEAN DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
    -- Insert without timing_offset calculation
    INSERT INTO imprisonment_metrics (
        user_id,
        connection_number,
        timestamp_ms,
        player_name,
        code_used,
        is_clan_member,
        is_success,
        timing_value,
        timing_type,
        ping_ms,
        context,
        adjustment_reason,
        is_defense
    ) VALUES (
        p_user_id,
        p_connection_number,
        p_timestamp_ms,
        p_player_name,
        p_code_used,
        p_is_clan_member,
        p_is_success,
        p_timing_value,
        p_timing_type,
        p_ping_ms,
        p_context,
        p_adjustment_reason,
        p_is_defense
    );
END;
$$;

-- Step 2: Drop the timing_offset column (optional - can keep for historical data)
-- Uncomment if you want to completely remove the column:
-- ALTER TABLE imprisonment_metrics DROP COLUMN IF EXISTS timing_offset;

-- Step 3: Drop the index on timing_offset (optional)
-- Uncomment if you dropped the column:
-- DROP INDEX IF EXISTS idx_timing_offset;

-- Verify the function
SELECT 
    p.proname as function_name,
    pg_get_function_arguments(p.oid) as parameters
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public' 
  AND p.proname = 'record_imprisonment_metric';

-- Test the function (should work without timing_offset)
SELECT record_imprisonment_metric(
    '00000000-0000-0000-0000-000000000000'::UUID,
    1,
    1000,
    'TestRemoveOffset',
    'primary',
    false,
    true,
    1800,
    'attack',
    200,
    'SLOW',
    'INIT',
    false
);

-- Verify record was created (timing_offset should be NULL for new records)
SELECT 
    player_name,
    timing_value,
    ping_ms,
    context,
    timing_offset,
    created_at
FROM imprisonment_metrics
WHERE player_name = 'TestRemoveOffset'
ORDER BY created_at DESC
LIMIT 1;

-- Clean up test data
DELETE FROM imprisonment_metrics WHERE player_name = 'TestRemoveOffset';

COMMENT ON FUNCTION record_imprisonment_metric IS 'Records imprisonment metrics using FAST/NORMAL/SLOW context system (timing_offset removed)';
