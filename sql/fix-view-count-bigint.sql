-- Fix view_count column to support videos with billions of views
-- Integer type max value is ~2.1 billion, but some videos exceed this
ALTER TABLE videos ALTER COLUMN view_count TYPE bigint;

-- Also update any related views or functions that might use this column
-- This ensures compatibility with videos that have over 2 billion views