#!/usr/bin/env python3
"""
Create Proper YouTube Performance Envelope Chart
Shows actual video growth trajectories against expected performance bands
"""

import os
import matplotlib.pyplot as plt
import numpy as np
from supabase import create_client, Client
from dotenv import load_dotenv
from datetime import datetime, timedelta

# Load environment variables
load_dotenv()

# Initialize Supabase client
url = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
supabase: Client = create_client(url, key)

def fetch_envelope_data():
    """Fetch the performance envelope curves"""
    response = supabase.table('performance_envelopes').select('*').order('day_since_published').execute()
    return response.data

def fetch_video_with_trajectory(video_id):
    """Fetch a specific video and its growth trajectory"""
    # Get video details
    video_response = supabase.table('videos').select('*').eq('id', video_id).single().execute()
    video = video_response.data
    
    # Get all snapshots for this video
    snapshots_response = supabase.table('view_snapshots').select('*').eq('video_id', video_id).order('days_since_published').execute()
    snapshots = snapshots_response.data
    
    return video, snapshots

def scale_envelope_to_channel(envelope_data, channel_baseline):
    """Scale the global envelope to a specific channel's baseline"""
    # Get Day 1 median from envelope
    day1_envelope = next((e for e in envelope_data if e['day_since_published'] == 1), None)
    if not day1_envelope:
        return envelope_data
    
    day1_median = day1_envelope['p50_views']
    
    # Scale all envelope values
    scaled_envelope = []
    for day_data in envelope_data:
        scaling_factor = channel_baseline / day1_median
        scaled_day = {
            'day_since_published': day_data['day_since_published'],
            'p10_views': day_data['p10_views'] * scaling_factor,
            'p25_views': day_data['p25_views'] * scaling_factor,
            'p50_views': day_data['p50_views'] * scaling_factor,
            'p75_views': day_data['p75_views'] * scaling_factor,
            'p90_views': day_data['p90_views'] * scaling_factor,
            'p95_views': day_data['p95_views'] * scaling_factor
        }
        scaled_envelope.append(scaled_day)
    
    return scaled_envelope

def create_performance_chart(video_id, channel_baseline=None):
    """Create a proper performance envelope chart for a specific video"""
    
    # Fetch data
    print(f"📊 Creating performance chart for video: {video_id}")
    envelope_data = fetch_envelope_data()
    video, snapshots = fetch_video_with_trajectory(video_id)
    
    if not video or not snapshots:
        print("❌ No data found for video")
        return
    
    print(f"📹 Video: {video['title'][:60]}...")
    print(f"📈 Found {len(snapshots)} snapshots")
    
    # Use channel baseline or default
    if not channel_baseline:
        channel_baseline = 8478  # Day 1 median from global data
    
    # Scale envelope to channel
    scaled_envelope = scale_envelope_to_channel(envelope_data, channel_baseline)
    
    # Create the chart
    plt.figure(figsize=(14, 8))
    
    # Extract envelope data
    days = [e['day_since_published'] for e in scaled_envelope]
    p25 = [e['p25_views'] for e in scaled_envelope]
    p50 = [e['p50_views'] for e in scaled_envelope]
    p75 = [e['p75_views'] for e in scaled_envelope]
    p90 = [e['p90_views'] for e in scaled_envelope]
    
    # Plot envelope bands
    plt.fill_between(days, p25, p75, alpha=0.3, color='gray', label='Normal Range (25th-75th %ile)')
    plt.fill_between(days, p75, p90, alpha=0.2, color='lightgreen', label='Above Normal (75th-90th %ile)')
    
    # Plot median expected line
    plt.plot(days, p50, '--', color='black', linewidth=2, label='Expected Performance', alpha=0.7)
    
    # Extract video trajectory
    video_days = [s['days_since_published'] for s in snapshots]
    video_views = [s['view_count'] for s in snapshots]
    
    # Ensure views are cumulative (just in case)
    cumulative_views = []
    max_views = 0
    for views in video_views:
        max_views = max(max_views, views)
        cumulative_views.append(max_views)
    
    # Calculate performance ratio at current age
    current_age = video_days[-1] if video_days else 0
    current_views = cumulative_views[-1] if cumulative_views else 0
    
    # Find expected views for current age
    expected_data = next((e for e in scaled_envelope if e['day_since_published'] == min(current_age, 365)), None)
    if expected_data:
        expected_views = expected_data['p50_views']
        performance_ratio = current_views / expected_views
        
        # Determine performance category
        if performance_ratio > 3.0:
            color = 'red'
            category = 'Viral'
        elif performance_ratio >= 1.5:
            color = 'green'
            category = 'Outperforming'
        elif performance_ratio >= 0.5:
            color = 'blue'
            category = 'On Track'
        else:
            color = 'orange'
            category = 'Underperforming'
    else:
        performance_ratio = 1.0
        color = 'blue'
        category = 'Unknown'
    
    # Plot video trajectory
    plt.plot(video_days, cumulative_views, 'o-', color=color, linewidth=2, markersize=6,
             label=f'{category} ({performance_ratio:.1f}x expected)')
    
    # Add performance ratio annotation
    if video_days:
        plt.annotate(f'{performance_ratio:.1f}x', 
                     xy=(video_days[-1], cumulative_views[-1]),
                     xytext=(10, 10), textcoords='offset points',
                     bbox=dict(boxstyle='round,pad=0.3', facecolor=color, alpha=0.7),
                     fontsize=10, color='white', weight='bold')
    
    # Formatting
    plt.xlabel('Days Since Published', fontsize=12)
    plt.ylabel('View Count', fontsize=12)
    plt.title(f'Performance Envelope Analysis\n{video["title"][:80]}{"..." if len(video["title"]) > 80 else ""}', 
              fontsize=14, pad=20)
    
    # Format y-axis
    plt.gca().yaxis.set_major_formatter(plt.FuncFormatter(lambda x, p: f'{x/1000:.0f}K' if x < 1000000 else f'{x/1000000:.1f}M'))
    
    # Set axis limits
    max_days = max(video_days) if video_days else 365
    plt.xlim(0, min(max_days + 10, 365))
    
    max_y = max(cumulative_views + p90[:min(max_days+1, len(p90))]) if cumulative_views else max(p90)
    plt.ylim(0, max_y * 1.1)
    
    # Grid and legend
    plt.grid(True, alpha=0.3)
    plt.legend(loc='upper left', framealpha=0.9)
    
    # Add statistics
    stats_text = f"""Video Statistics:
Current Views: {current_views:,}
Age: {current_age} days
Expected Views: {expected_views:,.0f}
Performance: {performance_ratio:.2f}x ({category})
Channel Baseline: {channel_baseline:,} views"""
    
    plt.text(0.02, 0.98, stats_text, transform=plt.gca().transAxes,
             verticalalignment='top', bbox=dict(boxstyle='round', facecolor='white', alpha=0.8),
             fontsize=9)
    
    plt.tight_layout()
    
    # Save the chart
    output_path = f'performance_envelope_{video_id}.png'
    plt.savefig(output_path, dpi=300, bbox_inches='tight')
    print(f"💾 Chart saved to: {output_path}")
    
    plt.show()
    
    return {
        'video_id': video_id,
        'title': video['title'],
        'current_views': current_views,
        'expected_views': expected_views,
        'performance_ratio': performance_ratio,
        'category': category
    }

