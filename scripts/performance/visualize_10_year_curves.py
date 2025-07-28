#!/usr/bin/env python3
"""
Visualize the complete 10-year performance curves
"""

import os
import matplotlib.pyplot as plt
import numpy as np
from supabase import create_client, Client
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Initialize Supabase client
url = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
supabase: Client = create_client(url, key)

print("🎯 Visualizing 10-Year Performance Curves")
print("=" * 60)

# Get all curve data
print("\n📊 Fetching complete 10-year curve data...")
curve_data = []
offset = 0
batch_size = 1000

while True:
    result = supabase.table('performance_envelopes')\
        .select('*')\
        .order('day_since_published')\
        .range(offset, offset + batch_size - 1)\
        .execute()
    
    if not result.data:
        break
    
    curve_data.extend(result.data)
    offset += batch_size
    
    if len(result.data) < batch_size:
        break

print(f"   Retrieved {len(curve_data)} days of curve data")

# Extract arrays
days = np.array([d['day_since_published'] for d in curve_data])
p10 = np.array([d['p10_views'] for d in curve_data])
p25 = np.array([d['p25_views'] for d in curve_data])
p50 = np.array([d['p50_views'] for d in curve_data])
p75 = np.array([d['p75_views'] for d in curve_data])
p90 = np.array([d['p90_views'] for d in curve_data])
p95 = np.array([d['p95_views'] for d in curve_data])
sample_counts = np.array([d['sample_count'] for d in curve_data])

# Create comprehensive visualization
fig = plt.figure(figsize=(20, 14))
gs = fig.add_gridspec(3, 2, height_ratios=[2, 2, 1], hspace=0.3, wspace=0.3)

# Plot 1: First 90 days (critical growth period)
ax1 = fig.add_subplot(gs[0, 0])
ax1.fill_between(days[:91], p25[:91], p75[:91], alpha=0.3, color='blue', label='25th-75th percentile')
ax1.plot(days[:91], p50[:91], 'b-', linewidth=2, label='Median')
ax1.plot(days[:91], p90[:91], 'g--', linewidth=1, alpha=0.7, label='90th percentile')
ax1.plot(days[:91], p95[:91], 'r--', linewidth=1, alpha=0.7, label='95th percentile')
ax1.set_title('First 90 Days - Critical Growth Period', fontsize=14)
ax1.set_xlabel('Days Since Published')
ax1.set_ylabel('Views')
ax1.legend()
ax1.grid(True, alpha=0.3)

# Plot 2: Full 10 years (log scale)
ax2 = fig.add_subplot(gs[0, 1])
ax2.fill_between(days, p10, p90, alpha=0.2, color='blue', label='10th-90th percentile')
ax2.fill_between(days, p25, p75, alpha=0.3, color='blue', label='25th-75th percentile')
ax2.plot(days, p50, 'b-', linewidth=2, label='Median')
ax2.plot(days, p95, 'r--', linewidth=1, alpha=0.7, label='95th percentile (viral threshold)')

# Add year markers
for year in range(1, 11):
    ax2.axvline(x=year*365, color='gray', linestyle=':', alpha=0.5)
    ax2.text(year*365, ax2.get_ylim()[1]*0.7, f'Y{year}', ha='center', fontsize=8, alpha=0.7)

ax2.set_title('Complete 10-Year Performance Envelope', fontsize=14)
ax2.set_xlabel('Days Since Published')
ax2.set_ylabel('Views (log scale)')
ax2.legend()
ax2.grid(True, alpha=0.3)
ax2.set_yscale('log')
ax2.set_xlim(0, 3650)

# Plot 3: Year-over-year growth comparison
ax3 = fig.add_subplot(gs[1, 0])
yearly_medians = []
yearly_90th = []
for year in range(11):
    day_idx = min(year * 365, 3650)
    if day_idx < len(p50):
        yearly_medians.append(p50[day_idx])
        yearly_90th.append(p90[day_idx])

ax3.bar(range(11), yearly_medians, alpha=0.7, color='blue', label='Median')
ax3.bar(range(11), yearly_90th, alpha=0.5, color='green', label='90th percentile')
ax3.set_title('Year-End View Counts', fontsize=14)
ax3.set_xlabel('Years Since Published')
ax3.set_ylabel('Views')
ax3.set_xticks(range(11))
ax3.legend()
ax3.grid(True, alpha=0.3, axis='y')

