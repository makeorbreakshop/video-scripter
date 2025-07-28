#!/usr/bin/env python3
"""
Quick refresh global performance curves with optimized batch processing
"""

import os
import numpy as np
from supabase import create_client, Client
from dotenv import load_dotenv
from datetime import datetime
from scipy.ndimage import gaussian_filter1d

# Load environment variables
load_dotenv()

# Initialize Supabase client
url = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
supabase: Client = create_client(url, key)

print("🔄 Quick Refresh Global Performance Curves")
print("=" * 60)

# Get current snapshot count
count_result = supabase.table('view_snapshots')\
    .select('*', count='exact', head=True)\
    .execute()

total_snapshots = count_result.count
print(f"Total snapshots: {total_snapshots:,}")

# Process key days only for speed (every 10 days for first year, then every 30)
key_days = []
key_days.extend(range(0, 91, 1))    # Days 0-90: daily
key_days.extend(range(91, 366, 3))  # Days 91-365: every 3 days  
key_days.extend(range(366, 1826, 7)) # Year 2-5: weekly
key_days.extend(range(1826, 3651, 30)) # Year 6-10: monthly

print(f"Processing {len(key_days)} key days...")

daily_stats = {}
processed = 0

for i, day in enumerate(key_days):
    # Get view counts for this day (filter Shorts via duration)
    query = supabase.table('view_snapshots')\
        .select('view_count, videos!inner(duration)')\
        .eq('days_since_published', day)
    
    # Get all data for this day
    all_data = []
    batch_size = 1000
    offset = 0
    
    while True:
        batch = query.range(offset, offset + batch_size - 1).execute()
        if not batch.data:
            break
            
        # Filter for non-Shorts
        for row in batch.data:
            if row.get('videos') and row['videos'].get('duration'):
                dur = row['videos']['duration']
                # Quick non-Short check
                is_long = 'H' in dur or ('M' in dur and 'PT' in dur)
                if not is_long and 'PT' in dur and 'S' in dur and 'M' not in dur:
                    try:
                        secs = int(dur.split('S')[0].split('PT')[-1])
                        is_long = secs > 121
                    except:
                        pass
                
                if is_long and row['view_count'] is not None:
                    all_data.append(row['view_count'])
        
        offset += batch_size
        if len(batch.data) < batch_size:
            break
    
    processed += len(all_data)
    
    if len(all_data) >= 10:  # Minimum for reliable percentiles
        views = np.array(all_data)
        daily_stats[day] = {
            'p10': int(np.percentile(views, 10)),
            'p25': int(np.percentile(views, 25)),
            'p50': int(np.percentile(views, 50)),
            'p75': int(np.percentile(views, 75)),
            'p90': int(np.percentile(views, 90)),
            'p95': int(np.percentile(views, 95)),
            'count': len(all_data)
        }
    
    if i % 50 == 0:
        print(f"   Processed {i}/{len(key_days)} days ({processed:,} snapshots)")

print(f"\nProcessed {processed:,} snapshots across {len(daily_stats)} days")

# Apply light smoothing only
print("📈 Applying smoothing...")
days = sorted(daily_stats.keys())
metrics = ['p10', 'p25', 'p50', 'p75', 'p90', 'p95']

for metric in metrics:
    values = [daily_stats[d][metric] for d in days]
    smooth_values = gaussian_filter1d(values, sigma=2.0)
    
    for i, day in enumerate(days):
        daily_stats[day][metric] = int(smooth_values[i])

# Interpolate missing days
print("🔄 Interpolating missing days...")
all_days_data = {}
for day in range(0, 3651):
    if day in daily_stats:
        all_days_data[day] = daily_stats[day]
    else:
        # Find nearest days with data
        before = max([d for d in days if d < day], default=0)
        after = min([d for d in days if d > day], default=days[-1])
        
        if before in daily_stats and after in daily_stats:
            # Linear interpolation
            weight = (day - before) / (after - before) if after != before else 0
            all_days_data[day] = {}
            
            for metric in metrics:
                val = daily_stats[before][metric] + weight * (daily_stats[after][metric] - daily_stats[before][metric])
                all_days_data[day][metric] = int(val)
            
            all_days_data[day]['count'] = 0  # Interpolated

# Update database
print("💾 Updating database...")
updates = []
current_time = datetime.now().isoformat()

for day in range(0, 3651):
    if day in all_days_data:
        updates.append({
            'day_since_published': day,
            'p10_views': all_days_data[day]['p10'],
            'p25_views': all_days_data[day]['p25'],
            'p50_views': all_days_data[day]['p50'],
            'p75_views': all_days_data[day]['p75'],
            'p90_views': all_days_data[day]['p90'],
            'p95_views': all_days_data[day]['p95'],
            'sample_count': all_days_data[day]['count'],
            'updated_at': current_time
        })

# Batch upsert
batch_size = 200
for i in range(0, len(updates), batch_size):
    batch = updates[i:i + batch_size]
    supabase.table('performance_envelopes')\
        .upsert(batch)\
        .execute()
    print(f"   Updated batch {i//batch_size + 1}/{(len(updates)-1)//batch_size + 1}")

print("\n✅ Quick Refresh Complete!")
print(f"   Days updated: {len(updates)}")
print(f"   Samples processed: {processed:,}")
print(f"   Key growth points:")
print(f"     Day 1:   {all_days_data.get(1, {}).get('p50', 'N/A'):,} views")
print(f"     Day 7:   {all_days_data.get(7, {}).get('p50', 'N/A'):,} views") 
print(f"     Day 30:  {all_days_data.get(30, {}).get('p50', 'N/A'):,} views")
print(f"     Day 365: {all_days_data.get(365, {}).get('p50', 'N/A'):,} views")