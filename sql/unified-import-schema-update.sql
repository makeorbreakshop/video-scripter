-- Unified Import Schema Update for video_processing_jobs table
-- This migration adds support for unified import jobs

-- Add columns for unified import system
ALTER TABLE video_processing_jobs 
ADD COLUMN IF NOT EXISTS type VARCHAR(50) DEFAULT 'video_import',
ADD COLUMN IF NOT EXISTS input_data JSONB,
ADD COLUMN IF NOT EXISTS output_data JSONB;

-- Update existing jobs to have the new type
UPDATE video_processing_jobs 
SET type = 'video_import' 
WHERE type IS NULL;

-- Add index for better performance
CREATE INDEX IF NOT EXISTS idx_video_processing_jobs_type ON video_processing_jobs(type);
CREATE INDEX IF NOT EXISTS idx_video_processing_jobs_status_priority ON video_processing_jobs(status, priority DESC);

-- Add comments for documentation
COMMENT ON COLUMN video_processing_jobs.type IS 'Type of job: video_import, unified_import, etc.';
COMMENT ON COLUMN video_processing_jobs.input_data IS 'Input data for the job (VideoImportRequest for unified_import)';
COMMENT ON COLUMN video_processing_jobs.output_data IS 'Output data from completed job (VideoImportResult for unified_import)';