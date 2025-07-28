#!/usr/bin/env python3
"""
Simple script to check if a video is performing better or worse than median
Uses the performance envelopes we already calculated
"""

import os
from supabase import create_client, Client
from dotenv import load_dotenv
import sys

# Load environment variables
load_dotenv()

# Initialize Supabase client
url = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
supabase: Client = create_client(url, key)

def check_video_performance(video_id):
    """Check if a video is over or underperforming based on its age and channel"""
    
    # Get video details and latest snapshot
    video_result = supabase.table('videos')\
        .select('id, title, channel_id, channel_name, published_at')\
        .eq('id', video_id)\
        .single()\
        .execute()
    
    if not video_result.data:
        print(f"Video {video_id} not found")
        return
    
    video = video_result.data
    
    # Get latest view snapshot
    snapshot_result = supabase.table('view_snapshots')\
        .select('view_count, days_since_published, snapshot_date')\
        .eq('video_id', video_id)\
        .order('snapshot_date', desc=True)\
        .limit(1)\
        .execute()
    
    if not snapshot_result.data:
        print(f"No view data for video: {video['title']}")
        return
    
    snapshot = snapshot_result.data[0]
    current_views = snapshot['view_count']
    days_old = snapshot['days_since_published']
    
    # Get expected performance from global curve
    envelope_result = supabase.table('performance_envelopes')\
        .select('p50_views')\
        .eq('day_since_published', min(days_old, 3650))\
        .single()\
        .execute()
    
    if not envelope_result.data:
        print(f"No envelope data for day {days_old}")
        return
    
    global_expected = envelope_result.data['p50_views']
    
    # Get channel baseline (median of channel's plateau videos)
    channel_videos = supabase.table('view_snapshots')\
        .select('view_count, video_id')\
        .eq('videos.channel_id', video['channel_id'])\
        .gte('days_since_published', 90)\
        .lte('days_since_published', 365)\
        .execute()
    
    if len(channel_videos.data) >= 5:
        # Use channel-specific baseline
        channel_views = [v['view_count'] for v in channel_videos.data]
        channel_median = sorted(channel_views)[len(channel_views)//2]
        
        # Get global plateau median
        global_plateau_result = supabase.table('performance_envelopes')\
            .select('p50_views')\
            .eq('day_since_published', 365)\
            .single()\
            .execute()
        
        global_plateau = global_plateau_result.data['p50_views']
        scale_factor = channel_median / global_plateau
    else:
        # Not enough channel data, use global baseline
        scale_factor = 1.0
    
    # Calculate expected views for this video
    expected_views = global_expected * scale_factor
    
    # Calculate performance ratio
    performance_ratio = current_views / expected_views if expected_views > 0 else 0
    
    # Classify performance
    if performance_ratio > 3.0:
        category = "🚀 VIRAL"
        color = "\033[95m"  # Magenta
    elif performance_ratio > 1.5:
        category = "📈 OUTPERFORMING"
        color = "\033[92m"  # Green
    elif performance_ratio > 0.5:
        category = "✅ ON TRACK"
        color = "\033[94m"  # Blue
    elif performance_ratio > 0.2:
        category = "📉 UNDERPERFORMING"
        color = "\033[93m"  # Yellow
    else:
        category = "⚠️  POOR"
        color = "\033[91m"  # Red
    
    # Print results
    print(f"\n{'='*60}")
    print(f"VIDEO: {video['title']}")
    print(f"Channel: {video['channel_name']}")
    print(f"{'='*60}")
    print(f"Age: {days_old} days")
    print(f"Current Views: {current_views:,}")
    print(f"Expected Views: {int(expected_views):,}")
    print(f"Channel Scale Factor: {scale_factor:.2f}x")
    print(f"\n{color}Performance: {performance_ratio:.2f}x expected")
    print(f"Status: {category}\033[0m")
    print(f"{'='*60}\n")

if __name__ == "__main__":
    if len(sys.argv) > 1:
        video_id = sys.argv[1]
    else:
        # Get a random video as example
        result = supabase.table('videos')\
            .select('id')\
            .not_('channel_id', 'is', None)\
            .limit(1)\
            .execute()
        video_id = result.data[0]['id'] if result.data else None
    
    if video_id:
        check_video_performance(video_id)
    else:
        print("Please provide a video ID")