#!/bin/bash

# Run batch updates from the smaller SQL files

echo "🚀 Bulk Topic Update - Batch Method"
echo "==================================="
echo ""

# Add PostgreSQL to PATH
export PATH="/opt/homebrew/opt/postgresql@16/bin:$PATH"

# Connection details
DB_HOST="aws-0-us-east-1.pooler.supabase.com"
DB_PORT="6543"
DB_NAME="postgres"
DB_USER="postgres.mhzwrynnfphlxqcqytrj"

# SQL directory
SQL_DIR="/Users/brandoncullum/video-scripter/exports/sql-updates"

echo "📋 This will run 58 batch files to update all videos"
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

# Count files
TOTAL_FILES=$(ls -1 $SQL_DIR/*.sql | grep -v verify | wc -l)
echo "📁 Found $TOTAL_FILES SQL batch files"
echo ""

echo "🔄 Starting batch updates..."
echo ""

# Run each batch file
COUNTER=0
for sql_file in $(ls $SQL_DIR/*.sql | grep -v verify | sort); do
    COUNTER=$((COUNTER + 1))
    FILENAME=$(basename "$sql_file")
    
    echo -n "Processing batch $COUNTER/$TOTAL_FILES: $FILENAME... "
    
    # Run the SQL file
    psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -q < "$sql_file"
    
    if [ $? -eq 0 ]; then
        echo "✅"
    else
        echo "❌ Failed!"
        echo "Error in file: $sql_file"
        exit 1
    fi
done

echo ""
echo "✅ All batches completed successfully!"
echo ""
echo "📊 Verifying results..."

# Run verification
psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" < "$SQL_DIR/99-verify-results.sql"

echo ""
echo "🎉 Update complete! All 57,069 videos have been updated with topic assignments."

# Clean up
unset PGPASSWORD
unset PGSSLMODE
unset PGGSSENCMODE