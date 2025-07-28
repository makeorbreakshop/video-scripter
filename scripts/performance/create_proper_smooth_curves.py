#!/usr/bin/env python3
"""
Create properly smoothed performance curves
1. Filter out Shorts (≤121 seconds)
2. Use all 480K+ snapshots  
3. Apply appropriate smoothing for viral detection
"""

import os
import matplotlib.pyplot as plt
import numpy as np
from supabase import create_client, Client
from dotenv import load_dotenv
from scipy.interpolate import UnivariateSpline
from scipy.ndimage import gaussian_filter1d
from datetime import datetime

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
    
    import re
    match = re.match(r'PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?', duration_str)
    if not match:
        return None
    
    hours = int(match.group(1) or 0)
    minutes = int(match.group(2) or 0)
    seconds = int(match.group(3) or 0)
    
    return hours * 3600 + minutes * 60 + seconds

def create_proper_smooth_curves():
    """Create smooth curves with proper filtering and smoothing"""
    
    print("🎯 Creating properly smoothed performance curves...")
    print("   - Filtering out Shorts (≤121 seconds)")
    print("   - Using all available data")
    print("   - Applying appropriate smoothing")
    
    # Step 1: Get all snapshots with video duration for filtering
    print("\n1️⃣ Fetching snapshots with duration filtering...")
    
    all_snapshots = []
    offset = 0
    batch_size = 1000
    
    while True:
        # Join with videos table to get duration
        batch = supabase.table('view_snapshots')\
            .select('days_since_published, view_count, video_id')\
            .lte('days_since_published', 365)\
            .gte('days_since_published', 0)\
            .range(offset, offset + batch_size - 1)\
            .execute()
        
        if not batch.data:
            break
        
        # Get video durations for this batch
        video_ids = list(set([s['video_id'] for s in batch.data]))
        
        # Fetch in chunks to avoid query limits
        videos_with_duration = []
        for i in range(0, len(video_ids), 100):
            chunk_ids = video_ids[i:i+100]
            videos_chunk = supabase.table('videos')\
                .select('id, duration')\
                .in_('id', chunk_ids)\
                .execute()
            videos_with_duration.extend(videos_chunk.data)
        
        # Create duration lookup
        duration_lookup = {v['id']: v['duration'] for v in videos_with_duration}
        
        # Filter out Shorts
        for snap in batch.data:
            duration_str = duration_lookup.get(snap['video_id'])
            if duration_str:
                duration_seconds = parse_duration_to_seconds(duration_str)
                if duration_seconds and duration_seconds > 121:  # Not a Short
                    all_snapshots.append({
                        'day': snap['days_since_published'],
                        'views': snap['view_count']
                    })
        
        offset += batch_size
        print(f"  Processed {offset} snapshots, kept {len(all_snapshots)} non-Shorts...")
        
        if len(batch.data) < batch_size:
            break
    
    print(f"✓ Total non-Short snapshots: {len(all_snapshots):,}")
    
    # Step 2: Calculate percentiles from filtered data
    print("\n2️⃣ Calculating percentiles from filtered data...")
    
    from collections import defaultdict
    views_by_day = defaultdict(list)
    
    for snap in all_snapshots:
        views_by_day[snap['day']].append(snap['views'])
    
    # Calculate raw percentiles
    percentile_data = []
    for day in sorted(views_by_day.keys()):
        views = views_by_day[day]
        if len(views) >= 10:  # Need minimum samples
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
    
    # Step 3: Apply PROPER smoothing
    print("\n3️⃣ Applying proper smoothing...")
    
    days = np.array([d['day'] for d in percentile_data])
    
    # Create smooth curves for each percentile
    smooth_days = np.arange(0, 366)
    smooth_curves = {}
    
    for percentile in ['p10', 'p25', 'p50', 'p75', 'p90', 'p95']:
        raw_values = np.array([d[percentile] for d in percentile_data])
        
        # Use different smoothing strategies for different time periods
        if len(days) > 30:
            # For early days (0-30): Less smoothing to capture rapid growth
            early_mask = days <= 30
            late_mask = days > 30
            
            # Early period: Light smoothing
            if np.sum(early_mask) > 5:
                early_spline = UnivariateSpline(days[early_mask], raw_values[early_mask], 
                                               s=len(days[early_mask]) * 1000)
                early_smooth = early_spline(smooth_days[smooth_days <= 30])
            else:
                early_smooth = np.interp(smooth_days[smooth_days <= 30], days, raw_values)
            
            # Late period: Heavier smoothing
            if np.sum(late_mask) > 5:
                late_spline = UnivariateSpline(days[late_mask], raw_values[late_mask], 
                                              s=len(days[late_mask]) * 10000)
                late_smooth = late_spline(smooth_days[smooth_days > 30])
            else:
                late_smooth = np.interp(smooth_days[smooth_days > 30], days, raw_values)
            
            # Combine
            smooth_values = np.concatenate([early_smooth, late_smooth])
            
            # Apply light Gaussian smoothing to remove remaining noise
            smooth_values = gaussian_filter1d(smooth_values, sigma=2)
            
        else:
            # Simple interpolation for sparse data
            smooth_values = np.interp(smooth_days, days, raw_values)
        
        # Ensure non-negative and reasonable starting value
        smooth_values = np.maximum(smooth_values, 0)
        if smooth_values[0] < 100:
            smooth_values[0] = 1000  # Reasonable starting point
        
        # Ensure general upward trend (but allow local variations)
        # Apply very light monotonic encouragement
        for i in range(1, len(smooth_values)):
            if smooth_values[i] < smooth_values[i-1] * 0.95:  # Allow up to 5% decrease
                smooth_values[i] = smooth_values[i-1] * 0.95
        
        smooth_curves[percentile] = smooth_values
    
    # Step 4: Visualize the results
    print("\n4️⃣ Creating visualization...")
    
    fig, (ax1, ax2, ax3) = plt.subplots(3, 1, figsize=(14, 16))
    
    # Plot 1: Raw vs Smooth median
    raw_p50 = [d['p50'] for d in percentile_data]
    smooth_p50 = smooth_curves['p50']
    
    ax1.scatter(days, raw_p50, alpha=0.5, s=30, color='gray', label='Raw data points')
    ax1.plot(smooth_days, smooth_p50, 'b-', linewidth=2, label='Smooth curve')
    
    ax1.set_title('Median Views: Raw Data vs Smooth Curve', fontsize=16)
    ax1.set_xlabel('Days Since Published')
    ax1.set_ylabel('Views')
    ax1.legend()
    ax1.grid(True, alpha=0.3)
    ax1.set_xlim(0, 90)
    ax1.set_yscale('log')
    
    # Plot 2: All percentile bands
    ax2.fill_between(smooth_days, smooth_curves['p10'], smooth_curves['p90'],
                     alpha=0.2, color='blue', label='10th-90th percentile')
    ax2.fill_between(smooth_days, smooth_curves['p25'], smooth_curves['p75'],
                     alpha=0.3, color='blue', label='25th-75th percentile')
    ax2.plot(smooth_days, smooth_curves['p50'], 'b-', linewidth=2, label='Median')
    
    ax2.set_title('Smooth Performance Envelope - All Percentiles', fontsize=16)
    ax2.set_xlabel('Days Since Published')
    ax2.set_ylabel('Views')
    ax2.legend()
    ax2.grid(True, alpha=0.3)
    ax2.set_yscale('log')
    ax2.set_xlim(0, 365)
    
    # Plot 3: Growth rate (should be smooth, generally decreasing)
    growth_rate = np.gradient(smooth_curves['p50'])
    
    # Smooth the growth rate for visualization
    smooth_growth = gaussian_filter1d(growth_rate, sigma=3)
    
    ax3.plot(smooth_days[1:], smooth_growth[1:], 'b-', linewidth=2)
    ax3.axhline(y=0, color='k', linestyle='--', alpha=0.3)
    ax3.fill_between(smooth_days[1:], 0, smooth_growth[1:], 
                     where=smooth_growth[1:] > 0, alpha=0.3, color='green', label='Growth')
    ax3.fill_between(smooth_days[1:], 0, smooth_growth[1:], 
                     where=smooth_growth[1:] <= 0, alpha=0.3, color='red', label='Decline')
    
    ax3.set_title('Daily Growth Rate (Smoothed)', fontsize=16)
    ax3.set_xlabel('Days Since Published')
    ax3.set_ylabel('Views per Day')
    ax3.legend()
    ax3.grid(True, alpha=0.3)
    ax3.set_xlim(0, 90)
    
    plt.tight_layout()
    plt.savefig('proper_smooth_curves.png', dpi=300, bbox_inches='tight')
    print(f"\n💾 Saved visualization to: proper_smooth_curves.png")
    
    # Step 5: Update database
    print("\n5️⃣ Updating database with smooth curves...")
    
    updates = []
    for i in range(366):
        updates.append({
            'day_since_published': i,
            'p10_views': int(smooth_curves['p10'][i]),
            'p25_views': int(smooth_curves['p25'][i]),
            'p50_views': int(smooth_curves['p50'][i]),
            'p75_views': int(smooth_curves['p75'][i]),
            'p90_views': int(smooth_curves['p90'][i]),
            'p95_views': int(smooth_curves['p95'][i]),
            'sample_count': next((d['count'] for d in percentile_data if d['day'] == i), 0),
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
    
    print("\n✅ SUCCESS! Smooth curves created:")
    print(f"  - Filtered out Shorts (≤121 seconds)")
    print(f"  - Used {len(all_snapshots):,} quality data points")
    print(f"  - Applied appropriate smoothing for viral detection")
    
    # Show key metrics
    print("\n📊 Key growth metrics (median):")
    print(f"  Day 1: {smooth_curves['p50'][1]:,.0f} views")
    print(f"  Day 7: {smooth_curves['p50'][7]:,.0f} views ({smooth_curves['p50'][7]/smooth_curves['p50'][1]:.1f}x day 1)")
    print(f"  Day 30: {smooth_curves['p50'][30]:,.0f} views")
    print(f"  Day 90: {smooth_curves['p50'][90]:,.0f} views")
    print(f"  Day 365: {smooth_curves['p50'][365]:,.0f} views")

if __name__ == "__main__":
    create_proper_smooth_curves()