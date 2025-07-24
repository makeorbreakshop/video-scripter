#!/usr/bin/env python3
"""
YouTube-Style Performance Envelope Analysis
Creates a performance chart showing if videos are over/underperforming for their age
"""

import os
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
from supabase import create_client, Client
from datetime import datetime, timedelta
import seaborn as sns
from scipy import interpolate
import re
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Supabase connection
url = os.getenv('NEXT_PUBLIC_SUPABASE_URL')
key = os.getenv('SUPABASE_SERVICE_ROLE_KEY')
supabase: Client = create_client(url, key)

def extract_duration_seconds(duration):
    """Extract duration in seconds from ISO 8601 format"""
    if not duration or duration == '' or duration == 'P0D':
        return 0
    
    match = re.match(r'^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$', duration)
    if not match:
        return 0
    
    hours = int(match.group(1) or 0)
    minutes = int(match.group(2) or 0) 
    seconds = int(match.group(3) or 0)
    
    return hours * 3600 + minutes * 60 + seconds

def is_youtube_short(duration, title='', description=''):
    """Check if video is a YouTube Short"""
    # Duration check: <= 121 seconds (2 minutes 1 second)
    duration_seconds = extract_duration_seconds(duration)
    if duration_seconds > 0 and duration_seconds <= 121:
        return True
    
    # Hashtag check
    combined_text = (title + ' ' + description).lower()
    if '#shorts' in combined_text or '#youtubeshorts' in combined_text:
        return True
    
    return False

