#!/usr/bin/env python3
"""
Validate our performance curves using Make or Break Shop's real data
This will show if our curves accurately predict video growth
"""

import os
import matplotlib.pyplot as plt
import numpy as np
from supabase import create_client, Client
from dotenv import load_dotenv
from scipy.interpolate import interp1d
import pandas as pd

# Load environment variables
load_dotenv()

# Initialize Supabase client
url = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
supabase: Client = create_client(url, key)

def validate_with_channel_data():
    """Validate curves using Make or Break Shop's actual data"""
    
    print("🔍 Validating performance curves with Make or Break Shop data...")
    
    # Step 1: Get Make or Break Shop's actual video growth data
    print("\n1️⃣ Fetching Make or Break Shop video tracking data...")
    
    channel_data = supabase.rpc('execute_sql', {
        'query': """
        SELECT 
            v.id,
            v.title,
            v.view_count as current_views,
            v.published_at,
            json_agg(
                json_build_object(
                    'day', vs.days_since_published,
                    'views', vs.view_count
                ) ORDER BY vs.days_since_published
            ) as snapshots
        FROM videos v
        JOIN view_snapshots vs ON v.id = vs.video_id
        WHERE v.channel_id = 'Make or Break Shop'
          AND v.published_at > '2024-01-01'
        GROUP BY v.id, v.title, v.view_count, v.published_at
        HAVING COUNT(vs.*) >= 3
        ORDER BY v.view_count DESC
        LIMIT 10
        """
    }).execute()
    
    videos = channel_data.data
    print(f"✓ Found {len(videos)} well-tracked videos")
    
    # Step 2: Get our global curve data (raw, not monotonic)
    print("\n2️⃣ Calculating fresh global curve from raw data...")
    
    raw_medians = supabase.rpc('execute_sql', {
        'query': """
        SELECT 
            days_since_published,
            PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY view_count) as median_views,
            COUNT(*) as sample_count
        FROM view_snapshots
        WHERE days_since_published <= 90
        GROUP BY days_since_published
        ORDER BY days_since_published
        """
    }).execute()
    
    # Convert to arrays
    global_days = np.array([d['days_since_published'] for d in raw_medians.data])
    global_medians = np.array([d['median_views'] for d in raw_medians.data])
    
    # Create interpolation function for smooth curve
    global_curve = interp1d(global_days, global_medians, 
                           kind='cubic', fill_value='extrapolate')
    
    # Step 3: Calculate Make or Break Shop's channel baseline
    print("\n3️⃣ Calculating channel baseline...")
    
    channel_baseline = supabase.rpc('execute_sql', {
        'query': """
        SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY view_count) as baseline
        FROM view_snapshots vs
        JOIN videos v ON vs.video_id = v.id
        WHERE v.channel_id = 'Make or Break Shop'
          AND vs.days_since_published <= 7
        """
    }).execute()
    
    channel_median = channel_baseline.data[0]['baseline']
    global_day7_median = global_curve(7)
    scale_factor = channel_median / global_day7_median
    
    print(f"  Channel 7-day median: {channel_median:,.0f} views")
    print(f"  Global 7-day median: {global_day7_median:,.0f} views")
    print(f"  Scale factor: {scale_factor:.2f}x")
    
    # Step 4: Create visualization
    fig, ((ax1, ax2), (ax3, ax4)) = plt.subplots(2, 2, figsize=(16, 12))
    
    # Plot 1: Show top 3 videos vs scaled global curve
    print("\n4️⃣ Plotting validation results...")
    colors = ['#1f77b4', '#ff7f0e', '#2ca02c']
    
    for i, video in enumerate(videos[:3]):
        snapshots = video['snapshots']
        days = [s['day'] for s in snapshots]
        views = [s['views'] for s in snapshots]
        
        # Plot actual data
        ax1.plot(days, views, 'o-', color=colors[i], 
                label=f"{video['title'][:40]}...", linewidth=2, markersize=8)
        
        # Plot expected curve (scaled global)
        smooth_days = np.linspace(min(days), max(days), 100)
        expected_views = global_curve(smooth_days) * scale_factor
        ax1.plot(smooth_days, expected_views, '--', color=colors[i], 
                alpha=0.5, linewidth=2)
    
    ax1.set_title('Top 3 Videos: Actual vs Expected Growth', fontsize=14)
    ax1.set_xlabel('Days Since Published')
    ax1.set_ylabel('Views')
    ax1.legend(fontsize=10)
    ax1.grid(True, alpha=0.3)
    ax1.set_yscale('log')
    
    # Plot 2: Performance ratios over time
    for i, video in enumerate(videos[:3]):
        snapshots = video['snapshots']
        days = [s['day'] for s in snapshots]
        views = [s['views'] for s in snapshots]
        
        # Calculate performance ratios
        expected = [global_curve(d) * scale_factor for d in days]
        ratios = [v/e for v, e in zip(views, expected)]
        
        ax2.plot(days, ratios, 'o-', color=colors[i], 
                label=f"{video['title'][:40]}...", linewidth=2, markersize=8)
    
    ax2.axhline(y=1, color='black', linestyle='--', alpha=0.5, label='Expected (1.0x)')
    ax2.axhline(y=3, color='red', linestyle='--', alpha=0.3, label='Viral (3.0x)')
    ax2.set_title('Performance Ratio Over Time (Actual/Expected)', fontsize=14)
    ax2.set_xlabel('Days Since Published')
    ax2.set_ylabel('Performance Ratio')
    ax2.legend(fontsize=10)
    ax2.grid(True, alpha=0.3)
    
    # Plot 3: All 10 videos normalized view growth
    for i, video in enumerate(videos):
        snapshots = video['snapshots']
        if len(snapshots) < 2:
            continue
        days = [s['day'] for s in snapshots]
        views = [s['views'] for s in snapshots]
        
        # Normalize to first snapshot
        normalized = [v/views[0] for v in views]
        ax3.plot(days, normalized, 'o-', alpha=0.7, linewidth=1.5)
    
    # Add expected normalized growth
    norm_days = np.linspace(0, 90, 91)
    expected_norm = global_curve(norm_days) / global_curve(norm_days[0])
    ax3.plot(norm_days, expected_norm, 'k--', linewidth=2, 
             label='Expected growth pattern')
    
    ax3.set_title('All Videos: Normalized Growth (First View = 1.0)', fontsize=14)
    ax3.set_xlabel('Days Since Published')
    ax3.set_ylabel('Normalized Views')
    ax3.legend()
    ax3.grid(True, alpha=0.3)
    ax3.set_yscale('log')
    
    # Plot 4: Summary statistics
    ax4.axis('off')
    
    # Calculate accuracy metrics
    all_ratios = []
    for video in videos:
        snapshots = video['snapshots']
        for snap in snapshots:
            expected = global_curve(snap['day']) * scale_factor
            ratio = snap['views'] / expected
            all_ratios.append(ratio)
    
    median_ratio = np.median(all_ratios)
    mean_ratio = np.mean(all_ratios)
    std_ratio = np.std(all_ratios)
    
    summary_text = f"""
    VALIDATION RESULTS
    
    Channel: Make or Break Shop
    Videos analyzed: {len(videos)}
    Total snapshots: {len(all_ratios)}
    
    Performance vs Expected:
    • Median ratio: {median_ratio:.2f}x
    • Mean ratio: {mean_ratio:.2f}x
    • Std deviation: {std_ratio:.2f}
    
    Accuracy Assessment:
    • {'✅ GOOD' if 0.8 <= median_ratio <= 1.2 else '⚠️  NEEDS ADJUSTMENT'}
    
    The global curve {'accurately predicts' if 0.8 <= median_ratio <= 1.2 else 'needs scaling for'} 
    Make or Break Shop's performance.
    
    Top performer: {videos[0]['title'][:50]}...
    Views: {videos[0]['current_views']:,}
    """
    
    ax4.text(0.1, 0.5, summary_text, fontsize=12, 
             verticalalignment='center', fontfamily='monospace')
    
    plt.tight_layout()
    plt.savefig('make_or_break_validation.png', dpi=300, bbox_inches='tight')
    print(f"\n💾 Saved validation chart to: make_or_break_validation.png")
    
    return median_ratio, scale_factor

if __name__ == "__main__":
    median_ratio, scale_factor = validate_with_channel_data()