-- Test the RPC function
SELECT COUNT(*) as total_channels FROM get_competitor_youtube_channels();

-- Show first 10 channels
SELECT * FROM get_competitor_youtube_channels() LIMIT 10;