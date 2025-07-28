#!/usr/bin/env python3
"""
Create performance curves extended to 10 years (3,650 days)
Process all snapshots to capture full YouTube video lifecycle
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

print("🎯 Creating 10-Year Performance Curves (3,650 days)")
print("=" * 60)

# First, let's check data availability across the 10-year range
print("\n📊 Checking data distribution across 10 years...")
ranges = [
    (0, 365, "Year 1"),
    (366, 730, "Year 2"),
    (731, 1095, "Year 3"),
    (1096, 1460, "Year 4"),
    (1461, 1825, "Year 5"),
    (1826, 2190, "Year 6"),
    (2191, 2555, "Year 7"),
    (2556, 2920, "Year 8"),
    (2921, 3285, "Year 9"),
    (3286, 3650, "Year 10")
]

for start_day, end_day, label in ranges:
    check_result = supabase.table('view_snapshots')\
        .select('days_since_published', count='exact')\
        .gte('days_since_published', start_day)\
        .lte('days_since_published', end_day)\
        .execute()
    print(f"   {label} (days {start_day:4d}-{end_day:4d}): {check_result.count:8,} snapshots")

# Get ALL snapshots up to 3650 days (10 years)
print("\n📊 Fetching all snapshots up to 3,650 days...")

all_snapshots = []
offset = 0
batch_size = 1000
total_processed = 0

while True:
    # Get batch of snapshots with video info
    result = supabase.table('view_snapshots')\
        .select('days_since_published, view_count, videos(duration)')\
        .lte('days_since_published', 3650)\
        .gte('days_since_published', 0)\
        .range(offset, offset + batch_size - 1)\
        .execute()
    
    if not result.data:
        break
    
    # Process each snapshot
    for row in result.data:
        if row.get('videos') and row['videos'].get('duration') and row['view_count']:
            dur = row['videos']['duration']
            
            # Simple duration check for non-Shorts
            is_long_video = False
            
            if 'H' in dur:  # Has hours
                is_long_video = True
            elif 'M' in dur:  # Has minutes
                if 'PT' in dur and 'M' in dur:
                    try:
                        minutes_str = dur.split('M')[0].split('PT')[-1]
                        if minutes_str.isdigit() and int(minutes_str) >= 2:
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
    
    if total_processed % 10000 == 0:
        print(f"   Processed {total_processed:,} records, found {len(all_snapshots):,} non-Short snapshots...")
    
    if len(result.data) < batch_size:
        break

print(f"\n✅ Total non-Short snapshots (0-3,650 days): {len(all_snapshots):,}")

# Calculate percentiles
print("\n📈 Calculating percentiles for 10-year range...")
views_by_day = defaultdict(list)

for snap in all_snapshots:
    views_by_day[snap['day']].append(snap['views'])

# Show data volume at key points
print(f"\n   Sample sizes at key yearly milestones:")
for year in range(11):
    day = year * 365
    if day <= 3650 and day in views_by_day:
        print(f"   Year {year:2d} (day {day:4d}): {len(views_by_day[day]):,} snapshots")

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

print(f"\n   Days with sufficient data (10+ videos): {len(percentile_data)}")

# Create smooth curves for 3650 days with adaptive smoothing
print("\n🎨 Creating natural smooth curves (10 years) with adaptive smoothing...")
days = np.array([d['day'] for d in percentile_data])
smooth_days = np.arange(0, 3651)
smooth_curves = {}

for percentile in ['p10', 'p25', 'p50', 'p75', 'p90', 'p95']:
    raw_values = np.array([d[percentile] for d in percentile_data])
    
    # Interpolate
    interpolated = np.interp(smooth_days, days, raw_values)
    
    # Apply graduated smoothing - heavier for older data
    smooth_values = np.zeros_like(interpolated)
    
    # Days 0-7: Very light smoothing (critical early growth)
    smooth_values[:8] = gaussian_filter1d(interpolated[:8], sigma=0.5)
    
    # Days 8-30: Light smoothing
    smooth_values[8:31] = gaussian_filter1d(interpolated[8:31], sigma=1.0)
    
    # Days 31-90: Medium smoothing
    smooth_values[31:91] = gaussian_filter1d(interpolated[31:91], sigma=2.0)
    
    # Days 91-365: Heavier smoothing (Year 1)
    smooth_values[91:366] = gaussian_filter1d(interpolated[91:366], sigma=3.0)
    
    # Days 366-730: Year 2
    smooth_values[366:731] = gaussian_filter1d(interpolated[366:731], sigma=5.0)
    
    # Days 731-1460: Years 3-4
    smooth_values[731:1461] = gaussian_filter1d(interpolated[731:1461], sigma=8.0)
    
    # Days 1461-2555: Years 5-7
    smooth_values[1461:2556] = gaussian_filter1d(interpolated[1461:2556], sigma=12.0)
    
    # Days 2556-3650: Years 8-10 (sparsest data)
    smooth_values[2556:] = gaussian_filter1d(interpolated[2556:], sigma=20.0)
    
    # Ensure non-negative
    smooth_values = np.maximum(smooth_values, 0)
    
    smooth_curves[percentile] = smooth_values

# Create comprehensive visualization
print("\n📊 Creating 10-year visualization...")
fig = plt.figure(figsize=(20, 16))

# Create a 3x2 grid for different views
gs = fig.add_gridspec(3, 2, height_ratios=[2, 2, 1], hspace=0.3, wspace=0.3)

# Plot 1: First 90 days detail
ax1 = fig.add_subplot(gs[0, 0])
raw_days = [d['day'] for d in percentile_data if d['day'] <= 90]
raw_p50 = [d['p50'] for d in percentile_data if d['day'] <= 90]

ax1.scatter(raw_days, raw_p50, alpha=0.5, s=30, color='gray', label='Raw data')
ax1.plot(smooth_days[:91], smooth_curves['p50'][:91], 'b-', linewidth=2, label='Smooth curve')
ax1.set_title('Median Views - First 90 Days', fontsize=14)
ax1.set_xlabel('Days Since Published')
ax1.set_ylabel('Views')
ax1.legend()
ax1.grid(True, alpha=0.3)

# Plot 2: Full 10-year envelope (log scale)
ax2 = fig.add_subplot(gs[0, 1])
ax2.fill_between(smooth_days, smooth_curves['p10'], smooth_curves['p90'],
                 alpha=0.2, color='blue', label='10th-90th percentile')
ax2.fill_between(smooth_days, smooth_curves['p25'], smooth_curves['p75'],
                 alpha=0.3, color='blue', label='25th-75th percentile')
ax2.plot(smooth_days, smooth_curves['p50'], 'b-', linewidth=2, label='Median')

# Add year markers
for year in range(1, 11):
    ax2.axvline(x=year*365, color='red', linestyle='--', alpha=0.3)
    ax2.text(year*365, ax2.get_ylim()[1]*0.9, f'Y{year}', ha='center', fontsize=8)

ax2.set_title('10-Year Performance Envelope (Log Scale)', fontsize=14)
ax2.set_xlabel('Days Since Published')
ax2.set_ylabel('Views')
ax2.legend()
ax2.grid(True, alpha=0.3)
ax2.set_yscale('log')

# Plot 3: Linear scale view (first 2 years)
ax3 = fig.add_subplot(gs[1, 0])
ax3.fill_between(smooth_days[:731], smooth_curves['p10'][:731], smooth_curves['p90'][:731],
                 alpha=0.2, color='green')
ax3.fill_between(smooth_days[:731], smooth_curves['p25'][:731], smooth_curves['p75'][:731],
                 alpha=0.3, color='green')
ax3.plot(smooth_days[:731], smooth_curves['p50'][:731], 'g-', linewidth=2)
ax3.axvline(x=365, color='red', linestyle='--', alpha=0.5, label='1 year')
ax3.set_title('First 2 Years - Linear Scale', fontsize=14)
ax3.set_xlabel('Days Since Published')
ax3.set_ylabel('Views')
ax3.grid(True, alpha=0.3)

# Plot 4: Sample sizes across 10 years
ax4 = fig.add_subplot(gs[1, 1])
sample_days = [d['day'] for d in percentile_data]
sample_counts = [d['count'] for d in percentile_data]

# Create yearly bins for better visualization
yearly_bins = np.arange(0, 3651, 365)
yearly_counts = []
for i in range(len(yearly_bins)-1):
    counts_in_year = [d['count'] for d in percentile_data 
                      if yearly_bins[i] <= d['day'] < yearly_bins[i+1]]
    yearly_counts.append(sum(counts_in_year))

ax4.bar(range(1, 11), yearly_counts, alpha=0.7, color='orange')
ax4.set_title('Total Snapshots by Year', fontsize=14)
ax4.set_xlabel('Year')
ax4.set_ylabel('Number of Snapshots')
ax4.grid(True, alpha=0.3, axis='y')

# Plot 5: Statistics panel
ax5 = fig.add_subplot(gs[2, :])
ax5.axis('off')

p50 = smooth_curves['p50']

# Calculate year-over-year growth
year_views = [p50[min(i*365, 3650)] for i in range(11)]

stats_text = f"""
10-YEAR PERFORMANCE ENVELOPE STATISTICS

