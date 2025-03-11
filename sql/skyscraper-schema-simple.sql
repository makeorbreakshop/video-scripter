-- Simplified Skyscraper Analysis Framework Database Schema
-- This schema creates a single table to store all analysis data in JSONB fields

-- Ensure pgvector extension is enabled
CREATE EXTENSION IF NOT EXISTS vector;

-- Create the simplified skyscraper_analyses table
CREATE TABLE IF NOT EXISTS public.skyscraper_analyses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  video_id TEXT NOT NULL REFERENCES public.videos(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  model_used TEXT NOT NULL,
  content_analysis JSONB,
  audience_analysis JSONB,
  content_gaps JSONB,
  framework_elements JSONB,
  engagement_techniques JSONB,
  value_delivery JSONB,
  implementation_blueprint JSONB,
  raw_analysis TEXT,
  analysis_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_skyscraper_analyses_video_id ON public.skyscraper_analyses(video_id);
CREATE INDEX IF NOT EXISTS idx_skyscraper_analyses_user_id ON public.skyscraper_analyses(user_id);
CREATE INDEX IF NOT EXISTS idx_skyscraper_analyses_analysis_date ON public.skyscraper_analyses(analysis_date);

-- Add RLS policies for the skyscraper_analyses table
ALTER TABLE public.skyscraper_analyses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own analyses" ON public.skyscraper_analyses
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own analyses" ON public.skyscraper_analyses
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own analyses" ON public.skyscraper_analyses
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own analyses" ON public.skyscraper_analyses
    FOR DELETE USING (auth.uid() = user_id);

-- Create a function to update the updated_at timestamp
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create a trigger to automatically update the updated_at column
CREATE TRIGGER update_skyscraper_analyses_updated_at
BEFORE UPDATE ON public.skyscraper_analyses
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Add a comment to explain the table
COMMENT ON TABLE public.skyscraper_analyses IS 'Stores comprehensive video analysis data using the Skyscraper Analysis Framework'; 