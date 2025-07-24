#!/usr/bin/env python3
"""
Create performance envelope with REAL video data
No simulations - just actual snapshots from our database
"""

import os
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

def create_real_data_envelope():
    """Create performance envelope with actual video data"""
    
    print("📊 Getting REAL data - no simulations...")
    
    # Get smooth envelope data
    envelope_response = supabase.table('performance_envelopes')\
        .select('*')\
        .lte('day_since_published', 120)\
        .order('day_since_published')\
        .execute()
    
    envelope_data = envelope_response.data
    
    # Extract arrays
    days = np.array([e['day_since_published'] for e in envelope_data])
    p50 = np.array([e['p50_views'] for e in envelope_data])
    
    # Find a video with multiple real snapshots
    print("\n🔍 Finding videos with multiple snapshots...")
    
    # Find videos with multiple snapshots
    selected_video = None
    selected_snapshots = None
    
    # Query for videos
    videos_query = supabase.table('videos')\
        .select('id, title, channel_name, view_count')\
        .gte('view_count', 50000)\
        .lte('view_count', 500000)\
        .limit(50)\
        .execute()
    
    # Find one with good snapshots
    for video in videos_query.data:
        snapshots = supabase.table('view_snapshots')\
            .select('*')\
            .eq('video_id', video['id'])\
            .order('days_since_published')\
            .execute()
        
        if len(snapshots.data) >= 4:
            selected_video = video
            selected_snapshots = snapshots.data
            break
    
    print(f"\n✅ Found video: {selected_video['title'][:60]}...")
    print(f"   Channel: {selected_video['channel_name']}")
    print(f"   Current views: {selected_video['view_count']:,}")
    print(f"   Real snapshots: {len(selected_snapshots)}")
    
    # Print actual snapshot data
    print("\n📸 REAL snapshot data:")
    for snap in selected_snapshots:
        print(f"   Day {snap['days_since_published']:3d}: {snap['view_count']:,} views")
    
    # Use channel baseline of 30K for scaling
    channel_baseline = 30000
    global_day1 = p50[1] if len(p50) > 1 else 8478
    scale_factor = channel_baseline / global_day1
    
    # Scale the median curve
    p50_scaled = p50 * scale_factor
    
    # Create normalized envelope
    lower_band = p50_scaled * 0.7
    upper_band = p50_scaled * 1.3
    
    # Extract real video data
    video_days = [s['days_since_published'] for s in selected_snapshots]
    video_views = [s['view_count'] for s in selected_snapshots]
    
    # Calculate performance at latest snapshot
    latest_idx = -1
    latest_day = video_days[latest_idx]
    latest_views = video_views[latest_idx]
    
    if latest_day < len(p50_scaled):
        expected_views = p50_scaled[latest_day]
        performance_ratio = latest_views / expected_views
    else:
        # Extrapolate
        expected_views = p50_scaled[-1] * (latest_day / len(p50_scaled))
        performance_ratio = latest_views / expected_views
    
    # Determine category
    if performance_ratio > 3.0:
        category = "Viral"
        color = '#FF1493'
    elif performance_ratio > 1.5:
        category = "Outperforming"
        color = '#00C851'
    elif performance_ratio > 0.5:
        category = "On Track"
        color = '#33B5E5'
    else:
        category = "Underperforming"
        color = '#FF8800'
    
    # Create the chart
    fig, ax = plt.subplots(figsize=(14, 8))
    
    # Plot envelope
    ax.fill_between(days, lower_band, upper_band, 
                    alpha=0.2, color='gray', 
                    label='Expected Range (±30%)')
    
    # Plot median line
    ax.plot(days, p50_scaled, '--', color='black', 
            linewidth=2, label='Expected Performance', alpha=0.7)
    
    # Plot REAL video snapshots - just dots, no line!
    ax.scatter(video_days, video_views, s=150, color=color, 
               zorder=5, label=f'REAL Snapshots ({category})')
    
    # Connect dots with thin line to show progression
    ax.plot(video_days, video_views, ':', color=color, alpha=0.5, linewidth=1)
    
    # Annotate each real data point
    for i, (day, views) in enumerate(zip(video_days, video_views)):
        ax.annotate(f'Day {day}', 
                    xy=(day, views), 
                    xytext=(5, 5), 
                    textcoords='offset points',
                    fontsize=8, alpha=0.7)
    
    # Performance annotation
    ax.annotate(f'{performance_ratio:.2f}x expected', 
                xy=(latest_day, latest_views),
                xytext=(10, -20), textcoords='offset points',
                bbox=dict(boxstyle='round,pad=0.5', facecolor=color, alpha=0.8),
                fontsize=12, color='white', weight='bold',
                arrowprops=dict(arrowstyle='->', color=color, lw=2))
    
    # Labels
    ax.set_xlabel('Days Since Published', fontsize=12)
    ax.set_ylabel('View Count', fontsize=12)
    ax.set_title(f'YouTube Performance Envelope - REAL DATA\n"{selected_video["title"][:80]}..."', 
                 fontsize=14, pad=20)
    
    # Format y-axis
    ax.yaxis.set_major_formatter(plt.FuncFormatter(
        lambda x, p: f'{x/1000:.0f}K' if x < 1000000 else f'{x/1000000:.1f}M'
    ))
    
    # Set limits based on actual data
    ax.set_xlim(-5, max(max(video_days) + 10, 120))
    ax.set_ylim(0, max(max(video_views) * 1.2, max(upper_band) * 1.2))
    
    # Grid
    ax.grid(True, alpha=0.3)
    ax.legend(loc='upper left')
    
    # Info box
    info_text = f"""REAL DATA:
Video: {selected_video['title'][:40]}...
Channel: {selected_video['channel_name']}
Snapshots: {len(selected_snapshots)} (sparse!)
Latest: Day {latest_day} - {latest_views:,} views
Expected: {expected_views:,.0f} views
Performance: {performance_ratio:.2f}x ({category})"""
    
    ax.text(0.02, 0.98, info_text, transform=ax.transAxes,
            verticalalignment='top', 
            bbox=dict(boxstyle='round', facecolor='white', alpha=0.9),
            fontsize=10, family='monospace')
    
    plt.tight_layout()
    
    # Save
    output_path = 'real_data_performance_envelope.png'
    plt.savefig(output_path, dpi=300, bbox_inches='tight')
    print(f"\n💾 Chart saved to: {output_path}")
    
    plt.show()

if __name__ == "__main__":
    create_real_data_envelope()