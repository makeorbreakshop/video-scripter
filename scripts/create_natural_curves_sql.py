#!/usr/bin/env python3
"""
Create natural performance curves using direct SQL for efficiency
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

def main():
    """Main execution"""
    print("🎯 Creating Natural Growth Curves Using SQL")
    print("=" * 60)
    
    # First, let's create the SQL query that Supabase can understand
    print("\n📊 Getting non-Short video snapshots...")
    
    # Get all snapshots with video duration info
    all_data = []
    offset = 0
    batch_size = 1000
    
    while True:
        print(f"   Fetching batch at offset {offset}...")
        
        # Get snapshots
        snapshots = supabase.table('view_snapshots')\
            .select('days_since_published, view_count, video_id')\
            .gte('days_since_published', 0)\
            .lte('days_since_published', 365)\
            .range(offset, offset + batch_size - 1)\
            .execute()
        
        if not snapshots.data:
            break
            
        # Get video IDs from this batch
        video_ids = list(set([s['video_id'] for s in snapshots.data]))
        
        # Get durations for these videos
        videos = supabase.table('videos')\
            .select('id, duration')\
            .in_('id', video_ids[:100])\
            .not_.is_('duration', 'null')\
            .neq('duration', '')\
            .execute()
        
        # Create duration lookup
        duration_map = {}
        for v in videos.data:
            # Simple duration parsing
            dur = v['duration']
            if 'PT' in dur:
                seconds = 0
                if 'H' in dur:
                    seconds += int(dur.split('H')[0].split('PT')[-1]) * 3600
                if 'M' in dur:
                    if 'H' in dur:
                        seconds += int(dur.split('M')[0].split('H')[-1]) * 60
                    else:
                        seconds += int(dur.split('M')[0].split('PT')[-1]) * 60
                if 'S' in dur:
                    if 'M' in dur:
                        seconds += int(dur.split('S')[0].split('M')[-1])
                    elif 'H' in dur:
                        seconds += int(dur.split('S')[0].split('H')[-1])
                    else:
                        seconds += int(dur.split('S')[0].split('PT')[-1])
                
                # Store if > 121 seconds (not a Short)
                if seconds > 121:
                    duration_map[v['id']] = seconds
        
        # Add non-Short snapshots to our data
        for snap in snapshots.data:
            if snap['video_id'] in duration_map and snap['view_count']:
                all_data.append({
                    'day': snap['days_since_published'],
                    'views': snap['view_count']
                })
        
        offset += batch_size
        print(f"   Processed {offset} records, found {len(all_data)} non-Short snapshots...")
        
        # Stop after processing enough data
        if offset >= 50000:  # Process first 50K records
            print("   Stopping at 50K records for efficiency")
            break
    
    if not all_data:
        print("❌ No data found!")
        return
        
    print(f"\n✅ Found {len(all_data):,} non-Short snapshots")
    
    # Group by day and calculate percentiles
    print("\n📈 Calculating percentiles...")
    views_by_day = defaultdict(list)
    
    for item in all_data:
        views_by_day[item['day']].append(item['views'])
    
    # Calculate percentiles
    percentile_data = []
    for day in sorted(views_by_day.keys()):
        views = views_by_day[day]
        if len(views) >= 10:
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
    
    # Create smooth curves
    print("\n🎨 Creating smooth curves...")
    days = np.array([d['day'] for d in percentile_data])
    smooth_days = np.arange(0, 366)
    smooth_curves = {}
    
    for percentile in ['p10', 'p25', 'p50', 'p75', 'p90', 'p95']:
        raw_values = np.array([d[percentile] for d in percentile_data])
        
        # Interpolate
        interpolated = np.interp(smooth_days, days, raw_values)
        
        # Apply smoothing - NO MONOTONIC CONSTRAINT
        smooth_values = gaussian_filter1d(interpolated, sigma=2.0)
        smooth_values = np.maximum(smooth_values, 0)
        
        smooth_curves[percentile] = smooth_values
    
    # Create visualization
    print("\n📊 Creating visualization...")
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(16, 8))
    
    # Plot 1: Raw vs smooth median
    raw_days = [d['day'] for d in percentile_data if d['day'] <= 90]
    raw_p50 = [d['p50'] for d in percentile_data if d['day'] <= 90]
    
    ax1.scatter(raw_days, raw_p50, alpha=0.5, s=30, color='gray', label='Raw data')
    ax1.plot(smooth_days[:91], smooth_curves['p50'][:91], 'b-', linewidth=2, label='Natural smooth curve')
    ax1.set_title('Natural Growth Pattern (First 90 Days)', fontsize=14)
    ax1.set_xlabel('Days Since Published')
    ax1.set_ylabel('Views')
    ax1.legend()
    ax1.grid(True, alpha=0.3)
    
    # Plot 2: All percentiles
    ax2.fill_between(smooth_days, smooth_curves['p10'], smooth_curves['p90'],
                     alpha=0.2, color='blue', label='10th-90th percentile')
    ax2.fill_between(smooth_days, smooth_curves['p25'], smooth_curves['p75'],
                     alpha=0.3, color='blue', label='25th-75th percentile')
    ax2.plot(smooth_days, smooth_curves['p50'], 'b-', linewidth=2, label='Median')
    ax2.set_title('Natural Performance Envelope (Full Year)', fontsize=14)
    ax2.set_xlabel('Days Since Published')
    ax2.set_ylabel('Views')
    ax2.legend()
    ax2.grid(True, alpha=0.3)
    ax2.set_yscale('log')
    
    plt.tight_layout()
    plt.savefig('natural_curves_no_plateaus.png', dpi=300, bbox_inches='tight')
    print("   Saved to: natural_curves_no_plateaus.png")
    
    # Update database
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
    
    print("\n✅ SUCCESS! Natural growth curves created:")
    print(f"   - Based on {len(all_data):,} non-Short snapshots")
    print("   - No artificial plateaus")
    print("   - Natural viewing patterns preserved")
    
    # Show some stats
    p50 = smooth_curves['p50']
    print(f"\n📊 Median growth pattern:")
    print(f"   Day 1: {p50[1]:,.0f} views")
    print(f"   Day 7: {p50[7]:,.0f} views")
    print(f"   Day 30: {p50[30]:,.0f} views")
    print(f"   Day 90: {p50[90]:,.0f} views")

if __name__ == "__main__":
    main()