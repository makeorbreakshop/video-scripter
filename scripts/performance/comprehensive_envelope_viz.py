#!/usr/bin/env python3
"""
Comprehensive performance envelope visualization with all key charts
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

print("🎯 Creating Comprehensive Performance Envelope Visualization")
print("=" * 60)

# Get curve data
print("\n📊 Fetching performance envelope data...")
all_curve_data = []
offset = 0
batch_size = 1000

while offset <= 2920:
    batch = supabase.table('performance_envelopes')\
        .select('*')\
        .gte('day_since_published', offset)\
        .lte('day_since_published', min(offset + batch_size - 1, 2920))\
        .order('day_since_published')\
        .execute()
    
    if batch.data:
        all_curve_data.extend(batch.data)
    
    offset += batch_size
    
    if offset > 2920:
        break

print(f"   Retrieved {len(all_curve_data)} days of curve data")

# Also get raw snapshot data for first 90 days
print("\n📊 Fetching raw snapshot data for first 90 days...")
raw_snapshots = []
offset = 0

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

print(f"   Found {len(raw_snapshots):,} non-Short snapshots for first 90 days")

# Process raw data for scatter plot
views_by_day = defaultdict(list)
for snap in raw_snapshots:
    views_by_day[snap['day']].append(snap['views'])

# Extract curve arrays
days = np.array([d['day_since_published'] for d in all_curve_data])
p10 = np.array([d['p10_views'] for d in all_curve_data])
p25 = np.array([d['p25_views'] for d in all_curve_data])
p50 = np.array([d['p50_views'] for d in all_curve_data])
p75 = np.array([d['p75_views'] for d in all_curve_data])
p90 = np.array([d['p90_views'] for d in all_curve_data])
p95 = np.array([d['p95_views'] for d in all_curve_data])
sample_counts = np.array([d['sample_count'] for d in all_curve_data])

# Create comprehensive figure
fig = plt.figure(figsize=(20, 14))
gs = fig.add_gridspec(3, 2, height_ratios=[2, 2, 1], hspace=0.3, wspace=0.3)

# Plot 1: First 90 days with raw data
ax1 = fig.add_subplot(gs[0, 0])

# Plot raw data points
for day in sorted(views_by_day.keys()):
    if day <= 90:
        views = views_by_day[day]
        # Sample up to 100 points per day for visualization
        if len(views) > 100:
            import random
            views = random.sample(views, 100)
        ax1.scatter([day] * len(views), views, alpha=0.3, s=20, color='gray')

# Add smooth curve
ax1.plot(days[:91], p50[:91], 'b-', linewidth=2, label='Smooth median curve')
ax1.set_title('Median Views - First 90 Days', fontsize=14)
ax1.set_xlabel('Days Since Published')
ax1.set_ylabel('Views')
ax1.set_ylim(bottom=0)
ax1.legend()
ax1.grid(True, alpha=0.3)

# Plot 2: Full 8-year envelope (log scale)
ax2 = fig.add_subplot(gs[0, 1])
ax2.fill_between(days, p10, p90, alpha=0.2, color='blue', label='10th-90th percentile')
ax2.fill_between(days, p25, p75, alpha=0.3, color='blue', label='25th-75th percentile')
ax2.plot(days, p50, 'b-', linewidth=2, label='Median')
ax2.plot(days, p95, 'r--', linewidth=1.5, alpha=0.7, label='95th percentile (viral threshold)')

# Add year markers
for year in range(1, 9):
    ax2.axvline(x=year*365, color='gray', linestyle=':', alpha=0.5)
    ax2.text(year*365, 10**7.5, f'Y{year}', ha='center', fontsize=8, alpha=0.7)

ax2.set_title('8-Year Performance Envelope', fontsize=14)
ax2.set_xlabel('Days Since Published')
ax2.set_ylabel('Views (log scale)')
ax2.legend()
ax2.grid(True, alpha=0.3)
ax2.set_yscale('log')
ax2.set_xlim(0, 2920)

# Plot 3: Sample size by day (first 2 years for detail)
ax3 = fig.add_subplot(gs[1, 0])
ax3.bar(days[:731], sample_counts[:731], width=1, alpha=0.7, color='green')
ax3.set_title('Sample Size by Day (First 2 Years)', fontsize=14)
ax3.set_xlabel('Days Since Published')
ax3.set_ylabel('Number of Videos')
ax3.grid(True, alpha=0.3)
ax3.axvline(x=365, color='red', linestyle='--', alpha=0.5, label='1 year')

# Plot 4: Year-over-year growth
ax4 = fig.add_subplot(gs[1, 1])
yearly_medians = []
yearly_p90 = []
year_labels = []
for year in range(9):
    day_idx = min(year * 365, 2920)
    if day_idx < len(p50):
        yearly_medians.append(p50[day_idx])
        yearly_p90.append(p90[day_idx])
        year_labels.append(f'Y{year}' if year > 0 else 'Day 0')

x_pos = np.arange(len(year_labels))
width = 0.35

bars1 = ax4.bar(x_pos - width/2, yearly_medians, width, alpha=0.7, color='blue', label='Median')
bars2 = ax4.bar(x_pos + width/2, yearly_p90, width, alpha=0.7, color='green', label='90th percentile')

ax4.set_title('Year-End View Counts', fontsize=14)
ax4.set_xlabel('Time Period')
ax4.set_ylabel('Views')
ax4.set_xticks(x_pos)
ax4.set_xticklabels(year_labels, rotation=45)
ax4.legend()
ax4.grid(True, alpha=0.3, axis='y')
ax4.set_yscale('log')

# Plot 5: Statistics panel
ax5 = fig.add_subplot(gs[2, :])
ax5.axis('off')

# Calculate key metrics
day1_median = p50[1] if len(p50) > 1 else 0
day7_median = p50[7] if len(p50) > 7 else 0
day30_median = p50[30] if len(p50) > 30 else 0
day90_median = p50[90] if len(p50) > 90 else 0
year1_median = p50[365] if len(p50) > 365 else 0
year5_median = p50[1825] if len(p50) > 1825 else 0
year8_median = p50[2920] if len(p50) >= 2920 else 0

stats_text = f"""
8-YEAR PERFORMANCE ENVELOPE - COMPLETE STATISTICS

