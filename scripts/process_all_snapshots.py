#!/usr/bin/env python3
"""
Process ALL 480K+ snapshots to create performance curves
Include snapshots beyond 365 days but normalize to 0-365 range
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

print("🎯 Processing ALL 480K+ snapshots")
print("=" * 60)

# Get ALL snapshots regardless of days_since_published
print("\n📊 Fetching ALL view snapshots...")

all_snapshots = []
offset = 0
batch_size = 1000
total_processed = 0

while True:
    # Get batch of ALL snapshots with video info
    result = supabase.table('view_snapshots')\
        .select('days_since_published, view_count, videos(duration)')\
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
                # Normalize days to 0-365 range
                days = min(row['days_since_published'], 365)
                all_snapshots.append({
                    'day': days,
                    'views': row['view_count']
                })
    
    total_processed += len(result.data)
    offset += batch_size
    
    if total_processed % 10000 == 0:
        print(f"   Processed {total_processed:,} records, found {len(all_snapshots):,} non-Short snapshots...")
    
    if len(result.data) < batch_size:
        break

print(f"\n✅ Total non-Short snapshots: {len(all_snapshots):,}")

# Calculate percentiles
print("\n📈 Calculating percentiles from FULL dataset...")
views_by_day = defaultdict(list)

for snap in all_snapshots:
    views_by_day[snap['day']].append(snap['views'])

# Show data volume
print(f"   Total data points by day:")
for day in [0, 1, 7, 30, 90, 180, 365]:
    if day in views_by_day:
        print(f"   Day {day}: {len(views_by_day[day]):,} snapshots")

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

print(f"\n   Days with sufficient data: {len(percentile_data)}")

# Create smooth curves WITHOUT monotonic constraint
print("\n🎨 Creating natural smooth curves (no plateaus)...")
days = np.array([d['day'] for d in percentile_data])
smooth_days = np.arange(0, 366)
smooth_curves = {}

for percentile in ['p10', 'p25', 'p50', 'p75', 'p90', 'p95']:
    raw_values = np.array([d[percentile] for d in percentile_data])
    
    # Interpolate
    interpolated = np.interp(smooth_days, days, raw_values)
    
    # Apply graduated smoothing - NO MONOTONIC CONSTRAINT
    smooth_values = np.zeros_like(interpolated)
    
    # Days 0-7: Very light smoothing
    smooth_values[:8] = gaussian_filter1d(interpolated[:8], sigma=0.5)
    
    # Days 8-30: Light smoothing  
    smooth_values[8:31] = gaussian_filter1d(interpolated[8:31], sigma=1.0)
    
    # Days 31-90: Medium smoothing
    smooth_values[31:91] = gaussian_filter1d(interpolated[31:91], sigma=2.0)
    
    # Days 91+: Heavier smoothing
    smooth_values[91:] = gaussian_filter1d(interpolated[91:], sigma=3.0)
    
    # Just ensure non-negative
    smooth_values = np.maximum(smooth_values, 0)
    
    smooth_curves[percentile] = smooth_values

# Create comprehensive visualization
print("\n📊 Creating visualization...")
fig, ((ax1, ax2), (ax3, ax4)) = plt.subplots(2, 2, figsize=(18, 12))

# Plot 1: Raw data scatter (first 90 days)
raw_days = [d['day'] for d in percentile_data if d['day'] <= 90]
raw_p50 = [d['p50'] for d in percentile_data if d['day'] <= 90]
raw_counts = [d['count'] for d in percentile_data if d['day'] <= 90]

scatter = ax1.scatter(raw_days, raw_p50, s=[c/50 for c in raw_counts], 
                     alpha=0.5, color='gray', label='Raw median (size = sample count)')
ax1.plot(smooth_days[:91], smooth_curves['p50'][:91], 'b-', linewidth=2, label='Natural smooth curve')
ax1.set_title(f'Median Views - First 90 Days ({len(all_snapshots):,} total snapshots)', fontsize=14)
ax1.set_xlabel('Days Since Published')
ax1.set_ylabel('Views')
ax1.legend()
ax1.grid(True, alpha=0.3)

# Plot 2: Full year envelope
ax2.fill_between(smooth_days, smooth_curves['p10'], smooth_curves['p90'],
                 alpha=0.2, color='blue', label='10th-90th percentile')
ax2.fill_between(smooth_days, smooth_curves['p25'], smooth_curves['p75'],
                 alpha=0.3, color='blue', label='25th-75th percentile')
ax2.plot(smooth_days, smooth_curves['p50'], 'b-', linewidth=2, label='Median')
ax2.plot(smooth_days, smooth_curves['p95'], 'r--', linewidth=1, alpha=0.7, label='95th percentile')

ax2.set_title('Full Dataset Performance Envelope', fontsize=14)
ax2.set_xlabel('Days Since Published')
ax2.set_ylabel('Views')
ax2.legend()
ax2.grid(True, alpha=0.3)
ax2.set_yscale('log')

# Plot 3: Sample sizes
sample_days = [d['day'] for d in percentile_data]
sample_counts = [d['count'] for d in percentile_data]

ax3.bar(sample_days, sample_counts, width=1, alpha=0.7, color='green')
ax3.set_title('Sample Size by Day (All snapshots)', fontsize=14)
ax3.set_xlabel('Days Since Published')
ax3.set_ylabel('Number of Snapshots')
ax3.set_xlim(0, 90)
ax3.grid(True, alpha=0.3)

# Plot 4: Statistics
ax4.axis('off')

p50 = smooth_curves['p50']
stats_text = f"""
FULL DATASET STATISTICS - ALL SNAPSHOTS

Data Summary:
• Total snapshots processed: {len(all_snapshots):,}
• Non-Short videos only (>121 seconds)
• Snapshots beyond 365 days: normalized to day 365

Median Growth Pattern:
• Day 0: {p50[0]:,.0f} views
• Day 1: {p50[1]:,.0f} views
• Day 7: {p50[7]:,.0f} views
• Day 30: {p50[30]:,.0f} views
• Day 90: {p50[90]:,.0f} views
• Day 365: {p50[365]:,.0f} views

Natural Growth Characteristics:
✓ No artificial plateaus or monotonic constraints
✓ Preserves natural viewing patterns
✓ Based on complete dataset

Performance Thresholds (Day 30):
• Viral (>95th): >{smooth_curves['p95'][30]:,.0f} views
• Top tier (>90th): >{smooth_curves['p90'][30]:,.0f} views
• Outperforming (>75th): >{smooth_curves['p75'][30]:,.0f} views
• Average (25th-75th): {smooth_curves['p25'][30]:,.0f} - {smooth_curves['p75'][30]:,.0f} views
• Underperforming (<25th): <{smooth_curves['p25'][30]:,.0f} views
"""

ax4.text(0.05, 0.5, stats_text, fontsize=11, 
         verticalalignment='center', fontfamily='monospace',
         bbox=dict(boxstyle="round,pad=0.5", facecolor="lightgray", alpha=0.3))

plt.tight_layout()
plt.savefig('all_snapshots_natural_curves.png', dpi=300, bbox_inches='tight')
print("   Saved to: all_snapshots_natural_curves.png")

# Update database
print("\n💾 Updating database with complete curves...")
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
    
    if i % 100 == 0:
        print(f"   Updated days {i} to {min(i+batch_size, len(updates))}")

print("\n✅ SUCCESS! Complete dataset processed:")
print(f"   - {len(all_snapshots):,} non-Short snapshots (from 480K+ total)")
print("   - Natural growth curves with no artificial plateaus")
print("   - Database updated with accurate performance envelopes")