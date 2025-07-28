#!/usr/bin/env python3
"""
Efficient 10-year curve generation using batch processing
"""

import os
import matplotlib.pyplot as plt
import numpy as np
from supabase import create_client, Client
from dotenv import load_dotenv
from scipy.ndimage import gaussian_filter1d
from datetime import datetime
from collections import defaultdict
import json

# Load environment variables
load_dotenv()

# Initialize Supabase client
url = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
supabase: Client = create_client(url, key)

print("🎯 Creating 10-Year Performance Curves - Efficient Version")
print("=" * 60)

# First, check if we have cached data from previous runs
cache_file = 'ten_year_data_cache.json'
if os.path.exists(cache_file):
    print(f"\n📊 Loading cached data from {cache_file}...")
    with open(cache_file, 'r') as f:
        percentile_data = json.load(f)
    print(f"   Loaded {len(percentile_data)} days of data from cache")
else:
    print("\n📊 No cache found. Processing snapshots in yearly batches...")
    
    all_percentiles = {}
    
    # Process data in yearly chunks to avoid memory issues
    for year in range(11):  # 0-10 years
        start_day = year * 365
        end_day = min((year + 1) * 365, 3650)
        
        print(f"\n   Processing Year {year} (days {start_day}-{end_day})...")
        
        views_by_day = defaultdict(list)
        offset = 0
        batch_size = 1000
        year_snapshots = 0
        
        while True:
            # Get batch of snapshots for this year
            result = supabase.table('view_snapshots')\
                .select('days_since_published, view_count, videos(duration)')\
                .gte('days_since_published', start_day)\
                .lt('days_since_published', end_day)\
                .range(offset, offset + batch_size - 1)\
                .execute()
            
            if not result.data:
                break
            
            # Process each snapshot
            for row in result.data:
                if row.get('videos') and row['videos'].get('duration') and row['view_count']:
                    dur = row['videos']['duration']
                    
                    # Quick check for non-Shorts (>121 seconds)
                    is_long = False
                    if 'H' in dur:
                        is_long = True
                    elif 'M' in dur and 'PT' in dur:
                        try:
                            mins = int(dur.split('M')[0].split('PT')[-1])
                            if mins >= 2:
                                is_long = True
                        except:
                            pass
                    elif 'PT' in dur and 'S' in dur and not 'M' in dur:
                        try:
                            secs = int(dur.split('S')[0].split('PT')[-1])
                            if secs > 121:
                                is_long = True
                        except:
                            pass
                    
                    if is_long:
                        day = row['days_since_published']
                        views_by_day[day].append(row['view_count'])
                        year_snapshots += 1
            
            offset += batch_size
            if len(result.data) < batch_size:
                break
        
        print(f"      Processed {year_snapshots:,} non-Short snapshots")
        
        # Calculate percentiles for this year's data
        for day, views in views_by_day.items():
            if len(views) >= 10:
                all_percentiles[day] = {
                    'day': day,
                    'count': len(views),
                    'p10': int(np.percentile(views, 10)),
                    'p25': int(np.percentile(views, 25)),
                    'p50': int(np.percentile(views, 50)),
                    'p75': int(np.percentile(views, 75)),
                    'p90': int(np.percentile(views, 90)),
                    'p95': int(np.percentile(views, 95))
                }
    
    # Convert to sorted list
    percentile_data = [all_percentiles[day] for day in sorted(all_percentiles.keys())]
    
    # Save cache for future runs
    print(f"\n💾 Saving cache to {cache_file}...")
    with open(cache_file, 'w') as f:
        json.dump(percentile_data, f)

print(f"\n✅ Total days with data: {len(percentile_data)}")

# Show sample sizes at key points
print("\n📈 Sample sizes at yearly milestones:")
for year in range(11):
    day = year * 365
    matching = [d for d in percentile_data if d['day'] == day]
    if matching:
        print(f"   Year {year:2d} (day {day:4d}): {matching[0]['count']:,} snapshots")

# Create smooth curves
print("\n🎨 Creating smooth curves with adaptive smoothing...")
days = np.array([d['day'] for d in percentile_data])
smooth_days = np.arange(0, 3651)
smooth_curves = {}

for percentile in ['p10', 'p25', 'p50', 'p75', 'p90', 'p95']:
    raw_values = np.array([d[percentile] for d in percentile_data])
    
    # Interpolate
    interpolated = np.interp(smooth_days, days, raw_values)
    
    # Apply adaptive smoothing
    smooth_values = np.zeros_like(interpolated)
    
    # Graduated smoothing based on age
    ranges = [
        (0, 8, 0.5),      # Days 0-7: Very light
        (8, 31, 1.0),     # Days 8-30: Light
        (31, 91, 2.0),    # Days 31-90: Medium
        (91, 366, 3.0),   # Days 91-365: Year 1
        (366, 731, 5.0),  # Year 2
        (731, 1461, 8.0), # Years 3-4
        (1461, 2556, 12.0), # Years 5-7
        (2556, 3651, 20.0)  # Years 8-10
    ]
    
    for start, end, sigma in ranges:
        if end > len(interpolated):
            end = len(interpolated)
        if start < end:
            smooth_values[start:end] = gaussian_filter1d(interpolated[start:end], sigma=sigma)
    
    # Ensure non-negative
    smooth_values = np.maximum(smooth_values, 0)
    smooth_curves[percentile] = smooth_values

