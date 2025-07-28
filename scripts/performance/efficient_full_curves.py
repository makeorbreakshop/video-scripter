#!/usr/bin/env python3
"""
Efficient calculation of performance curves using SQL filtering
"""

import os
import matplotlib.pyplot as plt
import numpy as np
from supabase import create_client, Client
from dotenv import load_dotenv
from scipy.ndimage import gaussian_filter1d
from datetime import datetime
from collections import defaultdict

# Load environment variables
load_dotenv()

# Initialize Supabase client
url = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
supabase: Client = create_client(url, key)

def get_view_tracking_stats():
    """Get current view tracking statistics"""
    stats = supabase.table('view_tracking_priority')\
        .select('*', count='exact')\
        .execute()
    
    print("\n📊 Current view tracking statistics:")
    print(f"   Total tracked videos: {stats.count:,}")

def fetch_non_short_snapshots():
    """Fetch all snapshots for non-Short videos using SQL"""
    print("\n🚀 Fetching snapshots for non-Short videos...")
    
    # Get snapshots with video metadata in one query
    # This query filters Shorts using SQL pattern matching
    all_snapshots = []
    offset = 0
    batch_size = 1000
    
    while True:
        print(f"   Processing batch starting at offset {offset}...")
        
        # Query snapshots with video metadata using join syntax
        try:
            result = supabase.table('view_snapshots')\
                .select('days_since_published, view_count, video_id')\
                .gte('days_since_published', 0)\
                .lte('days_since_published', 365)\
                .range(offset, offset + batch_size - 1)\
                .execute()
                
            if not result.data:
                break
                
            # Get video durations for this batch
            video_ids = list(set([r['video_id'] for r in result.data]))
            
            # Fetch videos in chunks
            videos_data = []
            for i in range(0, len(video_ids), 100):
                chunk = video_ids[i:i+100]
                videos = supabase.table('videos')\
                    .select('id, duration')\
                    .in_('id', chunk)\
                    .not_.is_('duration', 'null')\
                    .neq('duration', '')\
                    .execute()
                videos_data.extend(videos.data)
            
            # Create lookup
            duration_lookup = {v['id']: v['duration'] for v in videos_data}
            
            # Process snapshots
            for row in result.data:
                if row['video_id'] in duration_lookup:
                    duration = duration_lookup[row['video_id']]
                    row['videos'] = {'duration': duration}
                else:
                    continue
        except Exception as e:
            print(f"Error fetching batch: {e}")
            break
        
        if not result.data:
            break
            
        # Filter Shorts in Python (simpler than complex SQL)
        for row in result.data:
            duration = row['videos']['duration']
            
            # Parse duration - looking for > 121 seconds
            if 'PT' in duration:
                # Extract seconds from various formats
                total_seconds = 0
                
                # Hours
                if 'H' in duration:
                    hours = int(duration.split('H')[0].split('PT')[-1])
                    total_seconds += hours * 3600
                    
                # Minutes
                if 'M' in duration:
                    if 'H' in duration:
                        minutes = int(duration.split('M')[0].split('H')[1])
                    else:
                        minutes = int(duration.split('M')[0].split('PT')[-1])
                    total_seconds += minutes * 60
                    
                # Seconds
                if 'S' in duration:
                    if 'M' in duration:
                        seconds = int(duration.split('S')[0].split('M')[1])
                    elif 'H' in duration:
                        # Edge case: PT1H30S
                        seconds = int(duration.split('S')[0].split('H')[1])
                    else:
                        seconds = int(duration.split('S')[0].split('PT')[-1])
                    total_seconds += seconds
                
                # Keep if > 121 seconds (not a Short)
                if total_seconds > 121:
                    all_snapshots.append({
                        'day': row['days_since_published'],
                        'views': row['view_count']
                    })
        
        offset += batch_size
        print(f"   Processed {offset} records, found {len(all_snapshots)} non-Short snapshots...")
        
        if len(result.data) < batch_size:
            break
    
    return all_snapshots

def calculate_curves_from_snapshots(snapshots):
    """Calculate percentile curves from snapshot data"""
    print(f"\n📈 Calculating curves from {len(snapshots):,} snapshots...")
    
    # Group by day
    views_by_day = defaultdict(list)
    
    for snap in snapshots:
        if snap['views'] and snap['views'] > 0:
            views_by_day[snap['day']].append(snap['views'])
    
    print(f"   Days with data: {len(views_by_day)}")
    
    # Calculate percentiles
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
    
    print(f"   Calculated percentiles for {len(percentile_data)} days")
    
    # Show sample sizes
    print("\n   Sample sizes by day:")
    for day in [0, 1, 7, 30, 90, 180, 365]:
        data = next((d for d in percentile_data if d['day'] == day), None)
        if data:
            print(f"   Day {day}: {data['count']:,} videos")
    
    return percentile_data

