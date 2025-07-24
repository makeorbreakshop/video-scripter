#!/usr/bin/env python3
"""
PROPER growth curve - track how individual videos grow over time
"""

import os
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
from supabase import create_client, Client
from datetime import datetime, timedelta
from dotenv import load_dotenv
import re

# Load environment variables
load_dotenv()

# Supabase connection
url = os.getenv('NEXT_PUBLIC_SUPABASE_URL')
key = os.getenv('SUPABASE_SERVICE_ROLE_KEY')
supabase: Client = create_client(url, key)

def is_youtube_short(duration, title='', description=''):
    """Check if video is a YouTube Short"""
    if duration:
        match = re.match(r'^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$', duration)
        if match:
            hours = int(match.group(1) or 0)
            minutes = int(match.group(2) or 0) 
            seconds = int(match.group(3) or 0)
            total_seconds = hours * 3600 + minutes * 60 + seconds
            if total_seconds <= 121:
                return True
    
    combined_text = (title + ' ' + description).lower()
    if '#shorts' in combined_text or '#youtubeshorts' in combined_text:
        return True
    
    return False

def get_proper_growth_curve(channel_name):
    """Get PROPER growth curve by normalizing video trajectories"""
    
    print(f"Getting proper growth curve for: {channel_name}")
    
    # Get ALL videos and snapshots
    response = supabase.table('videos').select('''
        id,
        title,
        published_at,
        duration,
        description,
        view_snapshots (
            days_since_published,
            view_count,
            snapshot_date
        )
    ''').eq('channel_name', channel_name).execute()
    
    videos = response.data
    print(f"Found {len(videos)} total videos")
    
    # Process data - only keep videos with multiple snapshots
    video_trajectories = {}
    
    for video in videos:
        # Skip shorts
        if is_youtube_short(video.get('duration', ''), video.get('title', ''), video.get('description', '')):
            continue
            
        if video.get('view_snapshots') and len(video['view_snapshots']) >= 2:
            video_id = video['id']
            snapshots = []
            
            for snapshot in video['view_snapshots']:
                snapshots.append({
                    'days_since_published': snapshot['days_since_published'],
                    'view_count': snapshot['view_count']
                })
            
            # Sort by days
            snapshots = sorted(snapshots, key=lambda x: x['days_since_published'])
            video_trajectories[video_id] = {
                'title': video['title'],
                'snapshots': snapshots
            }
    
    print(f"Found {len(video_trajectories)} videos with multiple snapshots")
    
    if len(video_trajectories) == 0:
        print("No videos with growth data!")
        return None, None
    
    # Create normalized growth curves
    # For each day 0 to max_day, calculate median views across all videos that have data at that age
    max_day = 0
    for video_data in video_trajectories.values():
        max_day = max(max_day, video_data['snapshots'][-1]['days_since_published'])
    
    print(f"Max age in data: {max_day} days")
    
    # Build median curve
    median_curve = []
    
    for day in range(0, min(max_day + 1, 100)):  # Focus on first 100 days
        views_at_day = []
        
        for video_data in video_trajectories.values():
            snapshots = video_data['snapshots']
            
            # Find the views at this exact day or interpolate
            views = None
            for i, snapshot in enumerate(snapshots):
                if snapshot['days_since_published'] == day:
                    views = snapshot['view_count']
                    break
                elif snapshot['days_since_published'] > day and i > 0:
                    # Linear interpolation
                    prev_snap = snapshots[i-1]
                    curr_snap = snapshot
                    
                    day_diff = curr_snap['days_since_published'] - prev_snap['days_since_published']
                    view_diff = curr_snap['view_count'] - prev_snap['view_count']
                    
                    days_from_prev = day - prev_snap['days_since_published']
                    views = prev_snap['view_count'] + (view_diff * days_from_prev / day_diff)
                    break
            
            if views is not None and views > 0:
                views_at_day.append(views)
        
        if len(views_at_day) >= 3:  # Need at least 3 videos for meaningful median
            median_views = np.median(views_at_day)
            median_curve.append({
                'day': day,
                'median_views': median_views,
                'video_count': len(views_at_day)
            })
    
    median_df = pd.DataFrame(median_curve)
    
    if len(median_df) == 0:
        print("No median curve data!")
        return None, None
    
    print(f"Median curve calculated for {len(median_df)} days")
    print(f"Using {median_df['video_count'].min()}-{median_df['video_count'].max()} videos per day")
    
    return video_trajectories, median_df

def plot_proper_growth(video_trajectories, median_df, channel_name):
    """Plot the proper growth curve"""
    
    plt.figure(figsize=(15, 10))
    
    # Plot individual video trajectories (light gray)
    for video_id, video_data in video_trajectories.items():
        days = [s['days_since_published'] for s in video_data['snapshots']]
        views = [s['view_count'] for s in video_data['snapshots']]
        
        if max(days) <= 100:  # Only show videos with data in first 100 days
            plt.plot(days, views, color='lightgray', alpha=0.3, linewidth=1)
    
    # Plot THE MEDIAN GROWTH CURVE - SMOOTH UPWARD LINE
    plt.plot(median_df['day'], median_df['median_views'],
             color='red', linewidth=4, marker='o', markersize=6,
             label='MEDIAN GROWTH CURVE')
    
    plt.xlabel('Days Since Published', fontsize=14)
    plt.ylabel('View Count', fontsize=14)
    plt.title(f'{channel_name} - Proper Video Growth Curve (First 100 Days)', fontsize=16, fontweight='bold')
    
    # Format y-axis
    plt.gca().yaxis.set_major_formatter(plt.FuncFormatter(lambda x, p: f'{x/1000:.0f}K' if x >= 1000 else f'{x:.0f}'))
    
    plt.legend(fontsize=12)
    plt.grid(True, alpha=0.3)
    plt.xlim(0, 100)
    plt.tight_layout()
    
    # Save plot
    plt.savefig('/Users/brandoncullum/video-scripter/scripts/proper_growth_curve.png', dpi=150, bbox_inches='tight')
    print("\\nPlot saved as 'proper_growth_curve.png'")
    
    return plt.gcf()

def main():
    """Main execution"""
    
    CHANNEL_NAME = "3x3Custom - Tamar"
    
    print("=" * 60)
    print("PROPER VIDEO GROWTH CURVE")
    print("=" * 60)
    
    video_trajectories, median_df = get_proper_growth_curve(CHANNEL_NAME)
    
    if video_trajectories is None:
        print("No data available")
        return
    
    # Show growth stats
    print(f"\\nMedian views progression:")
    if len(median_df) > 0:
        day_1 = median_df[median_df['day'] <= 1]
        day_7 = median_df[median_df['day'] <= 7]
        day_30 = median_df[median_df['day'] <= 30]
        
        if len(day_1) > 0:
            print(f"Day 1: {day_1['median_views'].iloc[-1]:,.0f} views")
        if len(day_7) > 0:
            print(f"Day 7: {day_7['median_views'].iloc[-1]:,.0f} views")
        if len(day_30) > 0:
            print(f"Day 30: {day_30['median_views'].iloc[-1]:,.0f} views")
        
        print(f"Latest: {median_df['median_views'].iloc[-1]:,.0f} views at day {median_df['day'].iloc[-1]}")
    
    # Create plot
    plot_proper_growth(video_trajectories, median_df, CHANNEL_NAME)
    
    plt.show()

if __name__ == "__main__":
    main()