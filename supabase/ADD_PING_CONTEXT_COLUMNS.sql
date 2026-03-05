-- =====================================================
-- ADD ping_ms AND context COLUMNS TO imprisonment_metrics
-- =====================================================
-- This adds the missing columns needed for AI Core context detection
-- =====================================================

-- Step 1: Add ping_ms column
ALTER TABLE public.imprisonment_metrics 
ADD COLUMN IF NOT EXISTS ping_ms INTEGER;

-- Step 2: Add context column (FAST/NORMAL/SLOW)
ALTER TABLE public.imprisonment_metrics 
ADD COLUMN IF NOT EXISTS context VARCHAR(20);

-- Step 3: Add check constraint for context values
ALTER TABLE public.imprisonment_metrics 
ADD CONSTRAINT imprisonment_metrics_context_check 
CHECK (context IS NULL OR context IN ('FAST', 'NORMAL', 'SLOW'));

-- Step 4: Create index for AI context queries
CREATE INDEX IF NOT EXISTS idx_ai_context_lookup 
ON public.imprisonment_metrics(user_id, connection_number, context, timing_type) 
TABLESPACE pg_default;

-- Step 5: Verify columns were added
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' 
  AND table_name = 'imprisonment_metrics'
  AND column_name IN ('ping_ms', 'context')
ORDER BY column_name;

-- =====================================================
-- COMPLETE!
-- =====================================================
-- ✅ Added ping_ms column (INTEGER, nullable)
-- ✅ Added context column (VARCHAR(20), nullable)
-- ✅ Added check constraint for context values
-- ✅ Added index for AI queries
-- =====================================================
