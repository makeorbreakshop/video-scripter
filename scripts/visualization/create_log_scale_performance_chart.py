#!/usr/bin/env python3
"""
Create Performance Envelope Chart with Log Scale
This handles both normal and viral videos properly
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

def create_log_performance_chart():
    """Create a performance chart with log scale Y-axis"""
    
    # Get envelope data
    envelope_response = supabase.table('performance_envelopes').select('*').order('day_since_published').execute()
    envelope_data = envelope_response.data
    
    # Find a video with multiple snapshots
    print("🔍 Finding video with good trajectory data...")
    
    # Get MrBeast's Squid Game video as example (should have good data)
    squid_game_response = supabase.table('videos').select('id, title, view_count').like('title', '%Squid Game%').order('view_count', desc=True).limit(1).execute()
    
    if squid_game_response.data:
        video = squid_game_response.data[0]
        video_id = video['id']
        
        # Get snapshots
        snapshots_response = supabase.table('view_snapshots').select('*').eq('video_id', video_id).order('days_since_published').execute()
        snapshots = snapshots_response.data
        
        print(f"📹 Using: {video['title'][:60]}...")
        print(f"📊 Snapshots: {len(snapshots)}")
    else:
        print("Using first video with snapshots...")
        # Fallback to any video with snapshots
        videos_response = supabase.table('videos').select('id, title, view_count').order('view_count', desc=True).limit(10).execute()
        
        video = None
        snapshots = []
        for v in videos_response.data:
            snap_response = supabase.table('view_snapshots').select('*').eq('video_id', v['id']).order('days_since_published').execute()
            if len(snap_response.data) >= 3:
                video = v
                video_id = v['id']
                snapshots = snap_response.data
                break
    
    if not video or not snapshots:
        print("❌ No suitable video found")
        return
    
    # Create the chart
    fig, ax = plt.subplots(figsize=(14, 8))
    
    # Extract envelope data
    days = np.array([e['day_since_published'] for e in envelope_data])
    p10 = np.array([e['p10_views'] for e in envelope_data])
    p25 = np.array([e['p25_views'] for e in envelope_data])
    p50 = np.array([e['p50_views'] for e in envelope_data])
    p75 = np.array([e['p75_views'] for e in envelope_data])
    p90 = np.array([e['p90_views'] for e in envelope_data])
    
    # Plot envelope bands (these will be visible on log scale)
    ax.fill_between(days, p25, p75, alpha=0.3, color='gray', label='Normal Range (25th-75th %ile)')
    ax.fill_between(days, p10, p25, alpha=0.2, color='lightcoral', label='Below Normal')
    ax.fill_between(days, p75, p90, alpha=0.2, color='lightgreen', label='Above Normal')
    
    # Plot median line
    ax.plot(days, p50, '--', color='black', linewidth=2, label='Median Expected', alpha=0.7)
    
    # Plot video trajectory
    video_days = [s['days_since_published'] for s in snapshots]
    video_views = [s['view_count'] for s in snapshots]
    
    # Calculate performance
    current_age = min(video_days[-1], 365)
    current_views = video_views[-1]
    expected_views = p50[current_age] if current_age < len(p50) else p50[-1]
    performance_ratio = current_views / expected_views
    
    # Color based on performance
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
    
    # Plot video line
    ax.plot(video_days, video_views, 'o-', color=color, linewidth=2, markersize=8,
            label=f'Actual Performance ({performance_ratio:.1f}x)')
    
    # Set log scale
    ax.set_yscale('log')
    
    # Labels and title
    ax.set_xlabel('Days Since Published', fontsize=12)
    ax.set_ylabel('View Count (Log Scale)', fontsize=12)
    ax.set_title(f'Performance Envelope Analysis (Log Scale)\n{video["title"][:80]}', fontsize=14, pad=20)
    
    # Set limits
    ax.set_xlim(0, min(max(video_days) + 10, 365))
    ax.set_ylim(100, max(video_views) * 10)  # Start at 100 views for log scale
    
    # Grid and legend
    ax.grid(True, alpha=0.3, which='both')
    ax.legend(loc='upper left', framealpha=0.9)
    
    # Add performance lines
    ax.axhline(y=expected_views * 3, color='red', linestyle=':', alpha=0.5)
    ax.text(200, expected_views * 3.5, 'Viral Threshold (3x)', fontsize=9, color='red')
    
    ax.axhline(y=expected_views * 1.5, color='orange', linestyle=':', alpha=0.5)
    ax.text(200, expected_views * 1.7, 'Outperforming (1.5x)', fontsize=9, color='orange')
    
    # Stats box
    stats_text = f"""Performance Stats:
Current: {current_views:,} views
Expected: {expected_views:,.0f} views
Ratio: {performance_ratio:.1f}x
Category: {category}
Age: {current_age} days"""
    
    ax.text(0.02, 0.98, stats_text, transform=ax.transAxes,
            verticalalignment='top', bbox=dict(boxstyle='round', facecolor='white', alpha=0.9),
            fontsize=10)
    
    plt.tight_layout()
    
    # Save
    output_path = 'log_scale_performance_envelope.png'
    plt.savefig(output_path, dpi=300, bbox_inches='tight')
    print(f"\n💾 Chart saved to: {output_path}")
    
    plt.show()

if __name__ == "__main__":
    create_log_performance_chart()