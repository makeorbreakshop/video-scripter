#!/usr/bin/env python3
"""
Simple median views by day - SINGLE UPWARD LINE
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
    # Duration check
    if duration:
        match = re.match(r'^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$', duration)
        if match:
            hours = int(match.group(1) or 0)
            minutes = int(match.group(2) or 0) 
            seconds = int(match.group(3) or 0)
            total_seconds = hours * 3600 + minutes * 60 + seconds
            if total_seconds <= 121:
                return True
    
    # Hashtag check
    combined_text = (title + ' ' + description).lower()
    if '#shorts' in combined_text or '#youtubeshorts' in combined_text:
        return True
    
    return False

def get_median_growth_curve(channel_name):
    """Get median views by days_since_published - SINGLE UPWARD LINE"""
    
    print(f"Getting median growth curve for: {channel_name}")
    
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
    
    # Process data
    all_snapshots = []
    
    for video in videos:
        # Skip shorts
        if is_youtube_short(video.get('duration', ''), video.get('title', ''), video.get('description', '')):
            continue
            
        if video.get('view_snapshots'):
            for snapshot in video['view_snapshots']:
                all_snapshots.append({
                    'video_id': video['id'],
                    'title': video['title'],
                    'days_since_published': snapshot['days_since_published'],
                    'view_count': snapshot['view_count']
                })
    
    df = pd.DataFrame(all_snapshots)
    
    if len(df) == 0:
        print("No data found!")
        return None
    
    print(f"Processing {len(df)} snapshots from {df['video_id'].nunique()} videos")
    print(f"Age range: {df['days_since_published'].min()} to {df['days_since_published'].max()} days")
    
    # Calculate median for each day
    median_by_day = df.groupby('days_since_published')['view_count'].median().reset_index()
    median_by_day.columns = ['days_since_published', 'median_views']
    
    # Sort by days to ensure proper line
    median_by_day = median_by_day.sort_values('days_since_published')
    
    print(f"Median calculated for {len(median_by_day)} days")
    
    return df, median_by_day

def plot_median_growth(df, median_by_day, channel_name):
    """Plot the median growth curve"""
    
    plt.figure(figsize=(15, 10))
    
    # Plot all raw data points (light)
    plt.scatter(df['days_since_published'], df['view_count'], 
                alpha=0.3, s=20, color='lightblue', label='All snapshots')
    
    # Plot THE MEDIAN LINE - SINGLE UPWARD CURVE
    plt.plot(median_by_day['days_since_published'], median_by_day['median_views'],
             color='red', linewidth=3, marker='o', markersize=4,
             label='MEDIAN VIEWS BY DAY')
    
    plt.xlabel('Days Since Published', fontsize=14)
    plt.ylabel('View Count', fontsize=14)
    plt.title(f'{channel_name} - Median Views Growth Curve', fontsize=16, fontweight='bold')
    
    # Format y-axis
    plt.gca().yaxis.set_major_formatter(plt.FuncFormatter(lambda x, p: f'{x/1000:.0f}K' if x >= 1000 else f'{x:.0f}'))
    
    plt.legend(fontsize=12)
    plt.grid(True, alpha=0.3)
    plt.tight_layout()
    
    # Save plot
    plt.savefig('/Users/brandoncullum/video-scripter/scripts/median_growth_curve.png', dpi=150, bbox_inches='tight')
    print("\\nPlot saved as 'median_growth_curve.png'")
    
    return plt.gcf()

def main():
    """Main execution"""
    
    CHANNEL_NAME = "3x3Custom - Tamar"
    
    print("=" * 60)
    print("MEDIAN VIEWS GROWTH CURVE")
    print("=" * 60)
    
    df, median_by_day = get_median_growth_curve(CHANNEL_NAME)
    
    if df is None:
        print("No data available")
        return
    
    # Show some stats
    print(f"\\nMedian views progression:")
    print(f"Day 1: {median_by_day[median_by_day['days_since_published'] <= 1]['median_views'].iloc[0] if len(median_by_day[median_by_day['days_since_published'] <= 1]) > 0 else 'N/A'}")
    print(f"Day 7: {median_by_day[median_by_day['days_since_published'] <= 7]['median_views'].iloc[-1] if len(median_by_day[median_by_day['days_since_published'] <= 7]) > 0 else 'N/A'}")
    print(f"Day 30: {median_by_day[median_by_day['days_since_published'] <= 30]['median_views'].iloc[-1] if len(median_by_day[median_by_day['days_since_published'] <= 30]) > 0 else 'N/A'}")
    print(f"Latest: {median_by_day['median_views'].iloc[-1]} views at day {median_by_day['days_since_published'].iloc[-1]}")
    
    # Create plot
    plot_median_growth(df, median_by_day, CHANNEL_NAME)
    
    plt.show()

if __name__ == "__main__":
    main()