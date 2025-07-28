#!/usr/bin/env python3
"""
Generate individual channel performance curves - simplified version
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

print("📊 Generating Individual Channel Performance Curves")
print("=" * 60)

# Top 5 channels with sufficient data
ready_channels = [
    {'channel_id': 'UCBJycsmduvYEL83R_U4JriQ', 'channel_name': 'Marques Brownlee'},
    {'channel_id': 'UC7ZddA__ewP3AtDefjl_tWg', 'channel_name': 'I Will Teach You To Be Rich'},
    {'channel_id': 'UCGh9zg0zvyF3GqHeR4WR3Xg', 'channel_name': 'Cruise With Ben and David'},
    {'channel_id': 'UCI8gcSTo1FowsRJdilsjsZw', 'channel_name': 'Grace For Purpose'},
    {'channel_id': 'UC70SrI3VkT1MXALRtf0pcHg', 'channel_name': 'Thomas DeLauer'}
]

print(f"Processing {len(ready_channels)} channels")

# Create channel_performance_envelopes table using MCP
print("\n🏗️ Setting up channel curves table...")

# Strategic day sampling for optimization
key_days = []
key_days.extend(range(0, 91, 1))    # Days 0-90: daily
key_days.extend(range(91, 366, 3))  # Days 91-365: every 3 days
key_days.extend(range(366, 1826, 7)) # Year 2-5: weekly
key_days.extend(range(1826, 3651, 30)) # Year 6-10: monthly

print(f"Processing {len(key_days)} strategic days per channel")

# Process each channel
all_updates = []
processed_channels = 0

for channel in ready_channels:
    channel_id = channel['channel_id']
    channel_name = channel['channel_name']
    
    print(f"\n📈 Processing: {channel_name}")
    
    channel_stats = {}
    total_processed = 0
    
    for day in key_days:
        # Get view snapshots for this channel and day
        try:
            # Get all videos for this channel first
            videos_result = supabase.table('videos')\
                .select('id')\
                .eq('channel_id', channel_id)\
                .execute()
            
            if not videos_result.data:
                continue
                
            video_ids = [v['id'] for v in videos_result.data]
            
            # Get view snapshots for these videos on this day
            snapshots_result = supabase.table('view_snapshots')\
                .select('view_count')\
                .eq('days_since_published', day)\
                .in_('video_id', video_ids)\
                .not_.is_('view_count', 'null')\
                .execute()
            
            if snapshots_result.data:
                views = [row['view_count'] for row in snapshots_result.data if row['view_count'] is not None]
                total_processed += len(views)
                
                if len(views) >= 3:  # Minimum for percentiles
                    views_array = np.array(views)
                    channel_stats[day] = {
                        'p10': int(np.percentile(views_array, 10)),
                        'p25': int(np.percentile(views_array, 25)),
                        'p50': int(np.percentile(views_array, 50)),
                        'p75': int(np.percentile(views_array, 75)),
                        'p90': int(np.percentile(views_array, 90)),
                        'p95': int(np.percentile(views_array, 95)),
                        'count': len(views)
                    }
        except Exception as e:
            print(f"   Error processing day {day}: {e}")
            continue
        
        # Progress update every 50 days
        if day % 50 == 0:
            print(f"   Day {day}: {total_processed} snapshots processed")
    
    if len(channel_stats) < 10:
        print(f"   ❌ Insufficient data points ({len(channel_stats)}), skipping")
        continue
    
    print(f"   ✅ Processed {total_processed} snapshots across {len(channel_stats)} days")
    
    # Apply light smoothing to preserve channel-specific patterns
    days = sorted(channel_stats.keys())
    metrics = ['p10', 'p25', 'p50', 'p75', 'p90', 'p95']
    
    for metric in metrics:
        values = [channel_stats[d][metric] for d in days]
        # Very light smoothing
        smooth_values = gaussian_filter1d(values, sigma=1.0)
        
        for i, day in enumerate(days):
            channel_stats[day][metric] = int(smooth_values[i])
    
    # Calculate confidence based on data sufficiency
    total_samples = sum(stats['count'] for stats in channel_stats.values())
    confidence = min(1.0, total_samples / 300.0)  # Full confidence at 300+ samples
    
    # Interpolate missing days for full 10-year coverage
    all_days_data = {}
    for day in range(0, 3651):
        if day in channel_stats:
            all_days_data[day] = channel_stats[day]
        else:
            # Linear interpolation
            before = max([d for d in days if d < day], default=0)
            after = min([d for d in days if d > day], default=days[-1])
            
            if before in channel_stats and after in channel_stats:
                weight = (day - before) / (after - before) if after != before else 0
                all_days_data[day] = {}
                
                for metric in metrics:
                    val = channel_stats[before][metric] + weight * (channel_stats[after][metric] - channel_stats[before][metric])
                    all_days_data[day][metric] = int(val)
                
                all_days_data[day]['count'] = 0  # Interpolated
    
    # Show sample results for this channel
    print(f"   📊 Sample curve points:")
    for sample_day in [1, 30, 365]:
        if sample_day in all_days_data:
            views = all_days_data[sample_day]['p50']
            print(f"     Day {sample_day}: {views:,} views")
    
    processed_channels += 1

print(f"\n✅ Individual Channel Curves Analysis Complete!")
print(f"   Channels processed: {processed_channels}")
print(f"   Coverage: 10 years (3,651 days) per channel")
print(f"   Next step: Create database table and store curves")