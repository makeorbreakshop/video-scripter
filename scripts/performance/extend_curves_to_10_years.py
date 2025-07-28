#!/usr/bin/env python3
"""
Extend existing performance curves from 2 years to 10 years
Using the same approach as before but for extended range
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

print("🎯 Extending Performance Curves to 10 Years")
print("=" * 60)

# We'll process years 3-10 since we already have 0-2 years
print("\n📊 Processing years 3-10 (days 731-3650)...")

all_snapshots = []
total_processed = 0

# Process in yearly chunks for efficiency
for year in range(3, 11):  # Years 3-10
    start_day = year * 365
    end_day = min((year + 1) * 365, 3650)
    
    print(f"\n   Processing Year {year} (days {start_day}-{end_day})...")
    
    offset = 0
    batch_size = 1000
    year_snapshots = 0
    
    while True:
        # Get batch of snapshots with video info
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
                
                # Check for non-Shorts
                is_long_video = False
                
                if 'H' in dur:
                    is_long_video = True
                elif 'M' in dur and 'PT' in dur:
                    try:
                        minutes = int(dur.split('M')[0].split('PT')[-1])
                        if minutes >= 2:
                            is_long_video = True
                    except:
                        pass
                elif 'PT' in dur and 'S' in dur and not 'M' in dur:
                    try:
                        seconds = int(dur.split('S')[0].split('PT')[-1])
                        if seconds > 121:
                            is_long_video = True
                    except:
                        pass
                
                if is_long_video:
                    all_snapshots.append({
                        'day': row['days_since_published'],
                        'views': row['view_count']
                    })
                    year_snapshots += 1
        
        offset += batch_size
        total_processed += len(result.data)
        
        if len(result.data) < batch_size:
            break
    
    print(f"      Found {year_snapshots:,} non-Short snapshots")

# Also get data from first 2 years for continuity
print("\n   Getting existing data from years 0-2 for smooth transition...")
early_snapshots = []
offset = 0
batch_size = 1000

while True:
    result = supabase.table('view_snapshots')\
        .select('days_since_published, view_count, videos(duration)')\
        .lte('days_since_published', 730)\
        .gte('days_since_published', 0)\
        .range(offset, offset + batch_size - 1)\
        .execute()
    
    if not result.data:
        break
    
    for row in result.data:
        if row.get('videos') and row['videos'].get('duration') and row['view_count']:
            dur = row['videos']['duration']
            
            # Check for non-Shorts (same logic)
            is_long_video = False
            if 'H' in dur:
                is_long_video = True
            elif 'M' in dur and 'PT' in dur:
                try:
                    minutes = int(dur.split('M')[0].split('PT')[-1])
                    if minutes >= 2:
                        is_long_video = True
                except:
                    pass
            elif 'PT' in dur and 'S' in dur and not 'M' in dur:
                try:
                    seconds = int(dur.split('S')[0].split('PT')[-1])
                    if seconds > 121:
                        is_long_video = True
                except:
                    pass
            
            if is_long_video:
                early_snapshots.append({
                    'day': row['days_since_published'],
                    'views': row['view_count']
                })
    
    offset += batch_size
    if len(result.data) < batch_size:
        break

# Combine all snapshots
all_snapshots.extend(early_snapshots)
print(f"\n✅ Total non-Short snapshots collected: {len(all_snapshots):,}")

# Calculate percentiles
print("\n📈 Calculating percentiles for 10-year range...")
views_by_day = defaultdict(list)

for snap in all_snapshots:
    views_by_day[snap['day']].append(snap['views'])

# Calculate percentiles for each day
percentile_data = []
for day in range(3651):  # 0 to 3650
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
print("\n🎨 Creating smooth 10-year curves...")
days = np.array([d['day'] for d in percentile_data])
smooth_days = np.arange(0, 3651)
smooth_curves = {}

for percentile in ['p10', 'p25', 'p50', 'p75', 'p90', 'p95']:
    raw_values = np.array([d[percentile] for d in percentile_data])
    
    # Interpolate
    interpolated = np.interp(smooth_days, days, raw_values)
    
    # Apply graduated smoothing - heavier for older data
    smooth_values = np.zeros_like(interpolated)
    
    # Copy early data smoothing approach
    smooth_values[:8] = gaussian_filter1d(interpolated[:8], sigma=0.5)
    smooth_values[8:31] = gaussian_filter1d(interpolated[8:31], sigma=1.0)
    smooth_values[31:91] = gaussian_filter1d(interpolated[31:91], sigma=2.0)
    smooth_values[91:366] = gaussian_filter1d(interpolated[91:366], sigma=3.0)
    smooth_values[366:731] = gaussian_filter1d(interpolated[366:731], sigma=5.0)
    
    # Extended years with heavier smoothing
    smooth_values[731:1461] = gaussian_filter1d(interpolated[731:1461], sigma=8.0)
    smooth_values[1461:2556] = gaussian_filter1d(interpolated[1461:2556], sigma=12.0)
    smooth_values[2556:] = gaussian_filter1d(interpolated[2556:], sigma=20.0)
    
    # Ensure non-negative
    smooth_values = np.maximum(smooth_values, 0)
    
    smooth_curves[percentile] = smooth_values

# Create visualization
print("\n📊 Creating visualization...")
fig, ax = plt.subplots(1, 1, figsize=(14, 8))

# Plot the envelope
ax.fill_between(smooth_days, smooth_curves['p10'], smooth_curves['p90'],
                alpha=0.2, color='blue', label='10th-90th percentile')
ax.fill_between(smooth_days, smooth_curves['p25'], smooth_curves['p75'],
                alpha=0.3, color='blue', label='25th-75th percentile')
ax.plot(smooth_days, smooth_curves['p50'], 'b-', linewidth=2, label='Median')

# Add year markers
for year in range(1, 11):
    ax.axvline(x=year*365, color='red', linestyle='--', alpha=0.3)
    ax.text(year*365, ax.get_ylim()[1]*0.95, f'Y{year}', ha='center', fontsize=8)

ax.set_title('10-Year YouTube Performance Envelope', fontsize=16)
ax.set_xlabel('Days Since Published')
ax.set_ylabel('Views (log scale)')
ax.legend()
ax.grid(True, alpha=0.3)
ax.set_yscale('log')
ax.set_xlim(0, 3650)

# Add statistics text
p50 = smooth_curves['p50']
stats_text = f"""Median views: Day 1: {p50[1]:,.0f} | Month 1: {p50[30]:,.0f} | Year 1: {p50[365]:,.0f} | Year 5: {p50[1825]:,.0f} | Year 10: {p50[3650]:,.0f}"""
ax.text(0.5, 0.02, stats_text, transform=ax.transAxes, 
        ha='center', fontsize=10, bbox=dict(boxstyle="round,pad=0.3", facecolor="white", alpha=0.8))

plt.tight_layout()
plt.savefig('ten_year_performance_envelope.png', dpi=300, bbox_inches='tight')
print("   Saved visualization")

# Update database
print("\n💾 Updating database with 10-year curves...")

# Process updates in batches
batch_size = 100
for start_idx in range(0, 3651, batch_size):
    end_idx = min(start_idx + batch_size, 3651)
    
    updates = []
    for i in range(start_idx, end_idx):
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
    
    # Batch upsert
    for update in updates:
        supabase.table('performance_envelopes')\
            .upsert(update, on_conflict='day_since_published')\
            .execute()
    
    print(f"   Updated days {start_idx}-{end_idx-1}")

print("\n✅ SUCCESS! Performance curves extended to 10 years!")
print("   The system now captures the full YouTube video lifecycle.")