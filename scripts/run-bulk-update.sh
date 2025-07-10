#!/bin/bash

# Script to run bulk topic update with password prompt

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

# Connection details
DB_HOST="aws-0-us-east-1.pooler.supabase.com"
DB_PORT="6543"
DB_NAME="postgres"
DB_USER="postgres.mhzwrynnfphlxqcqytrj"

# Build connection string
CONNECTION_STRING="postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}?sslmode=require"

echo ""
echo "🔄 Connecting to database..."
echo "🔄 Running bulk update (this should take just a few seconds)..."
echo ""

# Run the SQL file
psql "$CONNECTION_STRING" < "$SQL_FILE"

# Check exit status
if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Bulk update completed successfully!"
    echo ""
    echo "📊 Next steps:"
    echo "1. Check the results in your Supabase dashboard"
    echo "2. Verify the topic distribution looks correct"
    echo "3. The videos table now has updated topic assignments!"
else
    echo ""
    echo "❌ Error: Update failed"
    echo "Please check your password and try again"
fi