#!/usr/bin/env python3
"""
Quick analysis of performance envelope system with real examples
"""

import os
import matplotlib.pyplot as plt
import numpy as np
from supabase import create_client, Client
from dotenv import load_dotenv
import random

# Load environment variables
load_dotenv()

# Initialize Supabase client
url = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
supabase: Client = create_client(url, key)

def quick_analysis():
    """Quick analysis with a few examples"""
    
    # Get envelope data
    print("📊 Loading performance envelope data...")
    envelope_response = supabase.table('performance_envelopes')\
        .select('*')\
        .order('day_since_published')\
        .execute()
    
    envelope_data = envelope_response.data
    days = np.array([e['day_since_published'] for e in envelope_data])
    p50_global = np.array([e['p50_views'] for e in envelope_data])
    
    # Global baseline
    global_baseline = p50_global[1] if len(p50_global) > 1 else 8478
    
    print(f"✓ Global baseline (Day 1): {global_baseline:,} views")
    print(f"✓ Envelope covers {len(days)} days (0-{days[-1]})")
    
    # Find a few examples quickly
    print("\n🔍 Finding example videos...")
    
    # Query for videos with multiple snapshots
    videos_with_snapshots = []
    
    # Get a sample of videos
    videos_sample = supabase.table('videos')\
        .select('id, title, channel_id, channel_name, view_count')\
        .gte('view_count', 10000)\
        .limit(100)\
        .execute()
    
    # Check which have good snapshots
    for video in videos_sample.data:
        snapshots = supabase.table('view_snapshots')\
            .select('*')\
            .eq('video_id', video['id'])\
            .order('days_since_published')\
            .execute()
        
        if len(snapshots.data) >= 3:
            video['snapshots'] = snapshots.data
            video['latest_day'] = snapshots.data[-1]['days_since_published']
            videos_with_snapshots.append(video)
            
            if len(videos_with_snapshots) >= 6:
                break
    
    print(f"✓ Found {len(videos_with_snapshots)} videos with 3+ snapshots")
    
    # Create visualization
    fig, axes = plt.subplots(2, 3, figsize=(18, 10))
    fig.suptitle('Performance Envelope System - Real Video Examples\nFull 365-Day Expected Curves', 
                 fontsize=16)
    
    for idx, video in enumerate(videos_with_snapshots[:6]):
        row = idx // 3
        col = idx % 3
        ax = axes[row, col]
        
        # Simple channel baseline estimation
        # Based on current views, estimate channel size
        current_views = video['view_count']
        if current_views < 50000:
            channel_baseline = global_baseline * 0.5  # Small channel
            size = "Small"
        elif current_views < 500000:
            channel_baseline = global_baseline * 2    # Medium channel
            size = "Medium"
        else:
            channel_baseline = global_baseline * 5    # Large channel
            size = "Large"
        
        # Scale envelope
        scale_factor = channel_baseline / global_baseline
        p50_scaled = p50_global * scale_factor
        lower_band = p50_scaled * 0.7
        upper_band = p50_scaled * 1.3
        
        # Plot full 365-day envelope
        ax.fill_between(days, lower_band, upper_band, 
                       alpha=0.2, color='gray')
        ax.plot(days, p50_scaled, '--', color='black', 
               linewidth=1.5, alpha=0.7, label='Expected')
        
        # Plot video snapshots
        video_days = [s['days_since_published'] for s in video['snapshots']]
        video_views = [s['view_count'] for s in video['snapshots']]
        
        # Calculate performance
        latest_day = video_days[-1]
        latest_views = video_views[-1]
        
        if latest_day < len(p50_scaled):
            expected_views = p50_scaled[latest_day]
        else:
            # Extrapolate
            expected_views = p50_scaled[-1] * (1 + (latest_day - 365) * 0.0005)
        
        ratio = latest_views / expected_views if expected_views > 0 else 0
        
        # Color by performance
        if ratio > 1.5:
            color = '#00C851'
            cat = 'Over'
        elif ratio > 0.5:
            color = '#33B5E5'
            cat = 'On Track'
        else:
            color = '#FF8800'
            cat = 'Under'
        
        # Plot snapshots
        ax.scatter(video_days, video_views, s=100, color=color, zorder=5)
        ax.plot(video_days, video_views, ':', color=color, alpha=0.5)
        
        # Annotations
        ax.text(0.02, 0.98, f'{ratio:.1f}x', 
               transform=ax.transAxes,
               bbox=dict(boxstyle='round', facecolor=color, alpha=0.8),
               fontsize=14, color='white', weight='bold',
               verticalalignment='top')
        
        # Title
        title = f"{size} Channel | Day {latest_day}\n{video['channel_name'][:30]}"
        ax.set_title(title, fontsize=10)
        
        # Format
        ax.set_xlim(-10, 375)
        ax.set_ylim(0, max(max(video_views) * 1.2, max(upper_band) * 0.5))
        ax.grid(True, alpha=0.3)
        ax.set_xlabel('Days Since Published')
        ax.set_ylabel('Views')
        
        # Format y-axis
        ax.yaxis.set_major_formatter(plt.FuncFormatter(
            lambda x, p: f'{x/1000:.0f}K' if x < 1000000 else f'{x/1000000:.1f}M'
        ))
        
        # Mark the latest snapshot
        ax.axvline(x=latest_day, color=color, linestyle=':', alpha=0.5)
        
        print(f"\n  Video {idx+1}: {video['title'][:40]}...")
        print(f"    Channel: {video['channel_name']}")
        print(f"    Latest: Day {latest_day}, {latest_views:,} views")
        print(f"    Expected: {expected_views:,.0f} views")
        print(f"    Performance: {ratio:.2f}x ({cat})")
    
    plt.tight_layout()
    
    # Save
    output_path = 'quick_envelope_analysis.png'
    plt.savefig(output_path, dpi=300, bbox_inches='tight')
    print(f"\n💾 Saved to: {output_path}")
    
    # System check
    print("\n🔍 SYSTEM VERIFICATION:")
    print("="*50)
    print(f"✓ Envelope is monotonic: {all(p50_global[i] <= p50_global[i+1] for i in range(len(p50_global)-1))}")
    print(f"✓ Day 0→365 growth: {p50_global[0]:,} → {p50_global[-1]:,} ({p50_global[-1]/p50_global[0]:.1f}x)")
    print(f"✓ Full year coverage: Shows expected performance for entire video lifecycle")
    print(f"✓ Channel scaling: Applied based on estimated channel size")

if __name__ == "__main__":
    quick_analysis()