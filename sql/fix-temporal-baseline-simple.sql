-- Simple fix that just resets the baselines to NULL and lets the trigger recalculate them
-- This is the safest approach

-- Step 1: Reset problematic baselines to NULL
UPDATE videos
SET channel_baseline_at_publish = NULL,
    temporal_performance_score = NULL
WHERE channel_baseline_at_publish = 1.0
AND import_date >= '2025-08-09'
AND is_short = false;

-- Step 2: Now trigger the recalculation using the existing function
SELECT trigger_temporal_baseline_processing(1000);