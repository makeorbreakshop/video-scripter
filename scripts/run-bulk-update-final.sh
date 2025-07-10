#!/bin/bash

# Script to run bulk topic update with proper SSL and auth handling

echo "🚀 Bulk Topic Update Script"
echo "=========================="
echo ""
echo "This will update 57,069 video topic assignments in your database."
echo ""

# Add PostgreSQL to PATH first
export PATH="/opt/homebrew/opt/postgresql@16/bin:$PATH"

# Check if psql is installed
if ! command -v psql &> /dev/null; then
    echo "❌ Error: psql is not installed"
    echo "Install it with: brew install postgresql@16"
    exit 1
fi

# Check if SQL file exists
SQL_FILE="/Users/brandoncullum/video-scripter/exports/bulk-update-topics.sql"
if [ ! -f "$SQL_FILE" ]; then
    echo "❌ Error: SQL file not found at $SQL_FILE"
    exit 1
fi

# Prompt for password
echo -n "Enter your Supabase database password: "
read -s DB_PASSWORD
echo ""

echo ""
echo "🔄 Connecting to database..."
echo "🔄 Running bulk update (this should take just a few seconds)..."
echo ""

# Set environment variables for PostgreSQL
export PGPASSWORD="$DB_PASSWORD"
export PGSSLMODE="require"
export PGGSSENCMODE="disable"

# Connection parameters
DB_HOST="aws-0-us-east-1.pooler.supabase.com"
DB_PORT="6543"
DB_NAME="postgres"
DB_USER="postgres.mhzwrynnfphlxqcqytrj"

# Run the SQL file with all necessary options
psql \
    --host="$DB_HOST" \
    --port="$DB_PORT" \
    --username="$DB_USER" \
    --dbname="$DB_NAME" \
    --no-password \
    --file="$SQL_FILE"

# Check exit status
EXIT_CODE=$?

if [ $EXIT_CODE -eq 0 ]; then
    echo ""
    echo "✅ Bulk update completed successfully!"
    echo ""
    echo "📊 The update should have:"
    echo "   - Created a temporary table"
    echo "   - Loaded 57,069 video assignments"
    echo "   - Updated all videos in one operation"
    echo "   - Shown you the Level 1 topic distribution"
    echo ""
    echo "Check your Supabase dashboard to verify!"
else
    echo ""
    echo "❌ Error: Update failed (exit code: $EXIT_CODE)"
    echo ""
    echo "Common issues:"
    echo "1. Wrong password - get it from Supabase Dashboard > Settings > Database"
    echo "2. Network issues - check your internet connection"
    echo "3. Database restrictions - ensure your IP is allowed"
    echo ""
    echo "You can also try running this command directly:"
    echo "PGPASSWORD='YOUR_PASSWORD' PGSSLMODE=require PGGSSENCMODE=disable psql -h aws-0-us-east-1.pooler.supabase.com -p 6543 -U postgres.mhzwrynnfphlxqcqytrj -d postgres < $SQL_FILE"
fi

# Clean up
unset PGPASSWORD
unset PGSSLMODE
unset PGGSSENCMODE