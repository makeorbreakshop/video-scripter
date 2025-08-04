#!/bin/bash

# Direct psql connection with proper SSL settings for Supabase
# This bypasses ALL timeouts

echo "🔄 Direct PostgreSQL Connection to Supabase"
echo ""
echo "📝 Instructions:"
echo "1. Go to Supabase Dashboard > Settings > Database"
echo "2. Find 'Connection string' section"
echo "3. Copy the PSQL command (not the URI)"
echo ""
echo "It should look like:"
echo "psql -h aws-0-us-west-1.pooler.supabase.com -p 6543 -d postgres -U postgres.mhzwrynnfphlxqcqytrj"
echo ""
echo "4. When prompted for password, use your database password"
echo ""
echo "5. Once connected, run these commands:"
echo ""
echo "-- First set a long timeout"
echo "SET statement_timeout = '4h';"
echo ""
echo "-- Then run the update SQL"
echo "\i sql/direct-postgres-update.sql"
echo ""
echo "Alternative connection with SSL mode:"
echo ""

# Try different SSL modes to bypass GSSAPI error
PSQL_PATH="/opt/homebrew/opt/postgresql@16/bin/psql"

echo "Option 1 - Disable GSSAPI:"
echo "$PSQL_PATH 'postgresql://postgres.mhzwrynnfphlxqcqytrj:[PASSWORD]@aws-0-us-west-1.pooler.supabase.com:6543/postgres?sslmode=require&gssencmode=disable'"
echo ""

echo "Option 2 - Use environment variables:"
echo "export PGGSSENCMODE=disable"
echo "export PGSSLMODE=require"
echo "$PSQL_PATH -h aws-0-us-west-1.pooler.supabase.com -p 6543 -d postgres -U postgres.mhzwrynnfphlxqcqytrj"
echo ""

echo "Option 3 - Use .pgpass file:"
echo "echo 'aws-0-us-west-1.pooler.supabase.com:6543:postgres:postgres.mhzwrynnfphlxqcqytrj:[PASSWORD]' >> ~/.pgpass"
echo "chmod 600 ~/.pgpass"
echo "$PSQL_PATH -h aws-0-us-west-1.pooler.supabase.com -p 6543 -d postgres -U postgres.mhzwrynnfphlxqcqytrj"