def create_smooth_curves(percentile_data):
    """Create smooth curves from percentile data"""
    print("\n🎨 Creating smooth curves...")
    
    days = np.array([d['day'] for d in percentile_data])
    smooth_days = np.arange(0, 366)
    smooth_curves = {}
    
    for percentile in ['p10', 'p25', 'p50', 'p75', 'p90', 'p95']:
        raw_values = np.array([d[percentile] for d in percentile_data])
        
        # Interpolate to fill all days
        interpolated = np.interp(smooth_days, days, raw_values)
        
        # Apply graduated smoothing
        smooth_values = np.zeros_like(interpolated)
        
        # Days 0-7: Minimal smoothing
        smooth_values[:8] = gaussian_filter1d(interpolated[:8], sigma=0.5)
        
        # Days 8-30: Light smoothing
        smooth_values[8:31] = gaussian_filter1d(interpolated[8:31], sigma=1.0)
        
        # Days 31-90: Medium smoothing
        smooth_values[31:91] = gaussian_filter1d(interpolated[31:91], sigma=2.0)
        
        # Days 91+: Heavier smoothing
        smooth_values[91:] = gaussian_filter1d(interpolated[91:], sigma=3.0)
        
        # Ensure non-negative values
        smooth_values = np.maximum(smooth_values, 0)
        
        smooth_curves[percentile] = smooth_values
    
    return smooth_curves, percentile_data

def save_visualization(smooth_curves, percentile_data, snapshots):
    """Create and save visualization"""
    print("\n📊 Creating visualization...")
    
    fig, ((ax1, ax2), (ax3, ax4)) = plt.subplots(2, 2, figsize=(16, 12))
    
    smooth_days = np.arange(0, 366)
    
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
    
    # Plot 2: All percentiles (full year, log scale)
    ax2.fill_between(smooth_days, smooth_curves['p10'], smooth_curves['p90'],
                     alpha=0.2, color='blue', label='10th-90th percentile')
    ax2.fill_between(smooth_days, smooth_curves['p25'], smooth_curves['p75'],
                     alpha=0.3, color='blue', label='25th-75th percentile')
    ax2.plot(smooth_days, smooth_curves['p50'], 'b-', linewidth=2, label='Median')
    
    ax2.set_title('Natural Performance Envelope (No Plateaus)', fontsize=14)
    ax2.set_xlabel('Days Since Published')
    ax2.set_ylabel('Views')
    ax2.legend()
    ax2.grid(True, alpha=0.3)
    ax2.set_yscale('log')
    
    # Plot 3: Sample sizes
    sample_days = [d['day'] for d in percentile_data]
    sample_counts = [d['count'] for d in percentile_data]
    
    ax3.bar(sample_days[:91], sample_counts[:91], width=1, alpha=0.7, color='green')
    ax3.set_title('Sample Size by Day (First 90 Days)', fontsize=14)
    ax3.set_xlabel('Days Since Published')
    ax3.set_ylabel('Number of Videos')
    ax3.grid(True, alpha=0.3)
    
    # Plot 4: Statistics
    ax4.axis('off')
    
    p50 = smooth_curves['p50']
    stats_text = f"""
    NATURAL GROWTH CURVES - NO PLATEAUS
    
    Total snapshots: {len(snapshots):,}
    Non-Short videos only (>121 seconds)
    
    Median Growth Pattern:
    • Day 1: {p50[1]:,.0f} views
    • Day 7: {p50[7]:,.0f} views ({p50[7]/p50[1]:.1f}x day 1)
    • Day 30: {p50[30]:,.0f} views
    • Day 90: {p50[90]:,.0f} views
    • Day 365: {p50[365]:,.0f} views
    
    Natural Growth Characteristics:
    • Allows for seasonal variations
    • No artificial plateaus
    • Based on real viewing patterns
    
    Performance Thresholds (Day 30):
    • Viral (Top 10%): >{smooth_curves['p90'][30]:,.0f} views
    • Outperforming (Top 25%): >{smooth_curves['p75'][30]:,.0f} views
    • Underperforming (Bottom 25%): <{smooth_curves['p25'][30]:,.0f} views
    """
    
    ax4.text(0.05, 0.5, stats_text, fontsize=11, 
             verticalalignment='center', fontfamily='monospace')
    
    plt.tight_layout()
    plt.savefig('natural_growth_curves.png', dpi=300, bbox_inches='tight')
    print("   Saved to: natural_growth_curves.png")

def update_database(smooth_curves, percentile_data):
    """Update database with new curves"""
    print("\n💾 Updating database...")
    
    updates = []
    for i in range(366):
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
        print(f"   Updated days {i} to {min(i+batch_size, len(updates))}")
    
    print("   ✅ Database updated successfully!")

def main():
    """Main execution function"""
    print("🎯 Creating Natural Growth Curves (No Artificial Plateaus)")
    print("=" * 60)
    
    # Get current stats
    try:
        get_view_tracking_stats()
    except:
        print("   (Could not fetch tracking stats)")
    
    # Fetch snapshots
    snapshots = fetch_non_short_snapshots()
    
    if not snapshots:
        print("❌ No snapshots found!")
        return
    
    # Calculate curves
    percentile_data = calculate_curves_from_snapshots(snapshots)
    
    # Create smooth curves
    smooth_curves, percentile_data = create_smooth_curves(percentile_data)
    
    # Save visualization
    save_visualization(smooth_curves, percentile_data, snapshots)
    
    # Update database
    update_database(smooth_curves, percentile_data)
    
    print("\n✅ SUCCESS! Natural growth curves created:")
    print("   - No artificial plateaus")
    print("   - Based on real viewing patterns")
    print("   - Ready for viral video detection")

if __name__ == "__main__":
    main()