def get_channel_data(channel_name, baseline_days=90, min_videos=20):
    """Get view snapshot data for a channel with date filtering"""
    
    # Calculate cutoff date for baseline
    cutoff_date = datetime.now() - timedelta(days=baseline_days)
    
    print(f"Fetching data for channel: {channel_name}")
    print(f"Using videos published after: {cutoff_date.strftime('%Y-%m-%d')}")
    
    # Get videos with view snapshots
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
    ''').eq('channel_name', channel_name).gte('published_at', cutoff_date.isoformat()).execute()
    
    videos = response.data
    print(f"Found {len(videos)} videos in date range")
    
    # Process data
    all_snapshots = []
    video_info = {}
    
    for video in videos:
        # Skip shorts
        if is_youtube_short(video.get('duration'), video.get('title', ''), video.get('description', '')):
            continue
            
        video_id = video['id']
        video_info[video_id] = {
            'title': video['title'],
            'published_at': video['published_at']
        }
        
        if video.get('view_snapshots'):
            for snapshot in video['view_snapshots']:
                all_snapshots.append({
                    'video_id': video_id,
                    'title': video['title'],
                    'days_since_published': snapshot['days_since_published'],
                    'view_count': snapshot['view_count'],
                    'snapshot_date': snapshot['snapshot_date']
                })
    
    df = pd.DataFrame(all_snapshots)
    
    if len(df) == 0:
        print("No data found!")
        return None, None
    
    print(f"Processed {len(df)} snapshots from {df['video_id'].nunique()} videos (shorts filtered)")
    print(f"Age range: {df['days_since_published'].min()} to {df['days_since_published'].max()} days")
    
    return df, video_info

def calculate_performance_envelope(df, max_days=None):
    """Calculate performance percentiles for each day"""
    
    if len(df) == 0:
        return pd.DataFrame()
    
    if max_days:
        df = df[df['days_since_published'] <= max_days]
    
    # Group by days and calculate percentiles - USE ALL DATA, NO MINIMUM COUNT
    daily_stats = df.groupby('days_since_published')['view_count'].agg([
        ('count', 'count'),
        ('p10', lambda x: np.percentile(x, 10)),
        ('p25', lambda x: np.percentile(x, 25)),
        ('p50', lambda x: np.percentile(x, 50)),
        ('p75', lambda x: np.percentile(x, 75)),
        ('p90', lambda x: np.percentile(x, 90)),
        ('mean', 'mean')
    ]).reset_index()
    
    # NO FILTERING - USE ALL DAYS
    print(f"Daily stats calculated for {len(daily_stats)} days")
    print(f"Age range: {daily_stats['days_since_published'].min()}-{daily_stats['days_since_published'].max()} days")
    
    return daily_stats

def smooth_envelope(daily_stats, smooth_factor=0.3):
    """Create smooth interpolated curves for the envelope"""
    
    if len(daily_stats) < 3:
        print(f"Only {len(daily_stats)} data points - using raw data without smoothing")
        return daily_stats
    
    days = daily_stats['days_since_published'].values
    
    try:
        # Create interpolation functions for each percentile
        interpolators = {}
        for col in ['p10', 'p25', 'p50', 'p75', 'p90']:
            values = daily_stats[col].values
            # Use linear interpolation for sparse data instead of splines
            interpolators[col] = interpolate.interp1d(days, values, kind='linear', 
                                                    bounds_error=False, fill_value='extrapolate')
        
        # Create dense day range for smooth curves
        day_range = np.linspace(days.min(), days.max(), int((days.max() - days.min()) / 2) + 1)
        
        smooth_stats = pd.DataFrame({'days_since_published': day_range})
        
        for col, interp_func in interpolators.items():
            smooth_stats[col] = np.maximum(0, interp_func(day_range))  # Ensure non-negative
        
        return smooth_stats
        
    except Exception as e:
        print(f"Smoothing failed ({e}) - using raw data")
        return daily_stats

def get_video_trajectory(df, video_id):
    """Get trajectory data for a specific video"""
    video_data = df[df['video_id'] == video_id].copy()
    video_data = video_data.sort_values('days_since_published')
    return video_data

def plot_performance_envelope(daily_stats, smooth_stats, df, video_id=None, channel_name="Channel"):
    """Create the performance envelope plot"""
    
    plt.figure(figsize=(14, 8))
    
    # Plot envelope areas
    plt.fill_between(smooth_stats['days_since_published'], 
                     smooth_stats['p25'], smooth_stats['p75'],
                     alpha=0.3, color='gray', label='Normal Range (25th-75th percentile)')
    
    plt.fill_between(smooth_stats['days_since_published'], 
                     smooth_stats['p10'], smooth_stats['p25'],
                     alpha=0.15, color='lightgray')
                     
    plt.fill_between(smooth_stats['days_since_published'], 
                     smooth_stats['p75'], smooth_stats['p90'],
                     alpha=0.15, color='lightgray', label='Extended Range (10th-90th percentile)')
    
    # Plot median line
    plt.plot(smooth_stats['days_since_published'], smooth_stats['p50'], 
             color='gray', linestyle='--', alpha=0.7, label='Median Performance')
    
    # Plot raw data points (lightly)
    plt.scatter(df['days_since_published'], df['view_count'], 
                alpha=0.1, s=10, color='lightblue', label='All Data Points')
    
    # Plot specific video if selected
    if video_id:
        video_data = get_video_trajectory(df, video_id)
        if len(video_data) > 0:
            plt.plot(video_data['days_since_published'], video_data['view_count'],
                    color='red', linewidth=3, marker='o', markersize=6,
                    label=f'Selected Video: {video_data.iloc[0]["title"][:50]}...')
    
    plt.xlabel('Days Since Published', fontsize=12)
    plt.ylabel('View Count', fontsize=12)
    plt.title(f'{channel_name} - Performance Envelope Analysis', fontsize=14, fontweight='bold')
    
    # Format y-axis
    plt.gca().yaxis.set_major_formatter(plt.FuncFormatter(lambda x, p: f'{x/1000:.0f}K' if x >= 1000 else f'{x:.0f}'))
    
    plt.legend(bbox_to_anchor=(1.05, 1), loc='upper left')
    plt.grid(True, alpha=0.3)
    plt.tight_layout()
    
    return plt.gcf()

def analyze_video_performance(video_data, smooth_stats):
    """Analyze how a video is performing relative to the envelope"""
    
    performance_analysis = []
    
    for _, row in video_data.iterrows():
        day = row['days_since_published']
        views = row['view_count']
        
        # Find closest day in smooth stats
        closest_day_idx = np.argmin(np.abs(smooth_stats['days_since_published'] - day))
        day_stats = smooth_stats.iloc[closest_day_idx]
        
        # Calculate performance relative to percentiles
        if views >= day_stats['p90']:
            performance = "Exceptional (>90th percentile)"
        elif views >= day_stats['p75']:
            performance = "Outperforming (>75th percentile)"
        elif views >= day_stats['p25']:
            performance = "Normal (25th-75th percentile)"
        elif views >= day_stats['p10']:
            performance = "Underperforming (<25th percentile)"
        else:
            performance = "Poor (<10th percentile)"
        
        performance_analysis.append({
            'day': day,
            'views': views,
            'median_views': day_stats['p50'],
            'performance': performance,
            'percentile_vs_median': (views / day_stats['p50'] - 1) * 100
        })
    
    return performance_analysis

def main():
    """Main execution function"""
    
    # Configuration
    CHANNEL_NAME = "3x3Custom - Tamar"
    BASELINE_DAYS = 365 * 5  # Use 5 years of data to get ALL videos
    MAX_DAYS_TO_PLOT = None  # USE ALL DAYS, DON'T LIMIT
    
    # Get data
    print("=" * 60)
    print("YouTube Performance Envelope Analysis")
    print("=" * 60)
    
    df, video_info = get_channel_data(CHANNEL_NAME, BASELINE_DAYS)
    
    if df is None:
        print("No data available for analysis")
        return
    
    # Calculate envelope
    daily_stats = calculate_performance_envelope(df, MAX_DAYS_TO_PLOT)
    smooth_stats = smooth_envelope(daily_stats)
    
    # Get a video to highlight (most recent with good data)
    recent_videos = df.groupby('video_id').agg({
        'days_since_published': 'count',
        'title': 'first'
    }).reset_index()
    
    # Find video with most snapshots
    selected_video_id = recent_videos.loc[recent_videos['days_since_published'].idxmax(), 'video_id']
    selected_video_title = recent_videos.loc[recent_videos['days_since_published'].idxmax(), 'title']
    
    print(f"\nSelected video for analysis: {selected_video_title}")
    
    # Create plot
    fig = plot_performance_envelope(daily_stats, smooth_stats, df, selected_video_id, CHANNEL_NAME)
    
    # Analyze selected video performance
    video_data = get_video_trajectory(df, selected_video_id)
    
    if len(smooth_stats) > 0:
        analysis = analyze_video_performance(video_data, smooth_stats)
        
        print(f"\nPerformance Analysis for: {selected_video_title}")
        print("-" * 50)
        for item in analysis:
            print(f"Day {item['day']:2d}: {item['views']:8,} views | {item['performance']:25s} | {item['percentile_vs_median']:+6.1f}% vs median")
    else:
        print("\nNot enough data for performance analysis")
    
    # Show summary stats
    print(f"\nSummary Statistics:")
    print(f"Total snapshots analyzed: {len(df)}")
    print(f"Unique videos: {df['video_id'].nunique()}")
    print(f"Age range: {df['days_since_published'].min()}-{df['days_since_published'].max()} days")
    print(f"View range: {df['view_count'].min():,}-{df['view_count'].max():,} views")
    
    plt.show()

if __name__ == "__main__":
    main()