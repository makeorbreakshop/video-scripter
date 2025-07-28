#!/usr/bin/env python3
"""
Create scatter plot with line chart for 5 years (1,825 days)
"""

import os
import matplotlib.pyplot as plt
import numpy as np
from supabase import create_client, Client
from dotenv import load_dotenv
from collections import defaultdict

# Load environment variables
load_dotenv()

# Initialize Supabase client
url = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
supabase: Client = create_client(url, key)

print("🎯 Creating 5-Year Scatter + Line Chart")
print("=" * 60)

# Get raw snapshot data for 5 years
print("\n📊 Fetching raw snapshot data for 5 years (1,825 days)...")
raw_snapshots = []
offset = 0
batch_size = 1000
total_processed = 0

# Process in yearly chunks for efficiency
for year in range(6):  # 0-5 years
    start_day = year * 365
    end_day = min((year + 1) * 365, 1825)
    
    print(f"   Processing Year {year} (days {start_day}-{end_day})...")
    offset = 0
    
    while True:
        batch = supabase.table('view_snapshots')\
            .select('days_since_published, view_count, videos(duration)')\
            .gte('days_since_published', start_day)\
            .lt('days_since_published', end_day)\
            .range(offset, offset + batch_size - 1)\
            .execute()
        
        if not batch.data:
            break
        
        # Filter for non-Shorts
        for row in batch.data:
            if row.get('videos') and row['videos'].get('duration') and row['view_count']:
                dur = row['videos']['duration']
                
                # Check for non-Shorts
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
                    raw_snapshots.append({
                        'day': row['days_since_published'],
                        'views': row['view_count']
                    })
        
        offset += batch_size
        total_processed += len(batch.data)
        
        if len(batch.data) < batch_size:
            break

print(f"   Found {len(raw_snapshots):,} non-Short snapshots")

# Get smooth curve data
print("\n📊 Fetching smooth curve data for 5 years...")
curve_data = []
offset = 0

while offset <= 1825:
    batch = supabase.table('performance_envelopes')\
        .select('*')\
        .gte('day_since_published', offset)\
        .lte('day_since_published', min(offset + batch_size - 1, 1825))\
        .order('day_since_published')\
        .execute()
    
    if batch.data:
        curve_data.extend(batch.data)
    
    offset += batch_size
    
    if offset > 1825:
        break

print(f"   Retrieved {len(curve_data)} days of curve data")

# Process raw data for scatter plot
views_by_day = defaultdict(list)
for snap in raw_snapshots:
    views_by_day[snap['day']].append(snap['views'])

# Calculate raw medians for scatter points
# Sample every nth day for cleaner visualization
sampling_interval = 7  # Show weekly medians for cleaner plot
scatter_days = []
scatter_medians = []

for day in sorted(views_by_day.keys()):
    if day % sampling_interval == 0 and views_by_day[day]:
        scatter_days.append(day)
        scatter_medians.append(np.median(views_by_day[day]))

# Extract smooth curve data
smooth_days = np.array([d['day_since_published'] for d in curve_data])
smooth_p50 = np.array([d['p50_views'] for d in curve_data])

# Create the chart
fig, ax = plt.subplots(1, 1, figsize=(14, 8))

# Plot scatter points (weekly medians)
ax.scatter(scatter_days, scatter_medians, alpha=0.6, s=40, color='gray', label='Raw data (weekly)')

# Plot smooth curve
ax.plot(smooth_days, smooth_p50, 'b-', linewidth=2.5, label='Smooth curve')

# Add year markers
for year in range(1, 6):
    ax.axvline(x=year*365, color='red', linestyle='--', alpha=0.3)
    ax.text(year*365, ax.get_ylim()[1]*0.95, f'Year {year}', ha='center', fontsize=9, alpha=0.7)

# Formatting
ax.set_xlabel('Days Since Published', fontsize=12)
ax.set_ylabel('Views', fontsize=12)
ax.set_title('Median Views - First 5 Years', fontsize=14, fontweight='bold')
ax.legend(fontsize=10)
ax.grid(True, alpha=0.3)

# Format y-axis with commas
ax.yaxis.set_major_formatter(plt.FuncFormatter(lambda x, p: f'{int(x):,}'))

# Set limits
ax.set_xlim(-30, 1855)
ax.set_ylim(bottom=0)

# Add key milestone annotations
milestones = [
    (1, smooth_p50[1] if len(smooth_p50) > 1 else 0),
    (30, smooth_p50[30] if len(smooth_p50) > 30 else 0),
    (365, smooth_p50[365] if len(smooth_p50) > 365 else 0),
    (1825, smooth_p50[1825] if len(smooth_p50) > 1825 else 0)
]

for day, views in milestones:
    if views > 0:
        label = f'Day {day}: {views:,.0f}'
        if day == 365:
            label = f'Year 1: {views:,.0f}'
        elif day == 1825:
            label = f'Year 5: {views:,.0f}'
        
        ax.annotate(label, 
                    xy=(day, views), 
                    xytext=(day+100, views*1.2),
                    arrowprops=dict(arrowstyle='->', alpha=0.5, color='black'),
                    fontsize=9, alpha=0.8)

plt.tight_layout()
plt.savefig('scatter_line_chart_5_years.png', dpi=300, bbox_inches='tight')
print("\n✅ Saved to: scatter_line_chart_5_years.png")

# Create a log scale version
fig2, ax2 = plt.subplots(1, 1, figsize=(14, 8))

# Plot scatter points (weekly medians)
ax2.scatter(scatter_days, scatter_medians, alpha=0.6, s=40, color='gray', label='Raw data (weekly)')

# Plot smooth curve
ax2.plot(smooth_days, smooth_p50, 'b-', linewidth=2.5, label='Smooth curve')

# Add year markers
for year in range(1, 6):
    ax2.axvline(x=year*365, color='red', linestyle='--', alpha=0.3)
    ax2.text(year*365, 10**5.5, f'Year {year}', ha='center', fontsize=9, alpha=0.7)

# Formatting
ax2.set_xlabel('Days Since Published', fontsize=12)
ax2.set_ylabel('Views (log scale)', fontsize=12)
ax2.set_title('Median Views - First 5 Years (Log Scale)', fontsize=14, fontweight='bold')
ax2.legend(fontsize=10)
ax2.grid(True, alpha=0.3, which='both')
ax2.set_yscale('log')
ax2.set_xlim(-30, 1855)
ax2.set_ylim(bottom=1000)

plt.tight_layout()
plt.savefig('scatter_line_chart_5_years_log.png', dpi=300, bbox_inches='tight')
print("   Saved log scale version to: scatter_line_chart_5_years_log.png")

# Print summary stats
print("\n📊 5-Year Growth Summary:")
if len(smooth_p50) > 1825:
    print(f"   Day 1:    {smooth_p50[1]:>10,.0f} views")
    print(f"   Month 1:  {smooth_p50[30]:>10,.0f} views ({smooth_p50[30]/smooth_p50[1]:.1f}x)")
    print(f"   Year 1:   {smooth_p50[365]:>10,.0f} views ({smooth_p50[365]/smooth_p50[1]:.1f}x)")
    print(f"   Year 3:   {smooth_p50[1095]:>10,.0f} views ({smooth_p50[1095]/smooth_p50[1]:.1f}x)")
    print(f"   Year 5:   {smooth_p50[1825]:>10,.0f} views ({smooth_p50[1825]/smooth_p50[1]:.1f}x)")
    print(f"\n   Total 5-year growth: {smooth_p50[1825]/smooth_p50[1]:.1f}x")