-- Update the format_type constraint to include new format categories

-- First, drop the existing constraint
ALTER TABLE videos 
DROP CONSTRAINT IF EXISTS check_format_type;

-- Add the updated constraint with all 12 format types
ALTER TABLE videos 
ADD CONSTRAINT check_format_type 
CHECK (format_type IN (
  'tutorial',
  'listicle',
  'explainer',
  'case_study',
  'news_analysis',
  'personal_story',
  'product_focus',
  'live_stream',
  'shorts',
  'vlog',
  'compilation',
  'update'
));

-- Verify the constraint was updated
SELECT 
  conname AS constraint_name,
  pg_get_constraintdef(oid) AS constraint_definition
FROM pg_constraint
WHERE conrelid = 'videos'::regclass
  AND conname = 'check_format_type';