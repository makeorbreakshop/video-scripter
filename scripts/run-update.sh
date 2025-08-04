#!/bin/bash

echo "Running hierarchy update..."

# Use the service role key to bypass RLS
export PGPASSWORD="VnQK7jhKQJOT73H5"

/opt/homebrew/opt/postgresql@16/bin/psql \
  -h aws-0-us-west-1.pooler.supabase.com \
  -p 6543 \
  -U postgres.mhzwrynnfphlxqcqytrj \
  -d postgres \
  -f sql/update-hierarchy-complete-efficient.sql

echo "Done!"