-- SQL script to add a dummy user to the auth.users table (robust version)
-- This will allow us to use the app without authentication

-- First, check if the uuid extension is enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Get the UUID from the auth context in our React app
-- Make sure this matches the dummy user ID in contexts/auth-context.tsx
DO $$
DECLARE
    dummy_user_id UUID := '00000000-0000-0000-0000-000000000000';
    dummy_email TEXT := 'dummy@example.com';
    count_users INT;
    column_names TEXT[];
    insert_columns TEXT := '';
    insert_values TEXT := '';
BEGIN
    -- Check if the user already exists
    SELECT COUNT(*) INTO count_users 
    FROM auth.users 
    WHERE id = dummy_user_id;
    
    -- If the user doesn't exist, insert it
    IF count_users = 0 THEN
        -- Get column names that aren't generated
        SELECT array_agg(column_name::text)
        INTO column_names
        FROM information_schema.columns
        WHERE table_schema = 'auth'
          AND table_name = 'users'
          AND is_generated = 'NEVER';
        
        -- Build dynamic INSERT statement
        insert_columns := 'id, email, aud';
        insert_values := '''' || dummy_user_id || ''', ''' || dummy_email || ''', ''authenticated''';
        
        -- Add created_at, updated_at if they exist
        IF 'created_at' = ANY(column_names) THEN
            insert_columns := insert_columns || ', created_at';
            insert_values := insert_values || ', NOW()';
        END IF;
        
        IF 'updated_at' = ANY(column_names) THEN
            insert_columns := insert_columns || ', updated_at';
            insert_values := insert_values || ', NOW()';
        END IF;
        
        IF 'email_confirmed_at' = ANY(column_names) THEN
            insert_columns := insert_columns || ', email_confirmed_at';
            insert_values := insert_values || ', NOW()';
        END IF;
        
        -- Execute the dynamic SQL
        EXECUTE 'INSERT INTO auth.users (' || insert_columns || ') VALUES (' || insert_values || ')';
        
        RAISE NOTICE 'Dummy user added successfully: %', dummy_user_id;
    ELSE
        RAISE NOTICE 'Dummy user already exists: %', dummy_user_id;
    END IF;

    -- Verify the user was added
    SELECT COUNT(*) INTO count_users 
    FROM auth.users 
    WHERE id = dummy_user_id;
    
    RAISE NOTICE 'Number of dummy users found: %', count_users;
    
    -- Try to add a project for this user
    BEGIN
        INSERT INTO public.projects (
            name,
            user_id,
            created_at,
            updated_at
        ) VALUES (
            'Sample Project',
            dummy_user_id,
            NOW(),
            NOW()
        ) ON CONFLICT DO NOTHING;
        RAISE NOTICE 'Sample project created or already exists.';
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'Failed to create sample project: %', SQLERRM;
    END;
END $$;

-- Alternative approach - direct table modification (only if above fails)
-- WARNING: This bypasses foreign key constraints and should only be used for development
COMMENT ON TABLE public.projects IS 'This table has foreign key constraints that link to auth.users';

-- Add this commented out code for emergencies only
/*
-- Disable triggers and constraints (dangerous, only for development)
ALTER TABLE public.projects DISABLE TRIGGER ALL;

-- Add projects directly
INSERT INTO public.projects (
    id,
    name,
    user_id,
    created_at,
    updated_at
) VALUES (
    uuid_generate_v4(),
    'Emergency Sample Project',
    '00000000-0000-0000-0000-000000000000',
    NOW(),
    NOW()
) ON CONFLICT DO NOTHING;

-- Re-enable triggers and constraints
ALTER TABLE public.projects ENABLE TRIGGER ALL;
*/ 