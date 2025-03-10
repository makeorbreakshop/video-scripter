-- SQL script to add a dummy user to the auth.users table
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
BEGIN
    -- Check if the user already exists
    SELECT COUNT(*) INTO count_users 
    FROM auth.users 
    WHERE id = dummy_user_id;
    
    -- If the user doesn't exist, insert it
    IF count_users = 0 THEN
        -- Insert dummy user into auth.users table
        -- Note: confirmed_at is a generated column, don't include it
        INSERT INTO auth.users (
            id,
            email,
            created_at,
            updated_at,
            email_confirmed_at,
            aud
        ) VALUES (
            dummy_user_id,
            dummy_email,
            NOW(),
            NOW(),
            NOW(),
            'authenticated'
        );
        
        RAISE NOTICE 'Dummy user added successfully: %', dummy_user_id;
    ELSE
        RAISE NOTICE 'Dummy user already exists: %', dummy_user_id;
    END IF;

    -- Verify the user was added
    SELECT COUNT(*) INTO count_users 
    FROM auth.users 
    WHERE id = dummy_user_id;
    
    RAISE NOTICE 'Number of dummy users found: %', count_users;
END $$;

-- Add any projects for the dummy user
INSERT INTO public.projects (
    name,
    user_id,
    created_at,
    updated_at
) VALUES (
    'Sample Project',
    '00000000-0000-0000-0000-000000000000',
    NOW(),
    NOW()
) ON CONFLICT DO NOTHING;

-- Note: You might need to run this SQL directly in the Supabase SQL Editor
-- since it accesses internal auth tables that might not be accessible through
-- the normal JavaScript API. 