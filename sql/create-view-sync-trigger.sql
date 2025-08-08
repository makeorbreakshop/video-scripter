-- Trigger to automatically sync videos.view_count when view_snapshots is updated
-- This ensures the main videos table always has the latest view count

-- First, create the trigger function
CREATE OR REPLACE FUNCTION sync_video_view_count()
RETURNS TRIGGER AS $$
BEGIN
    -- When a new snapshot is inserted or updated, update the corresponding video
    UPDATE videos 
    SET 
        view_count = NEW.view_count,
        updated_at = NOW()
    WHERE id = NEW.video_id
    AND (view_count != NEW.view_count OR view_count IS NULL);
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop existing trigger if it exists
DROP TRIGGER IF EXISTS trigger_sync_video_view_count ON view_snapshots;

-- Create the trigger
CREATE TRIGGER trigger_sync_video_view_count
    AFTER INSERT OR UPDATE OF view_count ON view_snapshots
    FOR EACH ROW
    EXECUTE FUNCTION sync_video_view_count();

-- Test the trigger works
SELECT 
    trigger_name,
    event_manipulation,
    event_object_table,
    action_statement
FROM information_schema.triggers 
WHERE trigger_name = 'trigger_sync_video_view_count';