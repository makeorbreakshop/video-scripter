#!/usr/bin/env python3
"""
Test individual channel curve generation with Marques Brownlee data
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

print("📊 Testing Individual Channel Curve: Marques Brownlee")
print("=" * 60)

channel_id = 'UCBJycsmduvYEL83R_U4JriQ'
channel_name = 'Marques Brownlee'

# Get total videos for this channel
videos_result = supabase.table('videos')\
    .select('id', count='exact')\
    .eq('channel_id', channel_id)\
    .execute()

print(f"Channel: {channel_name}")
print(f"Total videos: {videos_result.count}")

# Strategic day sampling - focus on first year for testing
test_days = list(range(0, 91, 3)) + list(range(91, 366, 7))  # Every 3 days for 0-90, weekly for 91-365
print(f"Testing {len(test_days)} days")

channel_stats = {}
total_processed = 0

for i, day in enumerate(test_days):
    try:
        # Get video IDs for this channel (batch approach)
        videos_batch = supabase.table('videos')\
            .select('id')\
            .eq('channel_id', channel_id)\
            .limit(1000)\
            .execute()
        
        if not videos_batch.data:
            continue
            
        video_ids = [v['id'] for v in videos_batch.data]
        
        # Get snapshots for this day
        snapshots_result = supabase.table('view_snapshots')\
            .select('view_count')\
            .eq('days_since_published', day)\
            .in_('video_id', video_ids[:50])\
            .not_.is_('view_count', 'null')\
            .execute()
        
        if snapshots_result.data:
            views = [row['view_count'] for row in snapshots_result.data if row['view_count'] is not None]
            total_processed += len(views)
            
            if len(views) >= 2:  # Minimum for analysis
                views_array = np.array(views)
                channel_stats[day] = {
                    'p25': int(np.percentile(views_array, 25)),
                    'p50': int(np.percentile(views_array, 50)),
                    'p75': int(np.percentile(views_array, 75)),
                    'count': len(views)
                }
                
                if day <= 30:  # Show details for first month
                    print(f"   Day {day:2d}: {len(views):2d} videos, median {views_array.median():,.0f} views")
    
    except Exception as e:
        print(f"   Error on day {day}: {e}")
        continue
    
    # Progress every 10 days
    if i % 10 == 0:
        print(f"   Progress: {i}/{len(test_days)} days, {total_processed} snapshots")

print(f"\n✅ Analysis Complete")
print(f"   Data points: {len(channel_stats)} days")
print(f"   Total snapshots: {total_processed}")

if len(channel_stats) >= 10:
    # Show growth pattern
    days = sorted(channel_stats.keys())
    print(f"\n📈 Growth Pattern (Median Views):")
    
    sample_days = [d for d in [1, 7, 14, 30, 90, 180, 365] if d in channel_stats]
    for day in sample_days:
        views = channel_stats[day]['p50']
        count = channel_stats[day]['count']
        print(f"   Day {day:3d}: {views:8,} views ({count} videos)")
    
    # Calculate channel vs global comparison
    print(f"\n🔄 Comparing to Global Curves:")
    
    # Get global curves for comparison
    global_result = supabase.table('performance_envelopes')\
        .select('day_since_published, p50_views')\
        .in_('day_since_published', sample_days)\
        .execute()
    
    global_data = {row['day_since_published']: row['p50_views'] for row in global_result.data}
    
    for day in sample_days:
        if day in global_data:
            channel_views = channel_stats[day]['p50']
            global_views = global_data[day]
            ratio = channel_views / global_views if global_views > 0 else 0
            print(f"   Day {day:3d}: {ratio:.2f}x global ({channel_views:,} vs {global_views:,})")
else:
    print(f"❌ Insufficient data points: {len(channel_stats)}")

print(f"\n🎯 Next Steps:")
print(f"   1. Create channel_performance_envelopes table")
print(f"   2. Generate curves for all qualifying channels")
print(f"   3. Update API endpoints to use channel curves when available")