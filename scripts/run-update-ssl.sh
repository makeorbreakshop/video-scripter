#!/bin/bash

echo "Running hierarchy update with SSL..."

# Use the full connection string with SSL mode
/opt/homebrew/opt/postgresql@16/bin/psql \
  "postgres://postgres.mhzwrynnfphlxqcqytrj:VnQK7jhKQJOT73H5@aws-0-us-west-1.pooler.supabase.com:6543/postgres?sslmode=require" \
  -f sql/update-hierarchy-complete-efficient.sql

echo "Done!"