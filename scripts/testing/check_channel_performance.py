#!/usr/bin/env python3
"""
Check performance of all videos in a channel
Shows which videos are over/underperforming based on normalized expectations
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

def get_channel_performance(channel_id=None, limit=20):
    """Get performance ratios for videos in a channel"""
    
    # Get channel baseline first
    print("📊 Calculating channel baseline...")
    
    # Get plateau videos for this channel (90-365 days old)
    plateau_query = supabase.table('view_snapshots')\
        .select('view_count, videos!inner(channel_id)')
    
    if channel_id:
        plateau_query = plateau_query.eq('videos.channel_id', channel_id)
    
    plateau_data = plateau_query\
        .gte('days_since_published', 90)\
        .lte('days_since_published', 365)\
        .execute()
    
    if len(plateau_data.data) >= 10:
        channel_plateau_median = np.median([v['view_count'] for v in plateau_data.data])
        
        # Get global plateau median
        global_plateau = supabase.table('performance_envelopes')\
            .select('p50_views')\
            .eq('day_since_published', 365)\
            .single()\
            .execute()
        
        scale_factor = channel_plateau_median / global_plateau.data['p50_views']
    else:
        scale_factor = 1.0
        print("   ⚠️  Not enough channel data, using global baseline")
    
    print(f"   Channel scale factor: {scale_factor:.2f}x")
    
    # Get recent videos with their latest snapshots
    videos_query = supabase.table('videos')\
        .select('id, title, channel_name, published_at')
    
    if channel_id:
        videos_query = videos_query.eq('channel_id', channel_id)
    
    videos = videos_query\
        .order('published_at', desc=True)\
        .limit(limit)\
        .execute()
    
    results = []
    
    for video in videos.data:
        # Get latest snapshot
        snapshot = supabase.table('view_snapshots')\
            .select('view_count, days_since_published')\
            .eq('video_id', video['id'])\
            .order('snapshot_date', desc=True)\
            .limit(1)\
            .execute()
        
        if not snapshot.data:
            continue
        
        current_views = snapshot.data[0]['view_count']
        days_old = min(snapshot.data[0]['days_since_published'], 3650)
        
        # Get expected from global curve
        expected = supabase.table('performance_envelopes')\
            .select('p50_views')\
            .eq('day_since_published', days_old)\
            .single()\
            .execute()
        
        if not expected.data:
            continue
        
        # Calculate performance
        expected_views = expected.data['p50_views'] * scale_factor
        ratio = current_views / expected_views if expected_views > 0 else 0
        
        results.append({
            'title': video['title'][:50],
            'days_old': days_old,
            'views': current_views,
            'expected': int(expected_views),
            'ratio': ratio,
            'channel': video['channel_name']
        })
    
    # Sort by performance ratio
    results.sort(key=lambda x: x['ratio'], reverse=True)
    
    # Display results
    print(f"\n{'='*100}")
    print(f"{'Video Title':<50} {'Age':<8} {'Views':<12} {'Expected':<12} {'Ratio':<8} {'Status'}")
    print(f"{'='*100}")
    
    for r in results:
        # Color code based on performance
        if r['ratio'] > 3.0:
            color = "\033[95m"  # Magenta
            status = "🚀 VIRAL"
        elif r['ratio'] > 1.5:
            color = "\033[92m"  # Green
            status = "📈 OVER"
        elif r['ratio'] > 0.5:
            color = "\033[0m"   # Normal
            status = "✅ OK"
        else:
            color = "\033[93m"  # Yellow
            status = "📉 UNDER"
        
        print(f"{color}{r['title']:<50} {r['days_old']:<8} {r['views']:<12,} {r['expected']:<12,} {r['ratio']:<8.2f} {status}\033[0m")
    
    # Summary stats
    if results:
        print(f"\n{'='*100}")
        over = len([r for r in results if r['ratio'] > 1.5])
        under = len([r for r in results if r['ratio'] < 0.5])
        print(f"Summary: {over} overperforming, {len(results)-over-under} on track, {under} underperforming")
        print(f"Channel: {results[0]['channel']} (Scale: {scale_factor:.2f}x)")

if __name__ == "__main__":
    import sys
    
    if len(sys.argv) > 1:
        # Check specific channel
        channel_id = sys.argv[1]
        get_channel_performance(channel_id)
    else:
        # Get a sample channel
        result = supabase.table('videos')\
            .select('channel_id, channel_name')\
            .not_.is_('channel_id', None)\
            .limit(1)\
            .execute()
        
        if result.data:
            print(f"Checking channel: {result.data[0]['channel_name']}")
            get_channel_performance(result.data[0]['channel_id'])
        else:
            print("No channels found")