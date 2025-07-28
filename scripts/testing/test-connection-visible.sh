#!/bin/bash

# Test database connection with visible password input

echo "🔍 Database Connection Test (Visible)"
echo "====================================="
echo ""

# Add PostgreSQL to PATH
export PATH="/opt/homebrew/opt/postgresql@16/bin:$PATH"

# Check if psql is installed
if ! command -v psql &> /dev/null; then
    echo "❌ Error: psql is not installed"
    exit 1
fi

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

# Prompt for password (VISIBLE)
echo -n "Enter your Supabase database password (will be visible): "
read DB_PASSWORD
echo ""

echo "🔑 You entered: $DB_PASSWORD"
echo ""

# Set environment variables
export PGPASSWORD="$DB_PASSWORD"
export PGSSLMODE="require"
export PGGSSENCMODE="disable"

echo "🧪 Testing connection..."
echo "Running: psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -c \"SELECT 'Connection successful!' as status;\""
echo ""

# Test connection
psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "SELECT 'Connection successful!' as status;"

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Connection successful!"
    echo ""
    echo "🧪 Testing write permissions..."
    psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "UPDATE videos SET updated_at = NOW() WHERE id = '7bI6G621Rxg' RETURNING id;"
    
    if [ $? -eq 0 ]; then
        echo "✅ Write permissions confirmed!"
        echo ""
        echo "📋 You can now run the bulk update with this password!"
    else
        echo "❌ No write permissions"
    fi
else
    echo ""
    echo "❌ Connection failed!"
    echo ""
    echo "Double-check:"
    echo "1. Password is exactly as shown in Supabase (no extra spaces)"
    echo "2. You're using the Database Password, not API keys"
fi

# Clean up
unset PGPASSWORD
unset PGSSLMODE
unset PGGSSENCMODE