Data Coverage:
• Total snapshots processed: {len(all_snapshots):,}
• Days with sufficient data: {len(percentile_data):,}
• Coverage: 10 years (3,650 days)

Median (P50) Growth Pattern:
• Day 1: {p50[1]:,.0f} views
• Day 7: {p50[7]:,.0f} views
• Day 30: {p50[30]:,.0f} views
• Day 90: {p50[90]:,.0f} views
• Year 1: {year_views[1]:,.0f} views
• Year 2: {year_views[2]:,.0f} views
• Year 3: {year_views[3]:,.0f} views
• Year 5: {year_views[5]:,.0f} views
• Year 10: {year_views[10]:,.0f} views

Growth Analysis:
• First week growth: {(p50[7]/p50[1]-1)*100:.1f}%
• First month growth: {(p50[30]/p50[1]-1)*100:.1f}%
• First year growth: {(year_views[1]/p50[1]-1)*100:.1f}%
• 10-year total growth: {(year_views[10]/p50[1]-1)*100:.1f}%

Year-over-Year Growth Rates:
• Year 1→2: {((year_views[2]-year_views[1])/year_views[1]*100):.1f}%
• Year 2→3: {((year_views[3]-year_views[2])/year_views[2]*100):.1f}%
• Year 5→10: {((year_views[10]-year_views[5])/year_views[5]*100):.1f}%

