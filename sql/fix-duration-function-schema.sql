-- First, check if the function exists and where
SELECT 
  n.nspname as schema_name,
  p.proname as function_name,
  pg_catalog.pg_get_function_identity_arguments(p.oid) as arguments
FROM pg_catalog.pg_proc p
LEFT JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
WHERE p.proname = 'extract_duration_seconds';

-- Drop any existing versions to avoid conflicts
DROP FUNCTION IF EXISTS extract_duration_seconds(TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.extract_duration_seconds(TEXT) CASCADE;

-- Create the function explicitly in the public schema
CREATE OR REPLACE FUNCTION public.extract_duration_seconds(duration TEXT)
RETURNS INTEGER AS $$
DECLARE
  hours INTEGER := 0;
  minutes INTEGER := 0;
  seconds INTEGER := 0;
  matches TEXT[];
BEGIN
  -- Handle NULL, empty, or invalid durations
  IF duration IS NULL OR duration = '' OR duration = 'P0D' THEN
    RETURN 0;
  END IF;
  
  -- Extract hours, minutes, seconds using regex
  -- Pattern matches: PT1H30M45S, PT30M45S, PT45S, PT1H, PT30M, etc.
  IF duration ~ '^PT(\d+H)?(\d+M)?(\d+S)?$' THEN
    SELECT regexp_matches(duration, '^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$') INTO matches;
    
    IF matches[1] IS NOT NULL THEN hours := matches[1]::INTEGER; END IF;
    IF matches[2] IS NOT NULL THEN minutes := matches[2]::INTEGER; END IF;
    IF matches[3] IS NOT NULL THEN seconds := matches[3]::INTEGER; END IF;
  END IF;
  
  RETURN hours * 3600 + minutes * 60 + seconds;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION public.extract_duration_seconds(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.extract_duration_seconds(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.extract_duration_seconds(TEXT) TO service_role;

-- Test it works
SELECT public.extract_duration_seconds('PT1M30S') as should_be_90;

-- Now check where is_youtube_short function is defined and update it to use public schema
SELECT 
  n.nspname as schema_name,
  p.proname as function_name
FROM pg_catalog.pg_proc p
LEFT JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
WHERE p.proname = 'is_youtube_short';

-- Update is_youtube_short to explicitly use public.extract_duration_seconds
CREATE OR REPLACE FUNCTION public.is_youtube_short(
  duration TEXT,
  title TEXT DEFAULT '',
  description TEXT DEFAULT ''
) RETURNS BOOLEAN AS $$
DECLARE
  duration_seconds INTEGER;
  combined_text TEXT;
BEGIN
  -- Duration check: <= 2 minutes 1 second (121 seconds)
  duration_seconds := public.extract_duration_seconds(duration);
  IF duration_seconds > 0 AND duration_seconds <= 121 THEN
    RETURN TRUE;
  END IF;
  
  -- Hashtag check: Look for #shorts, #short, #youtubeshorts (case insensitive)
  combined_text := LOWER(COALESCE(title, '') || ' ' || COALESCE(description, ''));
  IF combined_text ~ '\#shorts?\b' OR combined_text ~ '\#youtubeshorts?\b' THEN
    RETURN TRUE;
  END IF;
  
  RETURN FALSE;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Grant permissions for is_youtube_short too
GRANT EXECUTE ON FUNCTION public.is_youtube_short(TEXT, TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.is_youtube_short(TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_youtube_short(TEXT, TEXT, TEXT) TO service_role;