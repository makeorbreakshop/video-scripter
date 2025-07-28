#!/usr/bin/env python3
"""
Check if curves need updating and show the impact
"""

import os
from supabase import create_client, Client
from dotenv import load_dotenv
import numpy as np

# Load environment variables
load_dotenv()

# Initialize Supabase client
url = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
supabase: Client = create_client(url, key)

print("📊 Checking Curve Update Status")
print("=" * 60)

# Get metadata about current curves
curve_info = supabase.table('performance_envelopes')\
    .select('updated_at, sample_count')\
    .order('updated_at', desc=True)\
    .limit(1)\
    .execute()

if curve_info.data:
    last_update = curve_info.data[0]['updated_at']
    print(f"Last curve update: {last_update}")

# Get count of new snapshots since last update
new_count_result = supabase.table('view_snapshots')\
    .select('*', count='exact', head=True)\
    .gte('created_at', last_update)\
    .execute()

new_snapshots = new_count_result.count

# Get total snapshots
total_result = supabase.table('view_snapshots')\
    .select('*', count='exact', head=True)\
    .execute()

total_snapshots = total_result.count

# Calculate staleness
percent_new = (new_snapshots / total_snapshots) * 100 if total_snapshots > 0 else 0

print(f"\nSnapshot Statistics:")
print(f"   Total snapshots: {total_snapshots:,}")
print(f"   New since last update: {new_snapshots:,}")
print(f"   Percentage new: {percent_new:.1f}%")

# Sample a few key days to see potential impact
print("\n🔍 Sampling impact on key days...")

for day in [1, 7, 30, 90, 365]:
    # Get current curve value
    current = supabase.table('performance_envelopes')\
        .select('p50_views')\
        .eq('day_since_published', day)\
        .single()\
        .execute()
    
    # Get sample of recent data for this day
    recent = supabase.table('view_snapshots')\
        .select('view_count')\
        .eq('days_since_published', day)\
        .gte('created_at', last_update)\
        .limit(100)\
        .execute()
    
    if current.data and recent.data:
        current_median = current.data['p50_views']
        recent_views = [r['view_count'] for r in recent.data if r['view_count']]
        if recent_views:
            recent_median = np.median(recent_views)
            change = ((recent_median - current_median) / current_median) * 100
            print(f"   Day {day}: Current={current_median:,}, Recent sample={int(recent_median):,} ({change:+.1f}%)")

# Recommendation
print("\n📋 Recommendation:")
if percent_new > 20:
    print("   ⚠️  HIGH STALENESS - Curves are significantly out of date")
    print("   → Run full update now, then set up weekly updates")
elif percent_new > 10:
    print("   🔶 MODERATE STALENESS - Curves could use an update")
    print("   → Update this weekend, then weekly schedule")
else:
    print("   ✅ LOW STALENESS - Curves are reasonably current")
    print("   → Can wait for scheduled weekly update")

print(f"\nEstimated update time: ~{int(total_snapshots / 100000)} minutes for full refresh")