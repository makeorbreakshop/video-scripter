#!/usr/bin/env python3
"""
Create scatter plot with REAL data points for 5 years
More efficient version that samples the data
"""

import os
import matplotlib.pyplot as plt
import numpy as np
from supabase import create_client, Client
from dotenv import load_dotenv
from collections import defaultdict
import random

# Load environment variables
load_dotenv()

# Initialize Supabase client
url = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
supabase: Client = create_client(url, key)

print("🎯 Creating 5-Year Scatter + Line Chart with REAL Data")
print("=" * 60)

# Get a sample of raw snapshot data for visualization
print("\n📊 Fetching sample of raw snapshot data...")

# Sample every 7 days to reduce data volume
sampled_days = list(range(1, 1826, 7))  # Every week for 5 years
all_samples = []

for i in range(0, len(sampled_days), 10):  # Process 10 days at a time
    days_batch = sampled_days[i:i+10]
    
    # Get snapshots for these specific days
    batch = supabase.table('view_snapshots')\
        .select('days_since_published, view_count, videos(duration)')\
        .in_('days_since_published', days_batch)\
        .limit(1000)\
        .execute()
    
    if batch.data:
        # Filter for non-Shorts
        for row in batch.data:
            if row.get('videos') and row['videos'].get('duration') and row['view_count']:
                dur = row['videos']['duration']
                
                # Quick check for non-Shorts (>121 seconds)
                is_long = False
                if 'H' in dur or ('M' in dur and 'PT' in dur):
                    is_long = True
                elif 'PT' in dur and 'S' in dur and not 'M' in dur:
                    try:
                        secs = int(dur.split('S')[0].split('PT')[-1])
                        if secs > 121:
                            is_long = True
                    except:
                        pass
                
                if is_long:
                    all_samples.append({
                        'day': row['days_since_published'],
                        'views': row['view_count']
                    })
    
    print(f"   Processed days {days_batch[0]}-{days_batch[-1]}: {len(all_samples)} total samples")

print(f"\n   Total samples collected: {len(all_samples):,}")

# Group by day and calculate medians
views_by_day = defaultdict(list)
for sample in all_samples:
    views_by_day[sample['day']].append(sample['views'])

# Create scatter data
scatter_days = []
scatter_views = []
scatter_medians = []

for day in sorted(views_by_day.keys()):
    day_views = views_by_day[day]
    median = np.median(day_views)
    
    # Add median point
    scatter_days.append(day)
    scatter_medians.append(median)
    
    # Add some individual points for variance visualization
    # Sample up to 20 points per day
    sample_size = min(20, len(day_views))
    if sample_size > 0:
        sampled_views = random.sample(day_views, sample_size)
        for v in sampled_views:
            scatter_days.append(day)
            scatter_views.append(v)

print(f"   Created {len(scatter_views)} scatter points")

# Get smooth curve data
print("\n📊 Fetching smooth curve data...")
curve_data = supabase.table('performance_envelopes')\
    .select('day_since_published, p50_views, sample_count')\
    .lte('day_since_published', 1825)\
    .order('day_since_published')\
    .execute()

smooth_days = np.array([d['day_since_published'] for d in curve_data.data])
smooth_p50 = np.array([d['p50_views'] for d in curve_data.data])

# Create the main chart
fig, ax = plt.subplots(1, 1, figsize=(16, 9))

# Plot individual data points (very transparent)
if scatter_views:
    ax.scatter(scatter_days[:len(scatter_views)], scatter_views, 
               alpha=0.1, s=20, color='lightgray', label='Individual videos')

# Plot median points
ax.scatter(scatter_days[len(scatter_views):], scatter_medians, 
           alpha=0.6, s=50, color='darkgray', label='Weekly medians', edgecolors='black', linewidth=0.5)

# Plot smooth curve
ax.plot(smooth_days, smooth_p50, 'b-', linewidth=3, label='Smooth median curve', zorder=10)

# Add year markers
for year in range(1, 6):
    ax.axvline(x=year*365, color='red', linestyle='--', alpha=0.3)
    ax.text(year*365, ax.get_ylim()[1]*0.95, f'Year {year}', 
            ha='center', fontsize=10, alpha=0.7, 
            bbox=dict(boxstyle="round,pad=0.3", facecolor='white', alpha=0.7))

# Formatting
ax.set_xlabel('Days Since Published', fontsize=12)
ax.set_ylabel('Views', fontsize=12)
ax.set_title('YouTube Video Performance - First 5 Years (Real Data)', fontsize=16, fontweight='bold')
ax.legend(fontsize=11, loc='upper left')
ax.grid(True, alpha=0.3)

# Format y-axis with commas
ax.yaxis.set_major_formatter(plt.FuncFormatter(lambda x, p: f'{int(x):,}'))

# Set limits
ax.set_xlim(-30, 1855)
ax.set_ylim(bottom=0, top=max(max(scatter_views) if scatter_views else 0, max(smooth_p50)) * 1.1)

# Add statistics box
stats_text = f"Data Points: {len(all_samples):,}\n"
stats_text += f"Weekly Samples: {len(scatter_medians)}\n"
stats_text += f"5-Year Growth: {smooth_p50[min(1825, len(smooth_p50)-1)]/smooth_p50[1]:.1f}x"

ax.text(0.98, 0.35, stats_text, transform=ax.transAxes,
        fontsize=10, verticalalignment='top', horizontalalignment='right',
        bbox=dict(boxstyle='round', facecolor='wheat', alpha=0.8))

plt.tight_layout()
plt.savefig('real_scatter_5_years.png', dpi=300, bbox_inches='tight')
print("\n✅ Saved to: real_scatter_5_years.png")

# Create a cleaner version with just medians
fig2, ax2 = plt.subplots(1, 1, figsize=(14, 8))

# Plot median scatter points
ax2.scatter(scatter_days[len(scatter_views):], scatter_medians, 
            alpha=0.5, s=40, color='gray', label='Raw data (weekly medians)')

# Plot smooth curve
ax2.plot(smooth_days, smooth_p50, 'b-', linewidth=2.5, label='Smooth curve')

# Year markers
for year in range(1, 6):
    ax2.axvline(x=year*365, color='gray', linestyle=':', alpha=0.5)

ax2.set_xlabel('Days Since Published')
ax2.set_ylabel('Views')
ax2.set_title('Median Views - First 5 Years')
ax2.grid(True, alpha=0.3)
ax2.legend()
ax2.yaxis.set_major_formatter(plt.FuncFormatter(lambda x, p: f'{int(x):,}'))
ax2.set_xlim(0, 1825)
ax2.set_ylim(0, max(smooth_p50) * 1.1)

plt.tight_layout()
plt.savefig('median_views_5_years_real.png', dpi=300, bbox_inches='tight')
print("   Saved clean version to: median_views_5_years_real.png")

print(f"\n📊 Data Summary:")
print(f"   Unique days sampled: {len(views_by_day)}")
print(f"   Total data points: {len(all_samples):,}")
print(f"   Average samples per day: {len(all_samples)/len(views_by_day):.1f}")