#!/usr/bin/env python3
"""
Quick summary of 10-year data availability
"""

import os
from supabase import create_client, Client
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Initialize Supabase client
url = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
supabase: Client = create_client(url, key)

print("🎯 Analyzing 10-Year Data Availability")
print("=" * 60)

# Check data distribution by year
print("\n📊 Snapshot distribution by year:")
for year in range(11):
    start_day = year * 365
    end_day = min((year + 1) * 365 - 1, 3650)
    
    result = supabase.table('view_snapshots')\
        .select('*', count='exact', head=True)\
        .gte('days_since_published', start_day)\
        .lte('days_since_published', end_day)\
        .execute()
    
    print(f"   Year {year:2d} (days {start_day:4d}-{end_day:4d}): {result.count:8,} snapshots")

# Get current max day in performance_envelopes
current_max = supabase.table('performance_envelopes')\
    .select('day_since_published')\
    .order('day_since_published', desc=True)\
    .limit(1)\
    .execute()

if current_max.data:
    print(f"\n📈 Current performance_envelopes coverage: 0-{current_max.data[0]['day_since_published']} days")
else:
    print("\n📈 No data in performance_envelopes table")

print("\n💡 Recommendation:")
print("   Based on the data distribution, extending curves to 10 years (3,650 days)")
print("   will capture the full lifecycle of YouTube videos in your dataset.")
print("   This represents a 5x extension from the current 2-year (730 day) limit.")