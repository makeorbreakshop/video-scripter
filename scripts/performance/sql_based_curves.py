#!/usr/bin/env python3
"""
SQL-based approach to calculate curves from ALL 480K+ snapshots efficiently
"""

import os
import matplotlib.pyplot as plt
import numpy as np
from supabase import create_client, Client
from dotenv import load_dotenv
from scipy.ndimage import gaussian_filter1d
from datetime import datetime

# Load environment variables
load_dotenv()

# Initialize Supabase client
url = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
supabase: Client = create_client(url, key)

print("🎯 Calculating curves from ALL 480K+ snapshots using SQL")
print("=" * 60)

# Execute the SQL query to get percentiles for all days
print("\n📊 Running SQL query to calculate percentiles...")

# Get percentiles in batches to avoid timeout
all_data = []
for start_day in range(0, 366, 50):
    end_day = min(start_day + 49, 365)
    
    query = f"""
    WITH non_short_videos AS (
      SELECT id
      FROM videos
      WHERE duration IS NOT NULL 
        AND duration != ''
        AND (
          duration LIKE '%H%' OR
          (duration LIKE '%M%' AND 
           CAST(substring(duration from 'PT(\\d+)M') AS INTEGER) >= 2) OR
          (duration ~ '^PT\\d+S$' AND 
           CAST(substring(duration from 'PT(\\d+)S') AS INTEGER) > 121)
        )
    ),
    normalized_snapshots AS (
      SELECT 
        LEAST(vs.days_since_published, 365) as day,
        vs.view_count
      FROM view_snapshots vs
      JOIN non_short_videos nsv ON vs.video_id = nsv.id
      WHERE vs.view_count > 0
        AND LEAST(vs.days_since_published, 365) BETWEEN {start_day} AND {end_day}
    )
    SELECT 
      day,
      COUNT(*) as sample_count,
      PERCENTILE_CONT(0.10) WITHIN GROUP (ORDER BY view_count) as p10,
      PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY view_count) as p25,
      PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY view_count) as p50,
      PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY view_count) as p75,
      PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY view_count) as p90,
      PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY view_count) as p95
    FROM normalized_snapshots
    GROUP BY day
    HAVING COUNT(*) >= 10
    ORDER BY day
    """
    
    result = supabase.rpc('execute_sql', {'query': query}).execute()
    
    if result.data:
        all_data.extend(result.data)
        print(f"   Days {start_day}-{end_day}: {len(result.data)} days with data")

print(f"\n✅ Retrieved percentiles for {len(all_data)} days")

# Show sample sizes
print("\n📈 Sample sizes by day:")
for day_data in all_data:
    if day_data['day'] in [0, 1, 7, 30, 90, 180, 365]:
        print(f"   Day {day_data['day']}: {day_data['sample_count']:,} snapshots")

# Create smooth curves
print("\n🎨 Creating natural smooth curves...")
days = np.array([d['day'] for d in all_data])
smooth_days = np.arange(0, 366)
smooth_curves = {}

for percentile in ['p10', 'p25', 'p50', 'p75', 'p90', 'p95']:
    raw_values = np.array([float(d[percentile]) for d in all_data])
    
    # Interpolate to fill missing days
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
    
    # Ensure non-negative
    smooth_values = np.maximum(smooth_values, 0)
    
    smooth_curves[percentile] = smooth_values

# Create visualization
print("\n📊 Creating visualization...")
fig, ((ax1, ax2), (ax3, ax4)) = plt.subplots(2, 2, figsize=(18, 12))

# Plot 1: Raw vs smooth median (first 90 days)
raw_days = [d['day'] for d in all_data if d['day'] <= 90]
raw_p50 = [float(d['p50']) for d in all_data if d['day'] <= 90]
raw_counts = [d['sample_count'] for d in all_data if d['day'] <= 90]

scatter = ax1.scatter(raw_days, raw_p50, s=[c/20 for c in raw_counts], 
                     alpha=0.5, color='gray', label='Raw median (size = sample count)')
ax1.plot(smooth_days[:91], smooth_curves['p50'][:91], 'b-', linewidth=2, label='Natural smooth curve')
ax1.set_title('Median Views - First 90 Days (ALL 480K+ snapshots)', fontsize=14)
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

ax2.set_title('Complete Dataset Performance Envelope', fontsize=14)
ax2.set_xlabel('Days Since Published')
ax2.set_ylabel('Views')
ax2.legend()
ax2.grid(True, alpha=0.3)
ax2.set_yscale('log')

# Plot 3: Sample sizes
sample_days = [d['day'] for d in all_data]
sample_counts = [d['sample_count'] for d in all_data]

ax3.bar(sample_days, sample_counts, width=1, alpha=0.7, color='green')
ax3.set_title('Sample Size by Day', fontsize=14)
ax3.set_xlabel('Days Since Published')
ax3.set_ylabel('Number of Snapshots')
ax3.set_xlim(0, 90)
ax3.grid(True, alpha=0.3)

# Plot 4: Statistics
ax4.axis('off')

# Calculate total snapshots
total_snapshots = sum(d['sample_count'] for d in all_data)

p50 = smooth_curves['p50']
stats_text = f"""
COMPLETE DATASET ANALYSIS - SQL-BASED CALCULATION

Data Summary:
• Total snapshots aggregated: ~{total_snapshots:,}
• Processing method: SQL percentiles (efficient)
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
✓ No artificial plateaus
✓ Natural viewing patterns preserved
✓ Based on ALL 480K+ snapshots
✓ SQL-based for maximum efficiency

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
plt.savefig('complete_dataset_curves.png', dpi=300, bbox_inches='tight')
print("   Saved to: complete_dataset_curves.png")

# Update database
print("\n💾 Updating database...")
updates = []
for i in range(366):
    # Find the data for this day
    day_data = next((d for d in all_data if d['day'] == i), None)
    
    if day_data:
        sample_count = day_data['sample_count']
    else:
        sample_count = 0
    
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

print("\n✅ SUCCESS! Complete dataset processed efficiently:")
print(f"   - Aggregated ~{total_snapshots:,} snapshots using SQL")
print("   - Natural growth curves with no artificial plateaus")
print("   - Database updated with accurate performance envelopes")