Key Insights:
• Most explosive growth happens in first 90 days
• Videos continue accumulating views throughout 10-year period
• Long-tail effect is significant for evergreen content
• Adaptive smoothing handles sparse data in later years
"""

ax5.text(0.05, 0.5, stats_text, fontsize=11, 
         verticalalignment='center', fontfamily='monospace',
         bbox=dict(boxstyle="round,pad=0.5", facecolor="lightgray", alpha=0.3))

plt.tight_layout()
plt.savefig('ten_year_performance_envelope.png', dpi=300, bbox_inches='tight')
print("   Saved to: ten_year_performance_envelope.png")

# Update database with 10-year curves
print("\n💾 Updating database with 10-year curves...")

# First, check if we need to add rows for days beyond current max
existing_max = supabase.table('performance_envelopes')\
    .select('day_since_published')\
    .order('day_since_published', desc=True)\
    .limit(1)\
    .execute()

current_max = existing_max.data[0]['day_since_published'] if existing_max.data else 0
print(f"   Current max day in database: {current_max}")

updates = []
for i in range(3651):  # 0 to 3650
    sample_count = next((d['count'] for d in percentile_data if d['day'] == i), 0)
    
    updates.append({
        'day_since_published': i,
        'p10_views': int(smooth_curves['p10'][i]) if i < len(smooth_curves['p10']) else 0,
        'p25_views': int(smooth_curves['p25'][i]) if i < len(smooth_curves['p25']) else 0,
        'p50_views': int(smooth_curves['p50'][i]) if i < len(smooth_curves['p50']) else 0,
        'p75_views': int(smooth_curves['p75'][i]) if i < len(smooth_curves['p75']) else 0,
        'p90_views': int(smooth_curves['p90'][i]) if i < len(smooth_curves['p90']) else 0,
        'p95_views': int(smooth_curves['p95'][i]) if i < len(smooth_curves['p95']) else 0,
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
    
    if i % 500 == 0:
        print(f"   Updated days {i} to {min(i+batch_size, len(updates))}")

print("\n✅ SUCCESS! 10-year performance curves created:")
print(f"   - Processed {len(all_snapshots):,} non-Short snapshots")
print(f"   - Created curves for 3,650 days (10 years)")
print("   - Natural growth patterns preserved with adaptive smoothing")
print("   - Database updated with extended curves")
print("\n⚡ The performance envelope system now covers the full YouTube video lifecycle!")