-- Check for duplicate tables and verify table structure

-- 1. Check if imprisonment_metrics table exists and how many versions
SELECT 
    schemaname,
    tablename,
    tableowner
FROM pg_tables
WHERE tablename LIKE '%imprisonment%'
ORDER BY schemaname, tablename;

-- 2. Check table structure - all columns
SELECT 
    column_name,
    data_type,
    character_maximum_length,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_name = 'imprisonment_metrics'
ORDER BY ordinal_position;

-- 3. Check all constraints on the table
SELECT 
    conname as constraint_name,
    contype as constraint_type,
    pg_get_constraintdef(oid) as constraint_definition
FROM pg_constraint
WHERE conrelid = 'imprisonment_metrics'::regclass
ORDER BY contype, conname;

-- 4. Check all indexes on the table
SELECT 
    indexname,
    indexdef
FROM pg_indexes
WHERE tablename = 'imprisonment_metrics'
ORDER BY indexname;

-- 5. Check if there are any duplicate records (same data inserted multiple times)
SELECT 
    user_id,
    connection_number,
    player_name,
    timestamp_ms,
    adjustment_reason,
    created_at,
    COUNT(*) as duplicate_count
FROM imprisonment_metrics
GROUP BY user_id, connection_number, player_name, timestamp_ms, adjustment_reason, created_at
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC
LIMIT 10;

-- 6. Show recent records to verify data is being stored correctly
SELECT 
    id,
    player_name,
    adjustment_reason,
    is_success,
    is_defense,
    timing_value,
    ping_ms,
    context,
    TO_CHAR(created_at, 'YYYY-MM-DD HH24:MI:SS') as created_at
FROM imprisonment_metrics
ORDER BY created_at DESC
LIMIT 10;

-- 7. Count total records
SELECT 
    COUNT(*) as total_records,
    COUNT(DISTINCT user_id) as unique_users,
    MIN(created_at) as oldest_record,
    MAX(created_at) as newest_record
FROM imprisonment_metrics;
