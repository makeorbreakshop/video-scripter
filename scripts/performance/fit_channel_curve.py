#!/usr/bin/env python3
"""
Fit the global curve to a channel's actual performance data
Find the best scaling factor that minimizes error across all videos
"""

import os
import matplotlib.pyplot as plt
import numpy as np
from supabase import create_client, Client
from dotenv import load_dotenv
from scipy.optimize import minimize_scalar

# Load environment variables
load_dotenv()

# Initialize Supabase client
url = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
supabase: Client = create_client(url, key)

def calculate_channel_fit():
    """Find the best-fit scaling for Matt Mitchell's channel"""
    
    print("📊 Finding best-fit curve for Matt Mitchell...")
    
    # Get envelope data
    envelope_response = supabase.table('performance_envelopes')\
        .select('*')\
        .order('day_since_published')\
        .execute()
    
    envelope_data = envelope_response.data
    days = np.array([e['day_since_published'] for e in envelope_data])
    p50_global = np.array([e['p50_views'] for e in envelope_data])
    
    # Get all Matt Mitchell videos and their snapshots
    matt_videos = supabase.table('videos')\
        .select('*')\
        .eq('channel_name', 'Matt Mitchell')\
        .execute()
    
    print(f"✓ Found {len(matt_videos.data)} videos")
    
    # Collect all snapshots
    all_snapshots = []
    for video in matt_videos.data:
        snapshots = supabase.table('view_snapshots')\
            .select('*')\
            .eq('video_id', video['id'])\
            .execute()
        
        all_snapshots.extend(snapshots.data)
    
    print(f"✓ Total snapshots: {len(all_snapshots)}")
    
    # Function to calculate error for a given scale factor
    def calculate_error(scale_factor):
        """Calculate total error for this scale factor"""
        total_error = 0
        count = 0
        
        for snapshot in all_snapshots:
            day = snapshot['days_since_published']
            actual_views = snapshot['view_count']
            
            # Get expected views at this day with this scale factor
            if day < len(p50_global):
                expected_views = p50_global[day] * scale_factor
            else:
                # Extrapolate for days beyond 365
                expected_views = p50_global[-1] * scale_factor * (1 + (day - 365) * 0.0001)
            
            # Calculate relative error
            if expected_views > 0:
                error = ((actual_views - expected_views) / expected_views) ** 2
                total_error += error
                count += 1
        
        return total_error / count if count > 0 else float('inf')
    
    # Find optimal scale factor
    print("\n🔍 Finding optimal scale factor...")
    result = minimize_scalar(calculate_error, bounds=(0.1, 50), method='bounded')
    optimal_scale = result.x
    
    # Calculate what this means in terms of baseline
    global_baseline = p50_global[1] if len(p50_global) > 1 else 8478
    optimal_baseline = global_baseline * optimal_scale
    
    print(f"\n✅ OPTIMAL FIT FOUND:")
    print(f"   Scale factor: {optimal_scale:.2f}x")
    print(f"   Implied baseline: {optimal_baseline:,.0f} views")
    print(f"   (vs. our bad estimate: 158,506 views)")
    
    # Create visualization with the optimal fit
    plt.figure(figsize=(16, 10))
    
    # Plot optimal envelope
    p50_optimal = p50_global * optimal_scale
    lower_optimal = p50_optimal * 0.7
    upper_optimal = p50_optimal * 1.3
    
    plt.fill_between(days, lower_optimal, upper_optimal, 
                    alpha=0.2, color='green', 
                    label='Optimal Fit Range (±30%)')
    plt.plot(days, p50_optimal, '-', color='green', 
            linewidth=2, label=f'Best Fit (scale={optimal_scale:.1f}x)', alpha=0.8)
    
    # Also show our bad fit for comparison
    bad_scale = 18.7  # What we calculated before
    p50_bad = p50_global * bad_scale
    plt.plot(days, p50_bad, '--', color='red', 
            linewidth=1, label=f'Bad Fit (scale={bad_scale:.1f}x)', alpha=0.5)
    
    # Plot all snapshots
    snapshot_days = [s['days_since_published'] for s in all_snapshots]
    snapshot_views = [s['view_count'] for s in all_snapshots]
    
    # Color by performance under optimal fit
    colors = []
    ratios = []
    for s in all_snapshots:
        day = s['days_since_published']
        views = s['view_count']
        
        if day < len(p50_optimal):
            expected = p50_optimal[day]
        else:
            expected = p50_optimal[-1] * (1 + (day - 365) * 0.0001)
        
        ratio = views / expected if expected > 0 else 0
        ratios.append(ratio)
        
        if ratio > 1.5:
            colors.append('#00C851')
        elif ratio > 0.5:
            colors.append('#33B5E5')
        else:
            colors.append('#FF8800')
    
    plt.scatter(snapshot_days, snapshot_views, 
               s=30, c=colors, alpha=0.6)
    
    # Title and labels
    plt.title(f'Matt Mitchell Channel - Optimal Curve Fit\n'
              f'Best fit minimizes error across all {len(all_snapshots)} snapshots', 
              fontsize=14)
    plt.xlabel('Days Since Published', fontsize=12)
    plt.ylabel('View Count', fontsize=12)
    
    # Format y-axis
    plt.gca().yaxis.set_major_formatter(plt.FuncFormatter(
        lambda x, p: f'{x/1000:.0f}K' if x < 1000000 else f'{x/1000000:.1f}M'
    ))
    
    # Limits
    plt.xlim(-10, 400)
    plt.ylim(0, 1000000)
    
    # Grid and legend
    plt.grid(True, alpha=0.3)
    plt.legend(loc='upper left')
    
    # Add stats box
    ratio_array = np.array(ratios)
    stats_text = f"""Performance with Optimal Fit:
    Median ratio: {np.median(ratio_array):.2f}x
    Mean ratio: {np.mean(ratio_array):.2f}x
    Over 1.5x: {sum(1 for r in ratio_array if r > 1.5)} videos
    Under 0.5x: {sum(1 for r in ratio_array if r < 0.5)} videos"""
    
    plt.text(0.02, 0.98, stats_text, transform=plt.gca().transAxes,
            verticalalignment='top', 
            bbox=dict(boxstyle='round', facecolor='white', alpha=0.9),
            fontsize=11, family='monospace')
    
    plt.tight_layout()
    
    # Save
    output_path = 'optimal_channel_fit.png'
    plt.savefig(output_path, dpi=300, bbox_inches='tight')
    print(f"\n💾 Saved to: {output_path}")
    
    # Analyze performance distribution
    print("\n📊 PERFORMANCE DISTRIBUTION WITH OPTIMAL FIT:")
    print(f"   Median performance: {np.median(ratio_array):.2f}x")
    print(f"   Mean performance: {np.mean(ratio_array):.2f}x")
    print(f"   Standard deviation: {np.std(ratio_array):.2f}")
    
    # Show a few examples
    print("\n📹 Sample videos with optimal fit:")
    
    # Get a few videos
    sample_videos = matt_videos.data[:5]
    for video in sample_videos:
        # Get latest snapshot
        video_snaps = [s for s in all_snapshots if s['video_id'] == video['id']]
        if video_snaps:
            latest = sorted(video_snaps, key=lambda x: x['days_since_published'])[-1]
            day = latest['days_since_published']
            views = latest['view_count']
            
            if day < len(p50_optimal):
                expected = p50_optimal[day]
            else:
                expected = p50_optimal[-1]
            
            ratio = views / expected if expected > 0 else 0
            print(f"   {video['title'][:40]:40} Day {day:4} - {ratio:.2f}x")

if __name__ == "__main__":
    calculate_channel_fit()