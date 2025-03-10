-- Database schema for YouTube Script Editor

-- Projects table
CREATE TABLE IF NOT EXISTS public.projects (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Documents table
CREATE TABLE IF NOT EXISTS public.documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title TEXT NOT NULL,
    type TEXT NOT NULL, -- 'notes', 'analysis', 'script', 'research', 'template'
    content TEXT DEFAULT '',
    project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Script data table (stores structured data for each phase)
CREATE TABLE IF NOT EXISTS public.script_data (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Row Level Security (RLS) Policies
-- Users can only see and modify their own data

-- Projects table policies
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own projects" ON public.projects
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own projects" ON public.projects
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own projects" ON public.projects
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own projects" ON public.projects
    FOR DELETE USING (auth.uid() = user_id);

-- Documents table policies
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own documents" ON public.documents
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own documents" ON public.documents
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own documents" ON public.documents
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own documents" ON public.documents
    FOR DELETE USING (auth.uid() = user_id);

-- Script data table policies
ALTER TABLE public.script_data ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own script data" ON public.script_data
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own script data" ON public.script_data
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own script data" ON public.script_data
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own script data" ON public.script_data
    FOR DELETE USING (auth.uid() = user_id);

-- Indices for performance
CREATE INDEX IF NOT EXISTS idx_projects_user_id ON public.projects(user_id);
CREATE INDEX IF NOT EXISTS idx_documents_project_id ON public.documents(project_id);
CREATE INDEX IF NOT EXISTS idx_documents_user_id ON public.documents(user_id);
CREATE INDEX IF NOT EXISTS idx_script_data_project_id ON public.script_data(project_id);
CREATE INDEX IF NOT EXISTS idx_script_data_user_id ON public.script_data(user_id);

-- SQL to modify the database schema to work without authentication
-- Use this for development purposes only

-- Option 1: Modify the foreign key constraint to allow our dummy user ID
-- This adds a dummy user to the auth.users table
INSERT INTO auth.users (id, email)
VALUES ('00000000-0000-0000-0000-000000000000', 'dummy@example.com')
ON CONFLICT (id) DO NOTHING;

-- Option 2: Disable RLS for all tables
ALTER TABLE public.projects DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.documents DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.script_data DISABLE ROW LEVEL SECURITY;

-- Option 3: Create public access policies
CREATE POLICY "Allow public access to projects" ON public.projects
    FOR ALL TO PUBLIC USING (true);

CREATE POLICY "Allow public access to documents" ON public.documents
    FOR ALL TO PUBLIC USING (true);

CREATE POLICY "Allow public access to script_data" ON public.script_data
    FOR ALL TO PUBLIC USING (true);

-- Option 4: If the above won't work, temporarily remove the foreign key constraint
-- WARNING: Only use this in development
-- ALTER TABLE public.projects DROP CONSTRAINT projects_user_id_fkey;
-- ALTER TABLE public.documents DROP CONSTRAINT documents_user_id_fkey;
-- ALTER TABLE public.script_data DROP CONSTRAINT script_data_user_id_fkey; 