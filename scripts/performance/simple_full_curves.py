#!/usr/bin/env python3
"""
Simple script to get ALL non-Short snapshots and create natural curves
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

print("🎯 Getting ALL non-Short video snapshots")
print("=" * 60)

# Get snapshots with simple duration filtering
print("\n📊 Fetching view snapshots...")

all_snapshots = []
offset = 0
batch_size = 1000
total_processed = 0

while True:
    # Get batch of snapshots with video info
    result = supabase.table('view_snapshots')\
        .select('days_since_published, view_count, videos(duration)')\
        .gte('days_since_published', 0)\
        .lte('days_since_published', 365)\
        .range(offset, offset + batch_size - 1)\
        .execute()
    
    if not result.data:
        break
    
    # Process each snapshot
    for row in result.data:
        if row.get('videos') and row['videos'].get('duration') and row['view_count']:
            dur = row['videos']['duration']
            
            # Simple duration check - anything with minutes or hours is > 121 seconds
            is_long_video = False
            
            if 'H' in dur:  # Has hours = definitely > 121 seconds
                is_long_video = True
            elif 'M' in dur:  # Has minutes
                # Extract minutes
                if 'PT' in dur and 'M' in dur:
                    try:
                        minutes_str = dur.split('M')[0].split('PT')[-1]
                        if minutes_str.isdigit() and int(minutes_str) >= 2:  # 2+ minutes
                            is_long_video = True
                    except:
                        pass
            elif 'S' in dur and 'PT' in dur:  # Only seconds
                try:
                    seconds_str = dur.split('S')[0].split('PT')[-1]
                    if seconds_str.isdigit() and int(seconds_str) > 121:
                        is_long_video = True
                except:
                    pass
            
            if is_long_video:
                all_snapshots.append({
                    'day': row['days_since_published'],
                    'views': row['view_count']
                })
    
    total_processed += len(result.data)
    offset += batch_size
    
    print(f"   Processed {total_processed:,} records, found {len(all_snapshots):,} non-Short snapshots...")
    
    if len(result.data) < batch_size:
        break

print(f"\n✅ Total non-Short snapshots: {len(all_snapshots):,}")

# Calculate percentiles
print("\n📈 Calculating percentiles...")
views_by_day = defaultdict(list)

for snap in all_snapshots:
    views_by_day[snap['day']].append(snap['views'])

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

print(f"   Days with sufficient data: {len(percentile_data)}")

# Create smooth curves
print("\n🎨 Creating natural smooth curves...")
days = np.array([d['day'] for d in percentile_data])
smooth_days = np.arange(0, 366)
smooth_curves = {}

for percentile in ['p10', 'p25', 'p50', 'p75', 'p90', 'p95']:
    raw_values = np.array([d[percentile] for d in percentile_data])
    
    # Interpolate
    interpolated = np.interp(smooth_days, days, raw_values)
    
    # Apply light smoothing - NO MONOTONIC CONSTRAINT
    smooth_values = gaussian_filter1d(interpolated, sigma=1.5)
    smooth_values = np.maximum(smooth_values, 0)
    
    smooth_curves[percentile] = smooth_values

# Quick visualization
print("\n📊 Creating visualization...")
fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(16, 8))

# Plot 1: First 90 days
ax1.fill_between(smooth_days[:91], smooth_curves['p25'][:91], smooth_curves['p75'][:91],
                 alpha=0.3, color='blue', label='25th-75th percentile')
ax1.plot(smooth_days[:91], smooth_curves['p50'][:91], 'b-', linewidth=2, label='Median')
ax1.set_title(f'Natural Growth Pattern - First 90 Days ({len(all_snapshots):,} snapshots)', fontsize=14)
ax1.set_xlabel('Days Since Published')
ax1.set_ylabel('Views')
ax1.legend()
ax1.grid(True, alpha=0.3)

# Plot 2: Full year
ax2.fill_between(smooth_days, smooth_curves['p10'], smooth_curves['p90'],
                 alpha=0.2, color='blue', label='10th-90th percentile')
ax2.plot(smooth_days, smooth_curves['p50'], 'b-', linewidth=2, label='Median')
ax2.set_title('Full Year Performance Envelope', fontsize=14)
ax2.set_xlabel('Days Since Published')
ax2.set_ylabel('Views')
ax2.legend()
ax2.grid(True, alpha=0.3)
ax2.set_yscale('log')

plt.tight_layout()
plt.savefig('simple_natural_curves.png', dpi=300, bbox_inches='tight')
print("   Saved to: simple_natural_curves.png")

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

print("\n✅ SUCCESS!")
p50 = smooth_curves['p50']
print(f"\n📊 Natural growth pattern:")
print(f"   Day 1: {p50[1]:,.0f} views")
print(f"   Day 7: {p50[7]:,.0f} views")
print(f"   Day 30: {p50[30]:,.0f} views")
print(f"   Day 90: {p50[90]:,.0f} views")