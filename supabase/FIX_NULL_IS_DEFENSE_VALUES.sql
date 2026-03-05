-- Fix NULL is_defense values in existing records
-- Set all NULL values to false (default for attack records)

UPDATE imprisonment_metrics
SET is_defense = false
WHERE is_defense IS NULL;

-- Verify the fix
SELECT 
    COUNT(*) as total_records,
    COUNT(CASE WHEN is_defense IS NULL THEN 1 END) as null_count,
    COUNT(CASE WHEN is_defense = true THEN 1 END) as defense_count,
    COUNT(CASE WHEN is_defense = false THEN 1 END) as attack_count
FROM imprisonment_metrics;
