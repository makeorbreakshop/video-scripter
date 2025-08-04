#!/bin/bash

# Direct PostgreSQL connection script for BERTopic hierarchy update
# Uses psql with proper Supabase connection parameters

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}🔄 BERTopic Hierarchy Update via Direct PostgreSQL Connection${NC}\n"

# Check for required environment variables
if [ -z "$SUPABASE_DB_URL" ]; then
    echo -e "${RED}❌ Missing SUPABASE_DB_URL environment variable${NC}"
    echo -e "${YELLOW}📝 To get your database URL:${NC}"
    echo "   1. Go to Supabase Dashboard"
    echo "   2. Navigate to Settings → Database"
    echo "   3. Copy the 'Connection string' (URI format)"
    echo "   4. Add to .env as SUPABASE_DB_URL=postgres://..."
    echo ""
    echo -e "${YELLOW}💡 The URL should look like:${NC}"
    echo "   postgres://postgres.[project-ref]:[password]@aws-0-[region].pooler.supabase.com:5432/postgres"
    exit 1
fi

# Parse the database URL to handle special characters in password
DB_URL="$SUPABASE_DB_URL"

# Use the correct psql path from brew installation
PSQL_PATH="/opt/homebrew/opt/postgresql@16/bin/psql"

if [ ! -f "$PSQL_PATH" ]; then
    PSQL_PATH=$(which psql)
    if [ -z "$PSQL_PATH" ]; then
        echo -e "${RED}❌ psql not found. Please install PostgreSQL client${NC}"
        exit 1
    fi
fi

echo -e "${GREEN}✅ Found psql at: $PSQL_PATH${NC}"

# First, generate the SQL file
echo -e "\n${YELLOW}📝 Generating SQL update statements...${NC}"
node scripts/direct-db-update.js --generate-sql

if [ ! -f "sql/direct-postgres-update.sql" ]; then
    echo -e "${RED}❌ Failed to generate SQL file${NC}"
    exit 1
fi

echo -e "${GREEN}✅ SQL file generated successfully${NC}"

# Connect and execute
echo -e "\n${YELLOW}🔌 Connecting to database...${NC}"

# Use environment variable for password to avoid special character issues
export PGPASSWORD="${SUPABASE_DB_PASSWORD:-}"

# Execute the SQL file
$PSQL_PATH "$DB_URL" -f sql/direct-postgres-update.sql -v ON_ERROR_STOP=1

if [ $? -eq 0 ]; then
    echo -e "\n${GREEN}✅ Update completed successfully!${NC}"
else
    echo -e "\n${RED}❌ Update failed. Check the error messages above.${NC}"
    exit 1
fi

# Verify the update
echo -e "\n${YELLOW}🔍 Verifying update...${NC}"

$PSQL_PATH "$DB_URL" -c "
SELECT 
    COUNT(*) as total_videos,
    COUNT(DISTINCT topic_cluster_id) as unique_clusters,
    COUNT(CASE WHEN topic_domain NOT LIKE 'domain_%' THEN 1 END) as properly_updated
FROM videos
WHERE topic_cluster_id IS NOT NULL
    AND topic_domain IS NOT NULL
    AND topic_niche IS NOT NULL
    AND topic_micro IS NOT NULL;
"

echo -e "\n${GREEN}✅ All done!${NC}"