def find_videos_with_good_data():
    """Find videos with multiple snapshots for demonstration"""
    query = """
    SELECT v.id, v.title, v.view_count, COUNT(vs.id) as snapshot_count
    FROM videos v
    JOIN view_snapshots vs ON v.id = vs.video_id
    WHERE v.duration IS NOT NULL
    GROUP BY v.id, v.title, v.view_count
    HAVING COUNT(vs.id) >= 5
    ORDER BY v.view_count DESC
    LIMIT 10
    """
    
    # Execute raw SQL
    response = supabase.table('videos').select('id, title, view_count').execute()
    
    # Instead, let's use a simpler approach
    videos_response = supabase.table('videos').select('id, title, view_count').neq('duration', None).order('view_count', desc=True).limit(50).execute()
    
    good_videos = []
    for video in videos_response.data:
        # Check if it has multiple snapshots
        snapshots_response = supabase.table('view_snapshots').select('id').eq('video_id', video['id']).execute()
        if len(snapshots_response.data) >= 3:
            good_videos.append({
                'id': video['id'],
                'title': video['title'],
                'view_count': video['view_count'],
                'snapshot_count': len(snapshots_response.data)
            })
            
            if len(good_videos) >= 3:
                break
    
    return good_videos

def main():
    """Main function to create performance charts"""
    print("🔍 Finding videos with good trajectory data...\n")
    
    # Find videos with multiple snapshots
    good_videos = find_videos_with_good_data()
    
    if not good_videos:
        print("❌ No videos found with sufficient snapshot data")
        return
    
    print(f"Found {len(good_videos)} videos with good data:\n")
    for i, video in enumerate(good_videos):
        print(f"{i+1}. {video['title'][:60]}...")
        print(f"   Views: {video['view_count']:,} | Snapshots: {video['snapshot_count']}")
    
    # Create charts for the first video
    if good_videos:
        print(f"\n📊 Creating performance chart for: {good_videos[0]['title'][:60]}...")
        result = create_performance_chart(good_videos[0]['id'])
        
        if result:
            print(f"\n✅ Chart created successfully!")
            print(f"Performance: {result['performance_ratio']:.2f}x expected ({result['category']})")

if __name__ == "__main__":
    main()