#!/usr/bin/env python3
"""
Create individual channel curve for Marques Brownlee using all available data
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

print("📊 Creating Marques Brownlee Channel Curve")
print("=" * 60)

channel_id = 'UCBJycsmduvYEL83R_U4JriQ'
channel_name = 'Marques Brownlee'

# Get all view snapshots for this channel in one go
print("📥 Fetching all view snapshots...")

all_snapshots = []
offset = 0
batch_size = 1000

while True:
    # Get snapshots with video info
    batch = supabase.table('view_snapshots')\
        .select('days_since_published, view_count, videos!inner(channel_id, duration)')\
        .eq('videos.channel_id', channel_id)\
        .range(offset, offset + batch_size - 1)\
        .execute()
    
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
                all_snapshots.append({
                    'day': row['days_since_published'],
                    'views': row['view_count']
                })
    
    offset += batch_size
    if len(batch.data) < batch_size:
        break
    
    print(f"   Processed {offset} records, found {len(all_snapshots)} valid snapshots")

print(f"✅ Found {len(all_snapshots)} valid snapshots")

# Group by day and calculate percentiles
print("📊 Calculating daily percentiles...")

daily_data = {}
for snapshot in all_snapshots:
    day = snapshot['day']
    if day not in daily_data:
        daily_data[day] = []
    daily_data[day].append(snapshot['views'])

# Calculate percentiles for days with sufficient data
channel_stats = {}
for day, views_list in daily_data.items():
    if len(views_list) >= 1:  # Even single data points are valuable for sparse channels
        views_array = np.array(views_list)
        channel_stats[day] = {
            'p10': int(np.percentile(views_array, 10)),
            'p25': int(np.percentile(views_array, 25)),
            'p50': int(np.percentile(views_array, 50)),
            'p75': int(np.percentile(views_array, 75)),
            'p90': int(np.percentile(views_array, 90)),
            'p95': int(np.percentile(views_array, 95)),
            'count': len(views_list)
        }

print(f"📈 Generated percentiles for {len(channel_stats)} days")

# Show age distribution
ages = sorted(channel_stats.keys())
print(f"   Age range: Day {min(ages)} to Day {max(ages)}")
print(f"   First year data points: {len([d for d in ages if d <= 365])}")
print(f"   Total data coverage: {len(ages)} days")

# Apply light smoothing
if len(channel_stats) >= 10:
    print("🔧 Applying smoothing...")
    days = sorted(channel_stats.keys())
    metrics = ['p10', 'p25', 'p50', 'p75', 'p90', 'p95']
    
    for metric in metrics:
        values = [channel_stats[d][metric] for d in days]
        # Very light smoothing to preserve channel characteristics
        smooth_values = gaussian_filter1d(values, sigma=2.0)
        
        for i, day in enumerate(days):
            channel_stats[day][metric] = int(smooth_values[i])

# Show sample results
print(f"\n📊 Sample Channel Curve (Median Views):")
sample_days = [1, 7, 30, 90, 180, 365, 730, 1825]
for day in sample_days:
    if day in channel_stats:
        views = channel_stats[day]['p50']
        count = channel_stats[day]['count']
        print(f"   Day {day:4d}: {views:8,} views ({count} videos)")

# Compare to global curve
print(f"\n🌍 Channel vs Global Performance:")
global_result = supabase.table('performance_envelopes')\
    .select('day_since_published, p50_views')\
    .in_('day_since_published', [d for d in sample_days if d in channel_stats])\
    .execute()

global_data = {row['day_since_published']: row['p50_views'] for row in global_result.data}

channel_scale_factors = []
for day in sample_days:
    if day in channel_stats and day in global_data:
        channel_views = channel_stats[day]['p50']
        global_views = global_data[day]
        if global_views > 0:
            ratio = channel_views / global_views
            channel_scale_factors.append(ratio)
            print(f"   Day {day:4d}: {ratio:.2f}x global ({channel_views:,} vs {global_views:,})")

if channel_scale_factors:
    avg_scale = np.median(channel_scale_factors)
    print(f"\n📏 Marques Brownlee Channel Scale: {avg_scale:.2f}x global median")

# Calculate confidence score
total_videos = sum(stats['count'] for stats in channel_stats.values())
confidence = min(1.0, total_videos / 1000.0)  # Full confidence at 1000+ videos
print(f"🎯 Confidence Score: {confidence:.2f} ({total_videos} total videos)")

print(f"\n✅ Marques Brownlee Channel Analysis Complete!")
print(f"   Ready for database storage with {len(channel_stats)} curve points")
print(f"   Recommended: Proceed with creating channel_performance_envelopes table")