📊 Data Coverage:
• Total snapshots for first 90 days: {len(raw_snapshots):,}
• Days with curve data: {len(all_curve_data):,} (0-{max(days)} days)
• Coverage: 8 years of stable data

📈 Median (P50) Growth Milestones:
• Day 1:     {day1_median:>10,.0f} views
• Week 1:    {day7_median:>10,.0f} views ({(day7_median/day1_median-1)*100:>6.1f}% growth)
• Month 1:   {day30_median:>10,.0f} views ({(day30_median/day1_median-1)*100:>6.1f}% growth)
• Month 3:   {day90_median:>10,.0f} views ({(day90_median/day1_median-1)*100:>6.1f}% growth)
• Year 1:    {year1_median:>10,.0f} views ({(year1_median/day1_median-1)*100:>6.1f}% growth)
• Year 5:    {year5_median:>10,.0f} views ({(year5_median/day1_median-1)*100:>6.1f}% growth)
• Year 8:    {year8_median:>10,.0f} views ({(year8_median/day1_median-1)*100:>6.1f}% growth)

🎯 Performance Thresholds (Day 30):
• Viral (>95th percentile):      >{p95[30]:>10,.0f} views
• Exceptional (>90th):           >{p90[30]:>10,.0f} views
• Above Average (>75th):         >{p75[30]:>10,.0f} views
• Average Range (25th-75th):     {p25[30]:>10,.0f} - {p75[30]:,.0f} views
• Below Average (<25th):         <{p25[30]:>10,.0f} views
"""

ax5.text(0.05, 0.5, stats_text, fontsize=11, 
         verticalalignment='center', fontfamily='monospace',
         bbox=dict(boxstyle="round,pad=0.5", facecolor="lightgray", alpha=0.3))

plt.suptitle('YouTube Video Performance Envelope - Comprehensive Analysis', fontsize=16, y=0.995)
plt.tight_layout()
plt.savefig('comprehensive_performance_envelope.png', dpi=300, bbox_inches='tight')
print("\n✅ Saved comprehensive visualization to: comprehensive_performance_envelope.png")

# Also create a focused first 90 days chart
fig2, ax = plt.subplots(1, 1, figsize=(12, 8))

# Plot raw data points more clearly
scatter_data = []
for day in sorted(views_by_day.keys()):
    if day <= 90:
        views = views_by_day[day]
        scatter_data.extend([(day, v) for v in views])

# Sample if too many points
if len(scatter_data) > 5000:
    import random
    scatter_data = random.sample(scatter_data, 5000)

if scatter_data:
    x_vals, y_vals = zip(*scatter_data)
    ax.scatter(x_vals, y_vals, alpha=0.3, s=30, color='gray', label='Raw data')

# Add smooth curve and envelope
ax.plot(days[:91], p50[:91], 'b-', linewidth=3, label='Median (smooth)')
ax.fill_between(days[:91], p25[:91], p75[:91], alpha=0.3, color='blue', label='25th-75th percentile')

ax.set_title('First 90 Days - Median Views with Raw Data', fontsize=16)
ax.set_xlabel('Days Since Published')
ax.set_ylabel('Views')
ax.legend()
ax.grid(True, alpha=0.3)
ax.set_xlim(-2, 92)
ax.set_ylim(bottom=0)

plt.tight_layout()
plt.savefig('first_90_days_detail.png', dpi=300, bbox_inches='tight')
print("   Saved 90-day detail to: first_90_days_detail.png")