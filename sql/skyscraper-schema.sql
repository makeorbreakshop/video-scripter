-- Skyscraper Analysis Framework Database Schema
-- This schema extends the existing video database with additional tables
-- for comprehensive content analysis based on the Skyscraper framework

-- Ensure pgvector extension is enabled
CREATE EXTENSION IF NOT EXISTS vector;

-- Modify existing videos table to add skyscraper-specific fields
ALTER TABLE public.videos 
ADD COLUMN IF NOT EXISTS outlier_factor FLOAT,
ADD COLUMN IF NOT EXISTS niche TEXT;

-- Content Analysis table
CREATE TABLE IF NOT EXISTS public.content_analysis (
  analysis_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  video_id TEXT NOT NULL REFERENCES public.videos(id) ON DELETE CASCADE,
  title_positioning TEXT,
  structural_organization JSONB NOT NULL DEFAULT '[]'::jsonb,
  key_points JSONB NOT NULL DEFAULT '[]'::jsonb,
  technical_information JSONB NOT NULL DEFAULT '[]'::jsonb,
  expertise_elements TEXT,
  visual_elements JSONB NOT NULL DEFAULT '[]'::jsonb,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Audience Analysis table
CREATE TABLE IF NOT EXISTS public.audience_analysis (
  audience_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  video_id TEXT NOT NULL REFERENCES public.videos(id) ON DELETE CASCADE,
  sentiment_overview JSONB NOT NULL DEFAULT '{}'::jsonb,
  comment_count INTEGER NOT NULL DEFAULT 0,
  praise_points JSONB NOT NULL DEFAULT '[]'::jsonb,
  questions_gaps JSONB NOT NULL DEFAULT '[]'::jsonb,
  use_cases JSONB NOT NULL DEFAULT '[]'::jsonb,
  demographic_signals JSONB NOT NULL DEFAULT '{}'::jsonb,
  engagement_patterns JSONB NOT NULL DEFAULT '[]'::jsonb,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Content Gaps table
CREATE TABLE IF NOT EXISTS public.content_gaps (
  gap_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  video_id TEXT NOT NULL REFERENCES public.videos(id) ON DELETE CASCADE,
  missing_information JSONB NOT NULL DEFAULT '[]'::jsonb,
  follow_up_opportunities TEXT,
  clarity_issues TEXT,
  depth_breadth_balance TEXT,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Structure Elements table
CREATE TABLE IF NOT EXISTS public.structure_elements (
  structure_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  video_id TEXT NOT NULL REFERENCES public.videos(id) ON DELETE CASCADE,
  overall_structure TEXT,
  section_ratio JSONB NOT NULL DEFAULT '{}'::jsonb,
  information_hierarchy TEXT,
  pacing_flow TEXT,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Engagement Techniques table
CREATE TABLE IF NOT EXISTS public.engagement_techniques (
  engagement_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  video_id TEXT NOT NULL REFERENCES public.videos(id) ON DELETE CASCADE,
  hook_strategy JSONB NOT NULL DEFAULT '{}'::jsonb,
  retention_mechanisms JSONB NOT NULL DEFAULT '[]'::jsonb,
  pattern_interrupts TEXT,
  interaction_prompts TEXT,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Value Delivery table
CREATE TABLE IF NOT EXISTS public.value_delivery (
  value_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  video_id TEXT NOT NULL REFERENCES public.videos(id) ON DELETE CASCADE,
  information_packaging TEXT,
  problem_solution_framing TEXT,
  practical_application TEXT,
  trust_building TEXT,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Implementation Blueprint table
CREATE TABLE IF NOT EXISTS public.implementation_blueprint (
  blueprint_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  video_id TEXT NOT NULL REFERENCES public.videos(id) ON DELETE CASCADE,
  content_template TEXT,
  key_sections JSONB NOT NULL DEFAULT '[]'::jsonb,
  engagement_points TEXT,
  differentiation_opportunities TEXT,
  cta_strategy TEXT,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Analysis Progress tracking table
CREATE TABLE IF NOT EXISTS public.skyscraper_analysis_progress (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  video_id TEXT NOT NULL REFERENCES public.videos(id) ON DELETE CASCADE,
  content_analysis_complete BOOLEAN NOT NULL DEFAULT FALSE,
  audience_analysis_complete BOOLEAN NOT NULL DEFAULT FALSE,
  content_gaps_complete BOOLEAN NOT NULL DEFAULT FALSE,
  structure_elements_complete BOOLEAN NOT NULL DEFAULT FALSE,
  engagement_techniques_complete BOOLEAN NOT NULL DEFAULT FALSE,
  value_delivery_complete BOOLEAN NOT NULL DEFAULT FALSE,
  implementation_blueprint_complete BOOLEAN NOT NULL DEFAULT FALSE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_content_analysis_video_id ON public.content_analysis(video_id);
CREATE INDEX IF NOT EXISTS idx_audience_analysis_video_id ON public.audience_analysis(video_id);
CREATE INDEX IF NOT EXISTS idx_content_gaps_video_id ON public.content_gaps(video_id);
CREATE INDEX IF NOT EXISTS idx_structure_elements_video_id ON public.structure_elements(video_id);
CREATE INDEX IF NOT EXISTS idx_engagement_techniques_video_id ON public.engagement_techniques(video_id);
CREATE INDEX IF NOT EXISTS idx_value_delivery_video_id ON public.value_delivery(video_id);
CREATE INDEX IF NOT EXISTS idx_implementation_blueprint_video_id ON public.implementation_blueprint(video_id);
CREATE INDEX IF NOT EXISTS idx_skyscraper_analysis_progress_video_id ON public.skyscraper_analysis_progress(video_id);

-- Row Level Security (RLS) Policies
-- Secure the tables so users can only access their own data

-- Content Analysis table policies
ALTER TABLE public.content_analysis ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own content analysis" ON public.content_analysis
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own content analysis" ON public.content_analysis
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own content analysis" ON public.content_analysis
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own content analysis" ON public.content_analysis
    FOR DELETE USING (auth.uid() = user_id);

-- Audience Analysis table policies
ALTER TABLE public.audience_analysis ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own audience analysis" ON public.audience_analysis
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own audience analysis" ON public.audience_analysis
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own audience analysis" ON public.audience_analysis
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own audience analysis" ON public.audience_analysis
    FOR DELETE USING (auth.uid() = user_id);

-- Content Gaps table policies
ALTER TABLE public.content_gaps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own content gaps" ON public.content_gaps
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own content gaps" ON public.content_gaps
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own content gaps" ON public.content_gaps
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own content gaps" ON public.content_gaps
    FOR DELETE USING (auth.uid() = user_id);

-- Structure Elements table policies
ALTER TABLE public.structure_elements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own structure elements" ON public.structure_elements
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own structure elements" ON public.structure_elements
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own structure elements" ON public.structure_elements
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own structure elements" ON public.structure_elements
    FOR DELETE USING (auth.uid() = user_id);

-- Engagement Techniques table policies
ALTER TABLE public.engagement_techniques ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own engagement techniques" ON public.engagement_techniques
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own engagement techniques" ON public.engagement_techniques
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own engagement techniques" ON public.engagement_techniques
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own engagement techniques" ON public.engagement_techniques
    FOR DELETE USING (auth.uid() = user_id);

-- Value Delivery table policies
ALTER TABLE public.value_delivery ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own value delivery" ON public.value_delivery
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own value delivery" ON public.value_delivery
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own value delivery" ON public.value_delivery
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own value delivery" ON public.value_delivery
    FOR DELETE USING (auth.uid() = user_id);

-- Implementation Blueprint table policies
ALTER TABLE public.implementation_blueprint ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own implementation blueprint" ON public.implementation_blueprint
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own implementation blueprint" ON public.implementation_blueprint
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own implementation blueprint" ON public.implementation_blueprint
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own implementation blueprint" ON public.implementation_blueprint
    FOR DELETE USING (auth.uid() = user_id);

-- Skyscraper Analysis Progress table policies
ALTER TABLE public.skyscraper_analysis_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own analysis progress" ON public.skyscraper_analysis_progress
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own analysis progress" ON public.skyscraper_analysis_progress
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own analysis progress" ON public.skyscraper_analysis_progress
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own analysis progress" ON public.skyscraper_analysis_progress
    FOR DELETE USING (auth.uid() = user_id);

-- Option for development with dummy user (should be used carefully)
-- Uncomment if needed for local development
/*
-- For dummy user development access
INSERT INTO auth.users (id, email)
VALUES ('00000000-0000-0000-0000-000000000000', 'dummy@example.com')
ON CONFLICT (id) DO NOTHING;
*/ 