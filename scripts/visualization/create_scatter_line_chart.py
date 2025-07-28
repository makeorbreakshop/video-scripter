#!/usr/bin/env python3
"""
Create the scatter plot with line chart overlay style
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

print("🎯 Creating Scatter + Line Chart (Original Style)")
print("=" * 60)

# Get raw snapshot data for first 90 days
print("\n📊 Fetching raw snapshot data for first 90 days...")
raw_snapshots = []
offset = 0
batch_size = 1000

while True:
    batch = supabase.table('view_snapshots')\
        .select('days_since_published, view_count, videos(duration)')\
        .lte('days_since_published', 90)\
        .gte('days_since_published', 0)\
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
    if len(batch.data) < batch_size:
        break

print(f"   Found {len(raw_snapshots):,} non-Short snapshots")

# Get smooth curve data
print("\n📊 Fetching smooth curve data...")
curve_data = supabase.table('performance_envelopes')\
    .select('*')\
    .lte('day_since_published', 90)\
    .order('day_since_published')\
    .execute()

# Process raw data for scatter plot
views_by_day = defaultdict(list)
for snap in raw_snapshots:
    views_by_day[snap['day']].append(snap['views'])

# Calculate raw medians for scatter points
scatter_days = []
scatter_medians = []
for day in sorted(views_by_day.keys()):
    if views_by_day[day]:
        scatter_days.append(day)
        scatter_medians.append(np.median(views_by_day[day]))

# Extract smooth curve data
smooth_days = np.array([d['day_since_published'] for d in curve_data.data])
smooth_p50 = np.array([d['p50_views'] for d in curve_data.data])

# Create the chart
fig, ax = plt.subplots(1, 1, figsize=(10, 6))

# Plot scatter points (raw daily medians)
ax.scatter(scatter_days, scatter_medians, alpha=0.5, s=50, color='gray', label='Raw data')

# Plot smooth curve
ax.plot(smooth_days, smooth_p50, 'b-', linewidth=2, label='Smooth curve')

# Formatting
ax.set_xlabel('Days Since Published')
ax.set_ylabel('Views')
ax.set_title('Median Views - First 90 Days')
ax.legend()
ax.grid(True, alpha=0.3)

# Format y-axis with commas
ax.yaxis.set_major_formatter(plt.FuncFormatter(lambda x, p: f'{int(x):,}'))

# Set limits
ax.set_xlim(-2, 92)
ax.set_ylim(bottom=0)

plt.tight_layout()
plt.savefig('scatter_line_chart_90_days.png', dpi=300, bbox_inches='tight')
print("\n✅ Saved to: scatter_line_chart_90_days.png")

# Create a version with more detail in the title
fig2, ((ax1, ax2), (ax3, ax4)) = plt.subplots(2, 2, figsize=(15, 10))

# Top left: Same as above
ax1.scatter(scatter_days, scatter_medians, alpha=0.5, s=50, color='gray', label='Raw data')
ax1.plot(smooth_days, smooth_p50, 'b-', linewidth=2, label='Smooth curve')
ax1.set_xlabel('Days Since Published')
ax1.set_ylabel('Views')
ax1.set_title('Median Views - First 90 Days')
ax1.legend()
ax1.grid(True, alpha=0.3)
ax1.yaxis.set_major_formatter(plt.FuncFormatter(lambda x, p: f'{int(x):,}'))
ax1.set_xlim(-2, 92)
ax1.set_ylim(bottom=0)

# Top right: Sample sizes
sample_counts = [len(views_by_day[day]) for day in scatter_days]
ax2.bar(scatter_days, sample_counts, alpha=0.7, color='green')
ax2.set_xlabel('Days Since Published')
ax2.set_ylabel('Number of Videos')
ax2.set_title('Sample Size by Day (First 90 Days)')
ax2.grid(True, alpha=0.3)
ax2.set_xlim(-2, 92)

# Bottom left: Box plot style showing distribution
days_to_plot = [1, 7, 14, 30, 60, 90]
box_data = []
box_labels = []
for day in days_to_plot:
    if day in views_by_day and len(views_by_day[day]) > 10:
        box_data.append(views_by_day[day])
        box_labels.append(f'Day {day}')

if box_data:
    ax3.boxplot(box_data, labels=box_labels)
    ax3.set_ylabel('Views')
    ax3.set_title('View Distribution at Key Days')
    ax3.grid(True, alpha=0.3, axis='y')
    ax3.set_yscale('log')

# Bottom right: Text summary
ax4.axis('off')
summary_text = f"""
Summary Statistics:

Total Videos: {len(raw_snapshots):,}
Days with Data: {len(scatter_days)}

Median Views by Day:
• Day 1:  {smooth_p50[1]:,.0f} views
• Day 7:  {smooth_p50[7]:,.0f} views  
• Day 30: {smooth_p50[30]:,.0f} views
• Day 90: {smooth_p50[90]:,.0f} views

Growth Rate:
• Week 1:  {(smooth_p50[7]/smooth_p50[1]-1)*100:.1f}%
• Month 1: {(smooth_p50[30]/smooth_p50[1]-1)*100:.1f}%
• Month 3: {(smooth_p50[90]/smooth_p50[1]-1)*100:.1f}%
"""

ax4.text(0.1, 0.5, summary_text, fontsize=12, 
         verticalalignment='center', fontfamily='monospace')

plt.suptitle('YouTube Video Performance Analysis - First 90 Days', fontsize=14)
plt.tight_layout()
plt.savefig('detailed_90_day_analysis.png', dpi=300, bbox_inches='tight')
print("   Saved detailed analysis to: detailed_90_day_analysis.png")