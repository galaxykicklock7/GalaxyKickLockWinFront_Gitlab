-- Add adjustment_reason column to track what caused ML timing changes
-- Values: '3S_ERROR', 'SUCCESS', 'FAILURE', 'PRISON', 'STUCK_ESCAPE', 'INIT'

-- Add the column
ALTER TABLE public.imprisonment_metrics 
ADD COLUMN IF NOT EXISTS adjustment_reason VARCHAR(20);

-- Add check constraint for valid values
ALTER TABLE public.imprisonment_metrics
DROP CONSTRAINT IF EXISTS imprisonment_metrics_adjustment_reason_check;

ALTER TABLE public.imprisonment_metrics
ADD CONSTRAINT imprisonment_metrics_adjustment_reason_check 
CHECK (
    adjustment_reason IS NULL OR 
    adjustment_reason IN ('3S_ERROR', 'SUCCESS', 'FAILURE', 'PRISON', 'STUCK_ESCAPE', 'INIT', 'DB_INIT')
);

-- Add index for querying by adjustment reason
CREATE INDEX IF NOT EXISTS idx_imprisonment_adjustment_reason 
ON public.imprisonment_metrics (user_id, connection_number, adjustment_reason, created_at DESC);

-- Add comment
COMMENT ON COLUMN public.imprisonment_metrics.adjustment_reason IS 
'Tracks what caused the ML timing adjustment: 3S_ERROR (too fast), SUCCESS (caught rival), FAILURE (rival escaped), PRISON (bot imprisoned), STUCK_ESCAPE (forced escape from stuck state), INIT (initial timing), DB_INIT (loaded from database)';

-- Verify
SELECT column_name, data_type, character_maximum_length 
FROM information_schema.columns 
WHERE table_name = 'imprisonment_metrics' 
AND column_name = 'adjustment_reason';
