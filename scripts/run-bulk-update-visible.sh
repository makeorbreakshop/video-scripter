#!/bin/bash

# Run bulk update with visible password

echo "🚀 Bulk Topic Update (57,069 videos)"
echo "===================================="
echo ""

# Add PostgreSQL to PATH
export PATH="/opt/homebrew/opt/postgresql@16/bin:$PATH"

# Connection details
DB_HOST="aws-0-us-east-1.pooler.supabase.com"
DB_PORT="6543"
DB_NAME="postgres"
DB_USER="postgres.mhzwrynnfphlxqcqytrj"

# SQL file
SQL_FILE="/Users/brandoncullum/video-scripter/exports/bulk-update-topics.sql"

echo "📋 This will update all 57,069 videos with their topic assignments"
echo ""

# Prompt for password (VISIBLE)
echo -n "Enter your database password (visible): "
read DB_PASSWORD
echo ""

echo "🔑 Using password: $DB_PASSWORD"
echo ""

# Set environment variables
export PGPASSWORD="$DB_PASSWORD"
export PGSSLMODE="require"
export PGGSSENCMODE="disable"

echo "🔄 Running bulk update..."
echo "⏱️  This should take about 10-30 seconds..."
echo ""

# Run the update
psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" < "$SQL_FILE"

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Bulk update completed successfully!"
    echo ""
    echo "📊 Verifying results..."
    
    # Quick verification
    psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "
    SELECT 
        'Total videos with topic assignments' as metric,
        COUNT(*) as count 
    FROM videos 
    WHERE topic_level_1 IS NOT NULL;"
    
    echo ""
    echo "🎉 All done! Check your Supabase dashboard to see the updated topic assignments."
else
    echo ""
    echo "❌ Update failed!"
fi

# Clean up
unset PGPASSWORD
unset PGSSLMODE
unset PGGSSENCMODE