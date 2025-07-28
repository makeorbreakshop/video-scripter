#!/bin/bash

# Test database connection script

echo "🔍 Database Connection Test"
echo "=========================="
echo ""

# Add PostgreSQL to PATH
export PATH="/opt/homebrew/opt/postgresql@16/bin:$PATH"

# Check if psql is installed
if ! command -v psql &> /dev/null; then
    echo "❌ Error: psql is not installed"
    exit 1
fi

# Prompt for password
echo -n "Enter your Supabase database password: "
read -s DB_PASSWORD
echo ""
echo ""

# Connection details
DB_HOST="aws-0-us-east-1.pooler.supabase.com"
DB_PORT="6543"
DB_NAME="postgres"
DB_USER="postgres.mhzwrynnfphlxqcqytrj"

echo "📋 Connection details:"
echo "   Host: $DB_HOST"
echo "   Port: $DB_PORT"
echo "   User: $DB_USER"
echo "   Database: $DB_NAME"
echo ""

# Test 1: Basic connection test
echo "🧪 Test 1: Basic connection (with SSL, no GSSAPI)..."
export PGPASSWORD="$DB_PASSWORD"
export PGSSLMODE="require"
export PGGSSENCMODE="disable"

psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "SELECT 'Connection successful!' as status;" 2>&1

if [ $? -eq 0 ]; then
    echo "✅ Basic connection successful!"
    echo ""
    
    # Test 2: Check videos table
    echo "🧪 Test 2: Checking videos table..."
    psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "SELECT COUNT(*) as total_videos FROM videos;" 2>&1
    
    # Test 3: Check topic columns
    echo ""
    echo "🧪 Test 3: Checking topic columns exist..."
    psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "SELECT column_name FROM information_schema.columns WHERE table_name = 'videos' AND column_name LIKE 'topic%' ORDER BY column_name;" 2>&1
    
    # Test 4: Check current topic assignments
    echo ""
    echo "🧪 Test 4: Current topic assignment status..."
    psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "SELECT COUNT(*) as videos_with_topics FROM videos WHERE topic_level_1 IS NOT NULL;" 2>&1
    
else
    echo "❌ Connection failed!"
    echo ""
    echo "Troubleshooting:"
    echo "1. Check your password - get it from Supabase Dashboard > Settings > Database"
    echo "2. Make sure you're copying the password exactly (no extra spaces)"
    echo "3. Try this direct command with your password:"
    echo ""
    echo "PGPASSWORD='YOUR_PASSWORD' PGSSLMODE=require PGGSSENCMODE=disable psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -c \"SELECT 1;\""
fi

# Clean up
unset PGPASSWORD
unset PGSSLMODE
unset PGGSSENCMODE