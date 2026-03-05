-- Add timing_offset column for ping-relative timing
-- This allows cross-player learning to work correctly

-- Add timing_offset column (stores timing relative to BASE)
ALTER TABLE imprisonment_metrics 
ADD COLUMN IF NOT EXISTS timing_offset INTEGER;

-- Add index for faster queries
CREATE INDEX IF NOT EXISTS idx_timing_offset 
ON imprisonment_metrics(timing_offset);

-- Backfill timing_offset for existing records
-- timing_offset = timing_value - (1700 + ping_ms)
UPDATE imprisonment_metrics
SET timing_offset = timing_value - (1700 + COALESCE(ping_ms, 100))
WHERE timing_offset IS NULL 
  AND timing_value IS NOT NULL;

-- Add comment
COMMENT ON COLUMN imprisonment_metrics.timing_offset IS 
'Timing offset from BASE (1700 + ping). Allows cross-player learning. Example: -60 means 60ms faster than BASE.';

-- Verify
SELECT 
    player_name,
    timing_value,
    ping_ms,
    timing_offset,
    (1700 + COALESCE(ping_ms, 100)) as calculated_base,
    timing_value - (1700 + COALESCE(ping_ms, 100)) as expected_offset
FROM imprisonment_metrics
WHERE timing_value IS NOT NULL
LIMIT 10;
