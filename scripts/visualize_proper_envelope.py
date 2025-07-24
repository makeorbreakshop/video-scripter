#!/usr/bin/env python3
"""
Visualize PROPER Performance Envelope Chart
Shows cumulative growth curves that ONLY go up (like YouTube views actually work)
"""

import os
import sys
import matplotlib.pyplot as plt
import numpy as np
from supabase import create_client, Client
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Initialize Supabase client
url = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
supabase: Client = create_client(url, key)

def fetch_video_trajectories():
    """Fetch actual video growth trajectories from view_snapshots"""
    print("📊 Fetching video growth trajectories...")
    
    # Get videos with good duration data first
    videos_response = supabase.table('videos').select('id, title, view_count, duration').is_('duration', 'not.null').order('view_count', desc=True).limit(20).execute()
    
    if not videos_response.data:
        print("❌ No videos found!")
        return None
    
    video_trajectories = []
    
    for video in videos_response.data:
        # Skip shorts (duration like PT45S or PT1M30S where minutes <= 2)
        duration = video.get('duration', '')
        if 'PT' not in duration:
            continue
            
        # Get snapshots for this video
        snapshots_response = supabase.table('view_snapshots').select('days_since_published, view_count').eq('video_id', video['id']).order('days_since_published').execute()
        
        if snapshots_response.data and len(snapshots_response.data) >= 3:
            days = [s['days_since_published'] for s in snapshots_response.data]
            views = [s['view_count'] for s in snapshots_response.data]
            
            # Only include if we have at least 30 days of tracking
            if max(days) >= 30:
                video_trajectories.append({
                    'id': video['id'],
                    'title': video['title'],
                    'current_views': video['view_count'],
                    'days': days,
                    'views': views
                })
    
    print(f"✅ Loaded {len(video_trajectories)} video trajectories")
    return video_trajectories

def fetch_envelope_data():
    """Fetch the performance envelope curves"""
    response = supabase.table('performance_envelopes').select('*').order('day_since_published').execute()
    return response.data

def create_proper_envelope_chart(video_data, envelope_data):
    """Create YouTube-style chart with actual cumulative growth curves"""
    
    # Create the chart
    plt.figure(figsize=(14, 8))
    
    # Extract envelope data
    days = [row['day_since_published'] for row in envelope_data]
    p25 = [row['p25_views'] for row in envelope_data]
    p50 = [row['p50_views'] for row in envelope_data]
    p75 = [row['p75_views'] for row in envelope_data]
    p90 = [row['p90_views'] for row in envelope_data]
    p95 = [row['p95_views'] for row in envelope_data]
    
    # Plot envelope bands
    plt.fill_between(days, p25, p75, alpha=0.3, color='gray', label='Normal Range (25th-75th %ile)')
    plt.fill_between(days, p75, p90, alpha=0.15, color='lightgreen', label='Above Normal (75th-90th %ile)')
    plt.fill_between(days, p90, p95, alpha=0.1, color='gold', label='Outperforming (90th-95th %ile)')
    
    # Plot median line
    plt.plot(days, p50, 'k--', linewidth=2, label='Median Expected Performance', alpha=0.7)
    
    # Plot individual video trajectories
    colors = plt.cm.viridis(np.linspace(0, 1, len(video_data)))
    
    for i, video in enumerate(video_data[:10]):  # Show top 10 videos
        video_days = video['days']
        video_views = video['views']
        
        # Ensure views are cumulative (they should be, but let's be safe)
        cumulative_views = []
        max_views = 0
        for views in video_views:
            max_views = max(max_views, views)
            cumulative_views.append(max_views)
        
        # Plot the trajectory
        plt.plot(video_days, cumulative_views, 
                color=colors[i], linewidth=1.5, alpha=0.8,
                label=f"{video['title'][:30]}..." if i < 5 else "")
    
    # Formatting
    plt.xlabel('Days Since Published', fontsize=12)
    plt.ylabel('Cumulative View Count', fontsize=12)
    plt.title('YouTube Performance Envelope - Actual Video Growth Trajectories\n(Cumulative Views Over Time)', fontsize=14, pad=20)
    
    # Format y-axis
    plt.gca().yaxis.set_major_formatter(plt.FuncFormatter(lambda x, p: f'{x/1000:.0f}K' if x < 1000000 else f'{x/1000000:.1f}M'))
    
    # Set limits
    plt.xlim(0, 365)
    max_view = max([max(video['views']) for video in video_data[:10]]) if video_data else max(p95)
    plt.ylim(0, max_view * 1.1)
    
    # Grid and legend
    plt.grid(True, alpha=0.3)
    plt.legend(loc='upper left', framealpha=0.9, fontsize=8)
    
    # Add statistics
    stats_text = f"""Performance Envelope:
Median at Day 1: {p50[1]:,} views
Median at Day 30: {p50[30]:,} views  
Median at Day 365: {p50[-1]:,} views
Sample: {len(video_data)} video trajectories"""
    
    plt.text(0.02, 0.98, stats_text, transform=plt.gca().transAxes,
             verticalalignment='top', bbox=dict(boxstyle='round', facecolor='white', alpha=0.8),
             fontsize=10)
    
    plt.tight_layout()
    return plt

def main():
    """Generate proper cumulative growth chart"""
    
    # Fetch data
    print("Fetching envelope data...")
    envelope_data = fetch_envelope_data()
    
    print("Fetching video trajectories...")  
    video_data = fetch_video_trajectories()
    
    if not envelope_data or not video_data:
        print("❌ Missing required data")
        return
    
    # Create proper chart
    chart = create_proper_envelope_chart(video_data, envelope_data)
    
    # Save
    output_path = 'proper_performance_envelope.png'
    chart.savefig(output_path, dpi=300, bbox_inches='tight')
    print(f"💾 Proper chart saved to: {output_path}")
    
    # Show
    chart.show()

if __name__ == "__main__":
    main()