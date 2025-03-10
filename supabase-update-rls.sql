-- SQL to update RLS (Row Level Security) for development purposes
-- This script checks for existing policies before making changes

DO $$
DECLARE
    table_names TEXT[] := ARRAY['projects', 'documents', 'script_data'];
    table_name TEXT;
    policy_exists BOOLEAN;
BEGIN
    -- Loop through all tables
    FOREACH table_name IN ARRAY table_names
    LOOP
        -- Disable RLS for the table
        EXECUTE 'ALTER TABLE public.' || table_name || ' DISABLE ROW LEVEL SECURITY;';
        RAISE NOTICE 'Disabled RLS for table: %', table_name;
        
        -- Check if policy already exists
        SELECT EXISTS (
            SELECT 1 FROM pg_policies 
            WHERE tablename = table_name 
            AND policyname = 'Allow public access to ' || table_name
        ) INTO policy_exists;
        
        -- If policy exists, drop it
        IF policy_exists THEN
            EXECUTE 'DROP POLICY "Allow public access to ' || table_name || '" ON public.' || table_name || ';';
            RAISE NOTICE 'Dropped existing policy for table: %', table_name;
        END IF;
        
        -- Create new policy (if RLS is enabled manually later)
        BEGIN
            EXECUTE 'CREATE POLICY "Allow public access to ' || table_name || '" ON public.' || table_name || ' FOR ALL TO PUBLIC USING (true);';
            RAISE NOTICE 'Created policy for table: %', table_name;
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'Could not create policy for table %: %', table_name, SQLERRM;
        END;
    END LOOP;
END $$;

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

-- Verify policies
SELECT
    schemaname,
    tablename,
    policyname,
    permissive,
    roles,
    cmd,
    qual,
    with_check
FROM
    pg_policies
WHERE
    schemaname = 'public'
    AND tablename IN ('projects', 'documents', 'script_data'); 