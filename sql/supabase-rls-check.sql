-- SQL script to verify Row Level Security (RLS) policies in Supabase

-- Check RLS status for projects table
SELECT
  table_name,
  row_security,
  policies
FROM (
  SELECT
    t.table_name,
    t.row_security,
    array_agg(
      json_build_object(
        'policy_name', p.policyname,
        'roles', p.roles,
        'cmd', p.cmd,
        'qual', p.qual,
        'with_check', p.with_check
      )
    ) as policies
  FROM pg_tables t
  LEFT JOIN pg_policies p ON t.tablename = p.tablename
  WHERE t.schemaname = 'public'
  AND t.tablename IN ('projects', 'documents', 'script_data')
  GROUP BY t.table_name, t.row_security
) as rls_info;

-- Suggested RLS policies setup if missing:

/*
-- For projects table
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own projects" ON public.projects
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own projects" ON public.projects
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own projects" ON public.projects
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own projects" ON public.projects
    FOR DELETE USING (auth.uid() = user_id);

-- For documents table
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own documents" ON public.documents
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own documents" ON public.documents
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own documents" ON public.documents
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own documents" ON public.documents
    FOR DELETE USING (auth.uid() = user_id);

-- For script_data table
ALTER TABLE public.script_data ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own script data" ON public.script_data
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own script data" ON public.script_data
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own script data" ON public.script_data
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own script data" ON public.script_data
    FOR DELETE USING (auth.uid() = user_id);
*/

-- This SQL can be run in the Supabase SQL Editor to check RLS policies
-- If policies are missing, you can uncomment and run the suggested policies setup 