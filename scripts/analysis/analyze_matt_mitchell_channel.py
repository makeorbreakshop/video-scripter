#!/usr/bin/env python3
"""
Analyze all Matt Mitchell videos to check if normalization is correct
"""

import os
import matplotlib.pyplot as plt
import numpy as np
from supabase import create_client, Client
from dotenv import load_dotenv
import matplotlib.cm as cm

# Load environment variables
load_dotenv()

# Initialize Supabase client
url = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
supabase: Client = create_client(url, key)

def analyze_matt_mitchell():
    """Analyze all Matt Mitchell videos"""
    
    print("📊 Analyzing Matt Mitchell's channel...")
    
    # Get envelope data
    envelope_response = supabase.table('performance_envelopes')\
        .select('*')\
        .order('day_since_published')\
        .execute()
    
    envelope_data = envelope_response.data
    days = np.array([e['day_since_published'] for e in envelope_data])
    p50_global = np.array([e['p50_views'] for e in envelope_data])
    
    # Global baseline
    global_baseline = p50_global[1] if len(p50_global) > 1 else 8478
    
    # Find Matt Mitchell's channel
    matt_videos = supabase.table('videos')\
        .select('*')\
        .eq('channel_name', 'Matt Mitchell')\
        .execute()
    
    if not matt_videos.data:
        print("❌ No Matt Mitchell videos found")
        return
    
    print(f"✓ Found {len(matt_videos.data)} Matt Mitchell videos")
    
    # Get channel ID
    channel_id = matt_videos.data[0]['channel_id']
    
    # Calculate PROPER channel baseline from first-week performance
    print("\n📊 Calculating Matt Mitchell's channel baseline...")
    
    # Get ALL first-week snapshots for this channel
    first_week_snapshots = []
    for video in matt_videos.data:
        snapshots = supabase.table('view_snapshots')\
            .select('*')\
            .eq('video_id', video['id'])\
            .lte('days_since_published', 7)\
            .execute()
        
        first_week_snapshots.extend(snapshots.data)
    
    if first_week_snapshots:
        # Calculate trimmed median
        first_week_views = sorted([s['view_count'] for s in first_week_snapshots])
        trim_start = int(len(first_week_views) * 0.1)
        trim_end = int(len(first_week_views) * 0.9)
        trimmed = first_week_views[trim_start:trim_end] if trim_end > trim_start else first_week_views
        
        channel_baseline = np.median(trimmed) if trimmed else global_baseline
        print(f"✓ Channel baseline (first-week median): {channel_baseline:,.0f} views")
        print(f"✓ Based on {len(first_week_snapshots)} first-week snapshots")
    else:
        # Fallback: estimate from current views
        avg_views = np.median([v['view_count'] for v in matt_videos.data])
        channel_baseline = avg_views / 10  # Rough estimate
        print(f"⚠️  No first-week data, estimating baseline: {channel_baseline:,.0f} views")
    
    # Scale envelope to channel
    scale_factor = channel_baseline / global_baseline
    p50_scaled = p50_global * scale_factor
    lower_band = p50_scaled * 0.7
    upper_band = p50_scaled * 1.3
    
    print(f"✓ Scale factor: {scale_factor:.2f}x global baseline")
    
    # Create visualization
    plt.figure(figsize=(16, 10))
    
    # Plot envelope
    plt.fill_between(days, lower_band, upper_band, 
                    alpha=0.2, color='gray', 
                    label='Expected Range (±30%)')
    plt.plot(days, p50_scaled, '--', color='black', 
            linewidth=2, label='Expected Performance', alpha=0.7)
    
    # Color map for videos
    colors = cm.rainbow(np.linspace(0, 1, len(matt_videos.data)))
    
    # Track performance ratios
    performance_stats = []
    
    # Plot each video
    for idx, video in enumerate(matt_videos.data):
        # Get snapshots
        snapshots = supabase.table('view_snapshots')\
            .select('*')\
            .eq('video_id', video['id'])\
            .order('days_since_published')\
            .execute()
        
        if snapshots.data:
            video_days = [s['days_since_published'] for s in snapshots.data]
            video_views = [s['view_count'] for s in snapshots.data]
            
            # Plot with unique color
            plt.scatter(video_days, video_views, 
                       s=80, color=colors[idx], alpha=0.7,
                       label=f"{video['title'][:30]}...")
            plt.plot(video_days, video_views, ':', color=colors[idx], alpha=0.5)
            
            # Calculate performance at latest snapshot
            latest_day = video_days[-1]
            latest_views = video_views[-1]
            
            if latest_day < len(p50_scaled):
                expected_views = p50_scaled[latest_day]
            else:
                expected_views = p50_scaled[-1]
            
            ratio = latest_views / expected_views if expected_views > 0 else 0
            
            performance_stats.append({
                'title': video['title'][:40],
                'day': latest_day,
                'views': latest_views,
                'expected': expected_views,
                'ratio': ratio
            })
    
    # Add title and labels
    plt.title(f'Matt Mitchell Channel Analysis - All Videos vs Expected Performance\n'
              f'Channel Baseline: {channel_baseline:,.0f} views | Scale Factor: {scale_factor:.2f}x', 
              fontsize=14)
    plt.xlabel('Days Since Published', fontsize=12)
    plt.ylabel('View Count', fontsize=12)
    
    # Format y-axis
    plt.gca().yaxis.set_major_formatter(plt.FuncFormatter(
        lambda x, p: f'{x/1000:.0f}K' if x < 1000000 else f'{x/1000000:.1f}M'
    ))
    
    # Limits
    plt.xlim(-10, 400)
    plt.ylim(0, max(300000, max([v['view_count'] for v in matt_videos.data]) * 1.2))
    
    # Grid
    plt.grid(True, alpha=0.3)
    
    # Legend (compact)
    plt.legend(bbox_to_anchor=(1.05, 1), loc='upper left', fontsize=8)
    
    plt.tight_layout()
    
    # Save
    output_path = 'matt_mitchell_analysis.png'
    plt.savefig(output_path, dpi=300, bbox_inches='tight')
    print(f"\n💾 Saved to: {output_path}")
    
    # Print performance analysis
    print("\n📊 PERFORMANCE ANALYSIS:")
    print("="*80)
    print(f"{'Video':<40} {'Day':<6} {'Views':<12} {'Expected':<12} {'Ratio':<8}")
    print("-"*80)
    
    ratios = []
    for stat in sorted(performance_stats, key=lambda x: x['ratio'], reverse=True):
        print(f"{stat['title']:<40} {stat['day']:<6} {stat['views']:<12,} {stat['expected']:<12,.0f} {stat['ratio']:<8.2f}x")
        ratios.append(stat['ratio'])
    
    print("-"*80)
    print(f"\nSUMMARY:")
    print(f"Average performance ratio: {np.mean(ratios):.2f}x")
    print(f"Median performance ratio: {np.median(ratios):.2f}x")
    print(f"Videos over 1.5x: {sum(1 for r in ratios if r > 1.5)}/{len(ratios)}")
    print(f"Videos under 0.5x: {sum(1 for r in ratios if r < 0.5)}/{len(ratios)}")
    
    if np.median(ratios) > 2.0:
        print("\n⚠️  WARNING: Most videos are overperforming!")
        print("This suggests the channel baseline might be too low.")
        print("Possible issues:")
        print("- Not enough first-week data for accurate baseline")
        print("- Channel has grown significantly since early videos")
        print("- Channel is genuinely exceptional")

if __name__ == "__main__":
    analyze_matt_mitchell()