# Create visualization
print("\n📊 Creating 10-year visualization...")
fig, ((ax1, ax2), (ax3, ax4)) = plt.subplots(2, 2, figsize=(18, 12))

# Plot 1: First 90 days
raw_90 = [d for d in percentile_data if d['day'] <= 90]
if raw_90:
    ax1.scatter([d['day'] for d in raw_90], [d['p50'] for d in raw_90], 
                alpha=0.5, s=30, color='gray', label='Raw data')
ax1.plot(smooth_days[:91], smooth_curves['p50'][:91], 'b-', linewidth=2, label='Smooth curve')
ax1.set_title('Median Views - First 90 Days', fontsize=14)
ax1.set_xlabel('Days Since Published')
ax1.set_ylabel('Views')
ax1.legend()
ax1.grid(True, alpha=0.3)

# Plot 2: Full 10 years (log scale)
ax2.fill_between(smooth_days, smooth_curves['p10'], smooth_curves['p90'],
                 alpha=0.2, color='blue', label='10th-90th percentile')
ax2.fill_between(smooth_days, smooth_curves['p25'], smooth_curves['p75'],
                 alpha=0.3, color='blue', label='25th-75th percentile')
ax2.plot(smooth_days, smooth_curves['p50'], 'b-', linewidth=2, label='Median')

# Add year markers
for year in range(1, 11):
    ax2.axvline(x=year*365, color='red', linestyle='--', alpha=0.3)

ax2.set_title('10-Year Performance Envelope', fontsize=14)
ax2.set_xlabel('Days Since Published')
ax2.set_ylabel('Views (log scale)')
ax2.legend()
ax2.grid(True, alpha=0.3)
ax2.set_yscale('log')

# Plot 3: Sample distribution
sample_days = [d['day'] for d in percentile_data]
sample_counts = [d['count'] for d in percentile_data]

# Bin by year for cleaner visualization
yearly_data = defaultdict(int)
for d in percentile_data:
    year = min(d['day'] // 365, 9)
    yearly_data[year] += d['count']

ax3.bar(range(10), [yearly_data[i] for i in range(10)], alpha=0.7, color='green')
ax3.set_title('Data Distribution by Year', fontsize=14)
ax3.set_xlabel('Year')
ax3.set_ylabel('Total Snapshots')
ax3.grid(True, alpha=0.3, axis='y')

# Plot 4: Statistics
ax4.axis('off')
p50 = smooth_curves['p50']

# Key milestones
milestones = [
    (1, "Day 1"),
    (7, "Week 1"),
    (30, "Month 1"),
    (90, "Month 3"),
    (365, "Year 1"),
    (730, "Year 2"),
    (1825, "Year 5"),
    (3650, "Year 10")
]

stats_lines = ["10-YEAR PERFORMANCE STATISTICS\n"]
stats_lines.append(f"Total data points: {sum(d['count'] for d in percentile_data):,}")
stats_lines.append(f"Days with data: {len(percentile_data):,}\n")
stats_lines.append("Median Growth:")

for day, label in milestones:
    if day < len(p50):
        stats_lines.append(f"• {label:8s}: {p50[day]:8,.0f} views")

# Growth rates
if p50[1] > 0:
    stats_lines.append(f"\nGrowth from Day 1:")
    stats_lines.append(f"• Week 1:  {(p50[7]/p50[1]-1)*100:6.1f}%")
    stats_lines.append(f"• Month 1: {(p50[30]/p50[1]-1)*100:6.1f}%")
    stats_lines.append(f"• Year 1:  {(p50[365]/p50[1]-1)*100:6.1f}%")
    stats_lines.append(f"• Year 10: {(p50[3650]/p50[1]-1)*100:6.1f}%")

ax4.text(0.05, 0.5, '\n'.join(stats_lines), fontsize=12,
         verticalalignment='center', fontfamily='monospace',
         bbox=dict(boxstyle="round,pad=0.5", facecolor="lightgray", alpha=0.3))

plt.tight_layout()
plt.savefig('ten_year_performance_envelope.png', dpi=300, bbox_inches='tight')
print("   Saved to: ten_year_performance_envelope.png")

# Update database efficiently
print("\n💾 Updating database with 10-year curves...")

# Update in smaller batches
batch_size = 50
updates = []

for i in range(0, 3651):  # 0 to 3650
    sample_count = next((d['count'] for d in percentile_data if d['day'] == i), 0)
    
    update = {
        'day_since_published': i,
        'p10_views': int(smooth_curves['p10'][i]),
        'p25_views': int(smooth_curves['p25'][i]),
        'p50_views': int(smooth_curves['p50'][i]),
        'p75_views': int(smooth_curves['p75'][i]),
        'p90_views': int(smooth_curves['p90'][i]),
        'p95_views': int(smooth_curves['p95'][i]),
        'sample_count': sample_count,
        'updated_at': datetime.now().isoformat()
    }
    
    updates.append(update)
    
    # Process batch when full
    if len(updates) >= batch_size:
        for u in updates:
            supabase.table('performance_envelopes')\
                .upsert(u, on_conflict='day_since_published')\
                .execute()
        print(f"   Updated days {i-batch_size+1} to {i}")
        updates = []

# Process remaining updates
if updates:
    for u in updates:
        supabase.table('performance_envelopes')\
            .upsert(u, on_conflict='day_since_published')\
            .execute()

print("\n✅ SUCCESS! 10-year performance curves created and saved to database!")
print("   The system now captures the full YouTube video lifecycle.")