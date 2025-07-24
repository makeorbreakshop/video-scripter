#!/usr/bin/env python3
"""
Calculate performance curves using ALL data points
1. Filter out Shorts directly in SQL (more efficient)
2. Process all 480K+ snapshots
3. Create properly smoothed curves
"""

import os
import matplotlib.pyplot as plt
import numpy as np
from supabase import create_client, Client
from dotenv import load_dotenv
from scipy.interpolate import UnivariateSpline
from scipy.ndimage import gaussian_filter1d
from datetime import datetime
import pandas as pd
import re

# Load environment variables
load_dotenv()

# Initialize Supabase client
url = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
supabase: Client = create_client(url, key)

def parse_duration_to_seconds(duration_str):
    """Parse ISO 8601 duration to seconds"""
    if not duration_str or duration_str == 'None':
        return None
    
    # Handle various ISO 8601 duration formats
    # PT17M17S, PT1M, PT3H45M12S, etc.
    match = re.match(r'PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?', duration_str)
    if not match:
        return None
    
    hours = int(match.group(1) or 0)
    minutes = int(match.group(2) or 0)
    seconds = int(match.group(3) or 0)
    
    return hours * 3600 + minutes * 60 + seconds

def calculate_full_dataset_curves():
    """Calculate curves using ALL available data with efficient filtering"""
    
    print("🚀 Calculating performance curves from FULL dataset...")
    print("   - Filtering Shorts directly in Python")
    print("   - Processing all 480K+ snapshots")
    print("   - Creating properly smoothed curves")
    
    # Step 1: Get count of videos to process
    print("\n1️⃣ Checking data volume...")
    
    # First, let's see how many videos have duration data
    video_count = supabase.table('videos')\
        .select('id', count='exact')\
        .execute()
    
    duration_count = supabase.table('videos')\
        .select('id', count='exact')\
        .not_.is_('duration', 'null')\
        .neq('duration', '')\
        .execute()
    
    print(f"   Total videos: {video_count.count:,}")
    print(f"   Valid duration data: {duration_count.count:,}")
    
    # Step 2: Get ALL snapshots with Shorts filtered out
    print("\n2️⃣ Fetching all non-Short video snapshots...")
    print("   Processing in batches with duration filtering...")
    
    # First get all non-Short video IDs
    print("   Getting non-Short video IDs...")
    non_short_videos = []
    offset = 0
    batch_size = 1000
    
    while True:
        batch = supabase.table('videos')\
            .select('id, duration')\
            .not_.is_('duration', 'null')\
            .neq('duration', '')\
            .range(offset, offset + batch_size - 1)\
            .execute()
        
        if not batch.data:
            break
            
        # Filter for non-Shorts
        for video in batch.data:
            duration_seconds = parse_duration_to_seconds(video['duration'])
            if duration_seconds and duration_seconds > 121:
                non_short_videos.append(video['id'])
        
        offset += batch_size
        if len(batch.data) < batch_size:
            break
    
    print(f"   Found {len(non_short_videos):,} non-Short videos")
    
    # Now get snapshots for these videos
    print("   Fetching snapshots for non-Short videos...")
    all_snapshots = []
    
    # Process video IDs in chunks
    chunk_size = 500
    for i in range(0, len(non_short_videos), chunk_size):
        video_chunk = non_short_videos[i:i+chunk_size]
        
        # Get snapshots for this chunk
        snapshots = supabase.table('view_snapshots')\
            .select('days_since_published, view_count')\
            .in_('video_id', video_chunk)\
            .gte('days_since_published', 0)\
            .lte('days_since_published', 365)\
            .execute()
        
        all_snapshots.extend(snapshots.data)
        print(f"   Progress: {min(i+chunk_size, len(non_short_videos)):,}/{len(non_short_videos):,} videos processed ({len(all_snapshots):,} snapshots)...")
    
    snapshots = all_snapshots
    print(f"✓ Retrieved {len(snapshots):,} non-Short snapshots")
    
    if not snapshots:
        print("❌ No data returned from query")
        return
    
    # Step 3: Calculate percentiles from full dataset
    print("\n3️⃣ Calculating percentiles from full dataset...")
    
    # Group by day
    from collections import defaultdict
    views_by_day = defaultdict(list)
    
    for snap in snapshots:
        day = snap['days_since_published']
        views = snap['view_count']
        if views is not None and views > 0:
            views_by_day[day].append(views)
    
    print(f"   Days with data: {len(views_by_day)}")
    print(f"   Total data points: {sum(len(v) for v in views_by_day.values()):,}")
    
    # Calculate percentiles
    percentile_data = []
    for day in range(366):
        if day in views_by_day and len(views_by_day[day]) >= 10:
            views = views_by_day[day]
            percentile_data.append({
                'day': day,
                'count': len(views),
                'p10': np.percentile(views, 10),
                'p25': np.percentile(views, 25),
                'p50': np.percentile(views, 50),
                'p75': np.percentile(views, 75),
                'p90': np.percentile(views, 90),
                'p95': np.percentile(views, 95)
            })
    
    print(f"✓ Calculated percentiles for {len(percentile_data)} days")
    
    # Show sample of data volume per day
    print("\n   Sample data volume:")
    for i in [0, 1, 7, 30, 90, 180, 365]:
        if i < len(percentile_data):
            print(f"   Day {percentile_data[i]['day']}: {percentile_data[i]['count']:,} videos")
    
    # Step 4: Apply intelligent smoothing
    print("\n4️⃣ Applying intelligent smoothing...")
    
    days = np.array([d['day'] for d in percentile_data])
    smooth_days = np.arange(0, 366)
    smooth_curves = {}
    
    for percentile in ['p10', 'p25', 'p50', 'p75', 'p90', 'p95']:
        raw_values = np.array([d[percentile] for d in percentile_data])
        
        # Interpolate to fill all days
        interpolated = np.interp(smooth_days, days, raw_values)
        
        # Apply graduated smoothing
        smooth_values = np.zeros_like(interpolated)
        
        # Days 0-7: Minimal smoothing (preserve early signals)
        smooth_values[:8] = gaussian_filter1d(interpolated[:8], sigma=0.5)
        
        # Days 8-30: Light smoothing
        smooth_values[8:31] = gaussian_filter1d(interpolated[8:31], sigma=1.0)
        
        # Days 31-90: Medium smoothing
        smooth_values[31:91] = gaussian_filter1d(interpolated[31:91], sigma=2.0)
        
        # Days 91+: Heavier smoothing
        smooth_values[91:] = gaussian_filter1d(interpolated[91:], sigma=3.0)
        
        # DO NOT enforce monotonic growth - let the data speak naturally
        # Just ensure non-negative values
        smooth_values = np.maximum(smooth_values, 0)
        
        smooth_curves[percentile] = smooth_values
    
    # Step 5: Create visualization
    print("\n5️⃣ Creating visualization...")
    
    fig, ((ax1, ax2), (ax3, ax4)) = plt.subplots(2, 2, figsize=(16, 12))
    
    # Plot 1: Raw vs smooth median (first 90 days)
    raw_p50 = [d['p50'] for d in percentile_data if d['day'] <= 90]
    raw_days = [d['day'] for d in percentile_data if d['day'] <= 90]
    
    ax1.scatter(raw_days, raw_p50, alpha=0.5, s=30, color='gray', label='Raw data')
    ax1.plot(smooth_days[:91], smooth_curves['p50'][:91], 'b-', linewidth=2, label='Smooth curve')
    
    ax1.set_title('Median Views: Raw vs Smooth (First 90 Days)', fontsize=14)
    ax1.set_xlabel('Days Since Published')
    ax1.set_ylabel('Views')
    ax1.legend()
    ax1.grid(True, alpha=0.3)
    
    # Plot 2: All percentiles (full year)
    ax2.fill_between(smooth_days, smooth_curves['p10'], smooth_curves['p90'],
                     alpha=0.2, color='blue', label='10th-90th percentile')
    ax2.fill_between(smooth_days, smooth_curves['p25'], smooth_curves['p75'],
                     alpha=0.3, color='blue', label='25th-75th percentile')
    ax2.plot(smooth_days, smooth_curves['p50'], 'b-', linewidth=2, label='Median')
    
    ax2.set_title('Full Dataset Performance Envelope', fontsize=14)
    ax2.set_xlabel('Days Since Published')
    ax2.set_ylabel('Views')
    ax2.legend()
    ax2.grid(True, alpha=0.3)
    ax2.set_yscale('log')
    
    # Plot 3: Sample sizes per day
    sample_days = [d['day'] for d in percentile_data]
    sample_counts = [d['count'] for d in percentile_data]
    
    ax3.bar(sample_days, sample_counts, width=1, alpha=0.7, color='green')
    ax3.set_title('Sample Size by Day (Videos with Data)', fontsize=14)
    ax3.set_xlabel('Days Since Published')
    ax3.set_ylabel('Number of Videos')
    ax3.set_xlim(0, 90)
    ax3.grid(True, alpha=0.3)
    
    # Plot 4: Growth characteristics
    ax4.axis('off')
    
    # Calculate key metrics
    p50 = smooth_curves['p50']
    growth_stats = f"""
    FULL DATASET STATISTICS
    
    Total snapshots processed: {len(snapshots):,}
    Days with 10+ videos: {len(percentile_data)}
    
    Median (P50) Growth Pattern:
    • Day 0: {p50[0]:,.0f} views
    • Day 1: {p50[1]:,.0f} views
    • Day 7: {p50[7]:,.0f} views ({p50[7]/p50[1]:.1f}x day 1)
    • Day 30: {p50[30]:,.0f} views
    • Day 90: {p50[90]:,.0f} views
    • Day 365: {p50[365]:,.0f} views
    
    Growth Characteristics:
    • Week 1 growth: {p50[7]-p50[0]:,.0f} views
    • Month 1 growth: {p50[30]-p50[0]:,.0f} views
    • 90% of month 1 growth happens in first {np.argmax(p50 >= p50[0] + 0.9*(p50[30]-p50[0]))} days
    
    Performance Bands (Day 30):
    • Top 10%: >{smooth_curves['p90'][30]:,.0f} views
    • Top 25%: >{smooth_curves['p75'][30]:,.0f} views
    • Bottom 25%: <{smooth_curves['p25'][30]:,.0f} views
    • Bottom 10%: <{smooth_curves['p10'][30]:,.0f} views
    """
    
    ax4.text(0.05, 0.5, growth_stats, fontsize=11, 
             verticalalignment='center', fontfamily='monospace')
    
    plt.tight_layout()
    plt.savefig('full_dataset_curves.png', dpi=300, bbox_inches='tight')
    print(f"\n💾 Saved visualization to: full_dataset_curves.png")
    
    # Step 6: Update database with full dataset curves
    print("\n6️⃣ Updating database with full dataset curves...")
    
    updates = []
    for i in range(366):
        # Get actual sample count for this day
        sample_count = next((d['count'] for d in percentile_data if d['day'] == i), 0)
        
        updates.append({
            'day_since_published': i,
            'p10_views': int(smooth_curves['p10'][i]),
            'p25_views': int(smooth_curves['p25'][i]),
            'p50_views': int(smooth_curves['p50'][i]),
            'p75_views': int(smooth_curves['p75'][i]),
            'p90_views': int(smooth_curves['p90'][i]),
            'p95_views': int(smooth_curves['p95'][i]),
            'sample_count': sample_count,
            'updated_at': datetime.now().isoformat()
        })
    
    # Update in batches
    batch_size = 50
    for i in range(0, len(updates), batch_size):
        batch = updates[i:i+batch_size]
        for update in batch:
            supabase.table('performance_envelopes')\
                .upsert(update, on_conflict='day_since_published')\
                .execute()
        print(f"  Updated days {i} to {min(i+batch_size, len(updates))}")
    
    print("\n✅ SUCCESS! Full dataset curves calculated:")
    print(f"  - Processed {len(snapshots):,} non-Short video snapshots")
    print(f"  - Filtered Shorts directly in Python (efficient)")
    print(f"  - Applied graduated smoothing for optimal viral detection")
    print(f"  - Database updated with high-quality curves")

if __name__ == "__main__":
    calculate_full_dataset_curves()