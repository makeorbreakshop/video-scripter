#!/bin/bash

# Direct PostgreSQL connection script for bulk update

echo "🔄 Connecting to Supabase database directly..."

# Your project ref is: mhzwrynnfphlxqcqytrj
# You'll need to get your database password from Supabase dashboard:
# Settings > Database > Database Password

echo "📋 To run the bulk update:"
echo "1. Get your database password from Supabase dashboard"
echo "2. Run one of these commands:"
echo ""
echo "Option 1 - Direct SQL file (recommended):"
echo "psql \"postgresql://postgres.mhzwrynnfphlxqcqytrj:[YOUR-PASSWORD]@aws-0-us-east-1.pooler.supabase.com:6543/postgres\" < /Users/brandoncullum/video-scripter/exports/bulk-update-topics.sql"
echo ""
echo "Option 2 - Using COPY with CSV:"
echo "psql \"postgresql://postgres.mhzwrynnfphlxqcqytrj:[YOUR-PASSWORD]@aws-0-us-east-1.pooler.supabase.com:6543/postgres\""
echo "Then run: \COPY tmp_topic_assignments FROM '/Users/brandoncullum/video-scripter/exports/topic-assignments-for-copy.csv' WITH (FORMAT csv)"