# Plot 4: Sample size distribution
ax4 = fig.add_subplot(gs[1, 1])
# Bin sample counts by year
yearly_samples = []
for year in range(10):
    start_idx = year * 365
    end_idx = min((year + 1) * 365, 3650)
    yearly_samples.append(np.sum(sample_counts[start_idx:end_idx]))

ax4.bar(range(10), yearly_samples, alpha=0.7, color='orange')
ax4.set_title('Data Coverage by Year', fontsize=14)
ax4.set_xlabel('Year')
ax4.set_ylabel('Total Sample Count')
ax4.grid(True, alpha=0.3, axis='y')

# Plot 5: Detailed statistics
ax5 = fig.add_subplot(gs[2, :])
ax5.axis('off')

# Calculate key metrics
day1_median = p50[1] if len(p50) > 1 else 0
day7_median = p50[7] if len(p50) > 7 else 0
day30_median = p50[30] if len(p50) > 30 else 0
day90_median = p50[90] if len(p50) > 90 else 0
year1_median = p50[365] if len(p50) > 365 else 0
year5_median = p50[1825] if len(p50) > 1825 else 0
year10_median = p50[3650] if len(p50) >= 3650 else 0

stats_text = f"""
10-YEAR PERFORMANCE ENVELOPE - COMPLETE STATISTICS

📊 Data Coverage:
• Total days with data: {len(curve_data):,} (0-{max(days)} days)
• Total sample points: {np.sum(sample_counts):,}
• Coverage: Complete 10-year period

📈 Median (P50) Growth Milestones:
• Day 1:     {day1_median:>10,.0f} views
• Week 1:    {day7_median:>10,.0f} views ({(day7_median/day1_median-1)*100:>6.1f}% growth)
• Month 1:   {day30_median:>10,.0f} views ({(day30_median/day1_median-1)*100:>6.1f}% growth)
• Month 3:   {day90_median:>10,.0f} views ({(day90_median/day1_median-1)*100:>6.1f}% growth)
• Year 1:    {year1_median:>10,.0f} views ({(year1_median/day1_median-1)*100:>6.1f}% growth)
• Year 5:    {year5_median:>10,.0f} views ({(year5_median/day1_median-1)*100:>6.1f}% growth)
• Year 10:   {year10_median:>10,.0f} views ({(year10_median/day1_median-1)*100:>6.1f}% growth)

🎯 Performance Thresholds (Day 30):
• Viral (>95th percentile):      >{p95[30]:>10,.0f} views
• Exceptional (>90th):           >{p90[30]:>10,.0f} views
• Above Average (>75th):         >{p75[30]:>10,.0f} views
• Average Range (25th-75th):     {p25[30]:>10,.0f} - {p75[30]:,.0f} views
• Below Average (<25th):         <{p25[30]:>10,.0f} views

💡 Key Insights:
• Most explosive growth occurs in the first 90 days
• Videos continue accumulating views throughout the entire 10-year period
• Year-over-year growth rate decreases but remains positive
• Long-tail content accumulates {(year10_median-year1_median):,.0f} additional views after year 1
"""

ax5.text(0.05, 0.5, stats_text, fontsize=11, 
         verticalalignment='center', fontfamily='monospace',
         bbox=dict(boxstyle="round,pad=0.5", facecolor="lightgray", alpha=0.3))

plt.suptitle('YouTube Video Performance Over 10 Years - Complete Analysis', fontsize=16, y=0.995)
plt.tight_layout()
plt.savefig('complete_10_year_performance_envelope.png', dpi=300, bbox_inches='tight')
print("\n✅ Saved visualization to: complete_10_year_performance_envelope.png")

# Print summary
print("\n📊 10-Year Performance Summary:")
print(f"   • Median views after 1 day:   {day1_median:>10,.0f}")
print(f"   • Median views after 1 year:  {year1_median:>10,.0f}")
print(f"   • Median views after 10 years: {year10_median:>10,.0f}")
print(f"   • Total 10-year growth:        {(year10_median/day1_median):>10,.1f}x")