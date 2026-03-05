-- Find all unique player names in the database
SELECT 
    player_name,
    COUNT(*) as record_count,
    MIN(created_at) as first_seen,
    MAX(created_at) as last_seen
FROM imprisonment_metrics
GROUP BY player_name
ORDER BY record_count DESC
LIMIT 50;

-- Search for player names containing 'L' or 'E' or '0'
SELECT DISTINCT player_name
FROM imprisonment_metrics
WHERE player_name LIKE '%L%' 
   OR player_name LIKE '%E%' 
   OR player_name LIKE '%0%'
ORDER BY player_name;
