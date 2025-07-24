#!/usr/bin/env python3
"""
Smart channel baseline calculation
Only use videos with early tracking data to establish growth patterns
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

def smart_baseline_calculation():
    """Calculate baseline using only videos with early tracking"""
    
    print("📊 Smart baseline calculation for Matt Mitchell...")
    
    # Get envelope data
    envelope_response = supabase.table('performance_envelopes')\
        .select('*')\
        .order('day_since_published')\
        .execute()
    
    envelope_data = envelope_response.data
    days = np.array([e['day_since_published'] for e in envelope_data])
    p50_global = np.array([e['p50_views'] for e in envelope_data])
    
    # Get all Matt Mitchell videos
    matt_videos = supabase.table('videos')\
        .select('*')\
        .eq('channel_name', 'Matt Mitchell')\
        .execute()
    
    print(f"✓ Found {len(matt_videos.data)} videos")
    
    # Categorize videos by tracking quality
    early_tracked = []  # Has snapshots in first 30 days
    late_tracked = []   # Only has snapshots after 30 days
    
    for video in matt_videos.data:
        snapshots = supabase.table('view_snapshots')\
            .select('*')\
            .eq('video_id', video['id'])\
            .order('days_since_published')\
            .execute()
        
        if snapshots.data:
            earliest_day = min(s['days_since_published'] for s in snapshots.data)
            video['snapshots'] = snapshots.data
            video['earliest_tracking'] = earliest_day
            
            if earliest_day <= 30:
                early_tracked.append(video)
            else:
                late_tracked.append(video)
    
    print(f"\n📊 Tracking Analysis:")
    print(f"   Early tracked (≤30 days): {len(early_tracked)} videos")
    print(f"   Late tracked (>30 days): {len(late_tracked)} videos")
    
    # Calculate baseline from ONLY early-tracked videos
    if early_tracked:
        print(f"\n✅ Using {len(early_tracked)} early-tracked videos for baseline:")
        
        early_views = []
        for video in early_tracked:
            # Get first-week views
            first_week = [s for s in video['snapshots'] if s['days_since_published'] <= 7]
            if first_week:
                early_views.extend([s['view_count'] for s in first_week])
                print(f"   {video['title'][:40]:40} - {len(first_week)} early snapshots")
        
        if early_views:
            channel_baseline = np.median(early_views)
            print(f"\n✓ Channel baseline from early data: {channel_baseline:,.0f} views")
        else:
            channel_baseline = 50000  # Reasonable default
            print(f"\n⚠️  No first-week data, using default: {channel_baseline:,.0f} views")
    else:
        # No early tracked videos - estimate from late data
        print("\n⚠️  NO early-tracked videos! Estimating from plateau values...")
        
        # Use plateau values and work backwards
        plateau_views = []
        for video in late_tracked[:20]:  # Sample some videos
            if video['snapshots']:
                latest = video['snapshots'][-1]
                plateau_views.append(latest['view_count'])
        
        if plateau_views:
            # Rough estimate: Day 1 is typically 5-10% of plateau
            median_plateau = np.median(plateau_views)
            channel_baseline = median_plateau * 0.07
            print(f"   Median plateau: {median_plateau:,.0f} views")
            print(f"   Estimated baseline (7% of plateau): {channel_baseline:,.0f} views")
        else:
            channel_baseline = 50000
    
    # Calculate scale factor
    global_baseline = p50_global[1] if len(p50_global) > 1 else 8478
    scale_factor = channel_baseline / global_baseline
    
    print(f"\n📊 Final Parameters:")
    print(f"   Channel baseline: {channel_baseline:,.0f} views")
    print(f"   Scale factor: {scale_factor:.2f}x")
    
    # Create visualization
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(18, 8))
    
    # Left plot: Early vs Late tracked videos
    p50_scaled = p50_global * scale_factor
    lower_band = p50_scaled * 0.7
    upper_band = p50_scaled * 1.3
    
    ax1.fill_between(days, lower_band, upper_band, 
                    alpha=0.2, color='gray', label='Expected Range')
    ax1.plot(days, p50_scaled, '-', color='black', 
            linewidth=2, label='Expected (smart baseline)', alpha=0.8)
    
    # Plot early-tracked videos
    for video in early_tracked[:10]:  # Show up to 10
        if video['snapshots']:
            v_days = [s['days_since_published'] for s in video['snapshots']]
            v_views = [s['view_count'] for s in video['snapshots']]
            ax1.plot(v_days, v_views, 'o-', alpha=0.7, markersize=6)
    
    ax1.set_title(f'Early-Tracked Videos (First snapshot ≤30 days)\n'
                  f'{len(early_tracked)} videos with growth data', fontsize=12)
    ax1.set_xlabel('Days Since Published')
    ax1.set_ylabel('Views')
    ax1.set_xlim(-5, 120)
    ax1.set_ylim(0, 500000)
    ax1.grid(True, alpha=0.3)
    ax1.legend()
    
    # Right plot: Late-tracked videos
    ax2.fill_between(days, lower_band, upper_band, 
                    alpha=0.2, color='gray')
    ax2.plot(days, p50_scaled, '-', color='black', 
            linewidth=2, alpha=0.8)
    
    # Plot late-tracked videos
    for video in late_tracked[:20]:  # Show up to 20
        if video['snapshots']:
            v_days = [s['days_since_published'] for s in video['snapshots']]
            v_views = [s['view_count'] for s in video['snapshots']]
            ax2.scatter(v_days, v_views, alpha=0.5, s=30, color='red')
    
    ax2.set_title(f'Late-Tracked Videos (First snapshot >30 days)\n'
                  f'{len(late_tracked)} videos - mostly plateaued!', fontsize=12)
    ax2.set_xlabel('Days Since Published')
    ax2.set_ylabel('Views')
    ax2.set_xlim(-50, 2200)
    ax2.set_ylim(0, 2000000)
    ax2.grid(True, alpha=0.3)
    
    # Format y-axes
    for ax in [ax1, ax2]:
        ax.yaxis.set_major_formatter(plt.FuncFormatter(
            lambda x, p: f'{x/1000:.0f}K' if x < 1000000 else f'{x/1000000:.1f}M'
        ))
    
    fig.suptitle('Matt Mitchell Channel: The Late-Tracking Problem\n'
                 'Most videos are tracked after growth phase - causing baseline issues',
                 fontsize=14)
    
    plt.tight_layout()
    
    # Save
    output_path = 'smart_baseline_analysis.png'
    plt.savefig(output_path, dpi=300, bbox_inches='tight')
    print(f"\n💾 Saved to: {output_path}")
    
    # Summary insights
    print("\n🔍 KEY INSIGHTS:")
    print(f"1. Only {len(early_tracked)}/{len(matt_videos.data)} videos have early tracking")
    print(f"2. {len(late_tracked)} videos are tracked too late to assess growth")
    print("3. Late-tracked videos will ALWAYS appear to underperform")
    print("4. The system works best with early tracking data")
    print("\n💡 SOLUTION: Focus performance analysis on videos with early snapshots")

if __name__ == "__main__":
    smart_baseline_calculation()