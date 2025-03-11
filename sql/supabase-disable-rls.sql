-- WARNING: This script disables Row Level Security (RLS) on tables
-- Only use this for development/testing purposes, never in production
-- This will allow public access to these tables without authentication

-- Disable RLS on projects table
ALTER TABLE public.projects DISABLE ROW LEVEL SECURITY;

-- Disable RLS on documents table
ALTER TABLE public.documents DISABLE ROW LEVEL SECURITY;

-- Disable RLS on script_data table
ALTER TABLE public.script_data DISABLE ROW LEVEL SECURITY;

-- Create a policy that allows public access (alternative to disabling RLS)
-- More selective than completely disabling RLS

-- For projects table
CREATE POLICY "Allow public access to projects" ON public.projects
    FOR ALL TO PUBLIC USING (true);

-- For documents table
CREATE POLICY "Allow public access to documents" ON public.documents
    FOR ALL TO PUBLIC USING (true);

-- For script_data table
CREATE POLICY "Allow public access to script_data" ON public.script_data
    FOR ALL TO PUBLIC USING (true);

-- Note: You can run the following to re-enable RLS later:
-- ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.script_data ENABLE ROW LEVEL SECURITY;

-- SQL to disable Row Level Security for development purposes
-- WARNING: Only use this in development, never in production

-- Disable RLS for the projects table
ALTER TABLE public.projects DISABLE ROW LEVEL SECURITY;

-- Disable RLS for the documents table
ALTER TABLE public.documents DISABLE ROW LEVEL SECURITY;

-- Disable RLS for the script_data table
ALTER TABLE public.script_data DISABLE ROW LEVEL SECURITY;

-- Verify RLS status
SELECT
    schemaname,
    tablename,
    rowsecurity
FROM
    pg_tables
WHERE
    schemaname = 'public'
    AND tablename IN ('projects', 'documents', 'script_data'); 