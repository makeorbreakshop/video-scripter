-- Fix pattern table triggers and ensure they're active

-- Check if trigger exists
SELECT 
    trigger_name,
    event_manipulation,
    event_object_table,
    trigger_schema
FROM information_schema.triggers 
WHERE trigger_name = 'patterns_updated_at_trigger';

-- Drop and recreate trigger to ensure it's working
DROP TRIGGER IF EXISTS patterns_updated_at_trigger ON patterns;

-- Recreate the trigger
CREATE TRIGGER patterns_updated_at_trigger
  BEFORE UPDATE ON patterns
  FOR EACH ROW
  EXECUTE FUNCTION update_patterns_updated_at();

-- Verify trigger was created
SELECT 
    trigger_name,
    event_manipulation,
    event_object_table,
    trigger_schema
FROM information_schema.triggers 
WHERE trigger_name = 'patterns_updated_at_trigger';

-- Test the trigger by updating a pattern (if any exist)
SELECT COUNT(*) as pattern_count FROM patterns;