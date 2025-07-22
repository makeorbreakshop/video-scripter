#!/bin/bash

# Script to fix the calculate_tracking_priority function error

echo "🔧 Fixing calculate_tracking_priority function..."
echo "This will fix the error: 'function calculate_tracking_priority does not exist'"
echo ""

# Check if we have the DATABASE_URL environment variable
if [ -z "$DATABASE_URL" ]; then
    echo "❌ DATABASE_URL environment variable not set"
    echo "Please set it to your Supabase database URL"
    echo "Example: export DATABASE_URL='postgresql://postgres:[password]@[host]:[port]/postgres'"
    exit 1
fi

# Run the fix SQL script
echo "📝 Running SQL fix script..."
psql "$DATABASE_URL" -f sql/fix_tracking_priority_function.sql

if [ $? -eq 0 ]; then
    echo "✅ Successfully fixed the calculate_tracking_priority function!"
    echo ""
    echo "The following changes were made:"
    echo "1. Removed old trigger that was calling the function incorrectly"
    echo "2. Created the simple age-based calculate_tracking_priority function"
    echo "3. Created new trigger that works with the simple function"
    echo "4. Updated get_videos_to_track function for 6-tier support"
    echo ""
    echo "Your video imports should now work correctly! 🎉"
else
    echo "❌ Failed to run the fix script"
    echo "Please check your database connection and try again"
    exit 1
fi