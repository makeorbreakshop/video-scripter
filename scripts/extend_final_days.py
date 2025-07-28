#!/usr/bin/env python3
"""
Extend performance curves from current max (3,201 days) to 10 years (3,650 days)
"""

import os
import numpy as np
from supabase import create_client, Client
from dotenv import load_dotenv
from scipy.ndimage import gaussian_filter1d
from datetime import datetime
from collections import defaultdict

# Load environment variables
load_dotenv()

# Initialize Supabase client
url = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
supabase: Client = create_client(url, key)

print("🎯 Extending Performance Curves from 3,201 to 3,650 days")
print("=" * 60)

# Get existing data to understand the trend
print("\n📊 Getting existing curve data for smooth continuation...")
existing_data = supabase.table('performance_envelopes')\
    .select('*')\
    .gte('day_since_published', 3000)\
    .lte('day_since_published', 3201)\
    .order('day_since_published')\
    .execute()

print(f"   Retrieved {len(existing_data.data)} days of existing data")

# Process snapshots for days 3,202 to 3,650
print("\n📊 Processing snapshots for days 3,202-3,650...")

all_snapshots = []
offset = 0
batch_size = 1000
total_found = 0

while True:
    # Get batch of snapshots
    result = supabase.table('view_snapshots')\
        .select('days_since_published, view_count, videos(duration)')\
        .gte('days_since_published', 3202)\
        .lte('days_since_published', 3650)\
        .range(offset, offset + batch_size - 1)\
        .execute()
    
    if not result.data:
        break
    
    # Process each snapshot
    for row in result.data:
        if row.get('videos') and row['videos'].get('duration') and row['view_count']:
            dur = row['videos']['duration']
            
            # Check for non-Shorts
            is_long_video = False
            
            if 'H' in dur:
                is_long_video = True
            elif 'M' in dur and 'PT' in dur:
                try:
                    minutes = int(dur.split('M')[0].split('PT')[-1])
                    if minutes >= 2:
                        is_long_video = True
                except:
                    pass
            elif 'PT' in dur and 'S' in dur and not 'M' in dur:
                try:
                    seconds = int(dur.split('S')[0].split('PT')[-1])
                    if seconds > 121:
                        is_long_video = True
                except:
                    pass
            
            if is_long_video:
                all_snapshots.append({
                    'day': row['days_since_published'],
                    'views': row['view_count']
                })
                total_found += 1
    
    offset += batch_size
    if len(result.data) < batch_size:
        break

print(f"   Found {total_found:,} non-Short snapshots for days 3,202-3,650")

# Calculate percentiles for new days
print("\n📈 Calculating percentiles for new days...")
views_by_day = defaultdict(list)

for snap in all_snapshots:
    views_by_day[snap['day']].append(snap['views'])

new_percentile_data = []
for day in range(3202, 3651):
    if day in views_by_day and len(views_by_day[day]) >= 5:  # Lower threshold for sparse data
        views = views_by_day[day]
        new_percentile_data.append({
            'day': day,
            'count': len(views),
            'p10': np.percentile(views, 10),
            'p25': np.percentile(views, 25),
            'p50': np.percentile(views, 50),
            'p75': np.percentile(views, 75),
            'p90': np.percentile(views, 90),
            'p95': np.percentile(views, 95)
        })

print(f"   Days with sufficient new data: {len(new_percentile_data)}")

# Get trend from existing data for extrapolation
if existing_data.data:
    # Extract the trend from last 200 days
    trend_days = [d['day_since_published'] for d in existing_data.data]
    trend_p50 = [d['p50_views'] for d in existing_data.data]
    
    # Fit a simple linear trend for extrapolation
    if len(trend_days) > 10:
        z = np.polyfit(trend_days, trend_p50, 1)
        trend_func = np.poly1d(z)
        
        # Calculate growth rate
        daily_growth = z[0]
        print(f"\n📊 Detected daily growth rate: {daily_growth:.1f} views/day")

# Create updates for days 3,202 to 3,650
print("\n💾 Preparing updates for database...")
updates = []

for day in range(3202, 3651):
    # Check if we have actual data for this day
    actual_data = next((d for d in new_percentile_data if d['day'] == day), None)
    
    if actual_data:
        # Use actual data
        updates.append({
            'day_since_published': day,
            'p10_views': int(actual_data['p10']),
            'p25_views': int(actual_data['p25']),
            'p50_views': int(actual_data['p50']),
            'p75_views': int(actual_data['p75']),
            'p90_views': int(actual_data['p90']),
            'p95_views': int(actual_data['p95']),
            'sample_count': actual_data['count'],
            'updated_at': datetime.now().isoformat()
        })
    else:
        # Extrapolate from existing trend
        # Get the last known values
        last_day = existing_data.data[-1]
        days_diff = day - last_day['day_since_published']
        
        # Simple linear extrapolation with slight growth
        growth_factor = 1 + (days_diff * 0.00005)  # Very slight growth
        
        updates.append({
            'day_since_published': day,
            'p10_views': int(last_day['p10_views'] * growth_factor),
            'p25_views': int(last_day['p25_views'] * growth_factor),
            'p50_views': int(last_day['p50_views'] * growth_factor),
            'p75_views': int(last_day['p75_views'] * growth_factor),
            'p90_views': int(last_day['p90_views'] * growth_factor),
            'p95_views': int(last_day['p95_views'] * growth_factor),
            'sample_count': 0,  # Mark as extrapolated
            'updated_at': datetime.now().isoformat()
        })

print(f"   Prepared {len(updates)} updates")

# Update database
print("\n💾 Updating database...")
batch_size = 50
for i in range(0, len(updates), batch_size):
    batch = updates[i:i+batch_size]
    for update in batch:
        supabase.table('performance_envelopes')\
            .upsert(update, on_conflict='day_since_published')\
            .execute()
    print(f"   Updated days {3202+i} to {min(3202+i+batch_size-1, 3650)}")

print("\n✅ SUCCESS! Extended performance curves to full 10 years (3,650 days)!")

# Verify the extension
max_check = supabase.table('performance_envelopes')\
    .select('day_since_published')\
    .order('day_since_published', desc=True)\
    .limit(1)\
    .execute()

if max_check.data:
    print(f"   Verified: Performance envelopes now cover 0-{max_check.data[0]['day_since_published']} days")