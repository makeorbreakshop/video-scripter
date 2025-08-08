#!/usr/bin/env python3

import os
import psycopg2
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Direct database connection
DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    print("ERROR: DATABASE_URL not found in .env")
    exit(1)

print("=" * 60)
print("SETTING UP PERFORMANCE SCORING SYSTEM")
print("=" * 60)

# Read the SQL file
with open('sql/create-stored-performance-system.sql', 'r') as f:
    sql_content = f.read()

# Connect to database
conn = psycopg2.connect(DATABASE_URL)
cur = conn.cursor()

try:
    print("\n📝 Creating tables and functions...")
    
    # Execute the entire SQL file
    cur.execute(sql_content)
    conn.commit()
    
    print("✅ All functions and tables created successfully!")
    
    print("\n" + "=" * 60)
    print("SETUP COMPLETE!")
    print("=" * 60)
    
    print("\n📊 NEXT STEP:")
    print("Run this command to populate all data:")
    print("\n  python scripts/run-performance-update.py")
    print("\nThis will:")
    print("  1. Calculate channel performance ratios for all channels")
    print("  2. Update all 196K video scores with channel adjustments")
    print("  3. Take approximately 2-3 minutes to complete")
    
except Exception as e:
    print(f"\n❌ Error: {e}")
    conn.rollback()
finally:
    cur.close()
    conn.close()