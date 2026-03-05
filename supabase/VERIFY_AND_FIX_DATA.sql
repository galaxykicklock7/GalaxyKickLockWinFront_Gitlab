-- Verify current state and fix

-- 1. Check current is_defense values for this rival
SELECT 
    player_name,
    is_defense,
    COUNT(*) as count
FROM imprisonment_metrics
WHERE player_name = '[L][E][0]'
GROUP BY player_name, is_defense;

-- 2. Force update ALL NULL is_defense to false
UPDATE imprisonment_metrics
SET is_defense = false
WHERE is_defense IS NULL;

-- 3. Verify the update worked
SELECT 
    player_name,
    is_defense,
    COUNT(*) as count
FROM imprisonment_metrics
WHERE player_name = '[L][E][0]'
GROUP BY player_name, is_defense;

-- 4. Now test if records are found
SELECT COUNT(*) as should_be_found
FROM imprisonment_metrics
WHERE player_name = '[L][E][0]'
  AND is_defense = false;
