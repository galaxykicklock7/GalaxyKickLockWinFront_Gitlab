-- Add defense tracking to imprisonment_metrics table
-- SIMPLE: Just add ONE column to mark if rival kicked you

-- Add is_defense column
ALTER TABLE imprisonment_metrics
ADD COLUMN IF NOT EXISTS is_defense BOOLEAN DEFAULT FALSE;

-- Add comment
COMMENT ON COLUMN imprisonment_metrics.is_defense IS 'TRUE if rival kicked you (defense), FALSE if you kicked rival (attack)';

-- Create index for defense queries
CREATE INDEX IF NOT EXISTS idx_imprisonment_metrics_defense 
ON imprisonment_metrics(user_id, is_defense, context, ping_ms) 
WHERE is_defense = TRUE;

-- Update existing records to mark as attack metrics
UPDATE imprisonment_metrics 
SET is_defense = FALSE 
WHERE is_defense IS NULL;

-- Make is_defense NOT NULL after setting defaults
ALTER TABLE imprisonment_metrics 
ALTER COLUMN is_defense SET NOT NULL;

-- Verify the change
SELECT 
    column_name, 
    data_type, 
    is_nullable, 
    column_default
FROM information_schema.columns 
WHERE table_name = 'imprisonment_metrics' 
AND column_name = 'is_defense';
