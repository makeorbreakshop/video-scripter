#!/usr/bin/env python3
"""
Visualize performance curves limited to 8 years where we have stable data
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

print("🎯 Visualizing 8-Year Performance Curves (stable data range)")
print("=" * 60)

# Get curve data up to 8 years (need to fetch all at once)
print("\n📊 Fetching curve data up to 8 years...")
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

curve_data = type('obj', (object,), {'data': all_curve_data})

print(f"   Retrieved {len(curve_data.data)} days of curve data")

# Extract arrays
days = np.array([d['day_since_published'] for d in curve_data.data])
p10 = np.array([d['p10_views'] for d in curve_data.data])
p25 = np.array([d['p25_views'] for d in curve_data.data])
p50 = np.array([d['p50_views'] for d in curve_data.data])
p75 = np.array([d['p75_views'] for d in curve_data.data])
p90 = np.array([d['p90_views'] for d in curve_data.data])
p95 = np.array([d['p95_views'] for d in curve_data.data])
sample_counts = np.array([d['sample_count'] for d in curve_data.data])

# Create clean visualization
fig = plt.figure(figsize=(16, 10))

# Main plot: 8-year envelope
ax = fig.add_subplot(111)
ax.fill_between(days, p10, p90, alpha=0.2, color='blue', label='10th-90th percentile')
ax.fill_between(days, p25, p75, alpha=0.3, color='blue', label='25th-75th percentile')
ax.plot(days, p50, 'b-', linewidth=2, label='Median')
ax.plot(days, p95, 'r--', linewidth=1.5, alpha=0.7, label='95th percentile (viral threshold)')

# Add year markers
for year in range(1, 9):
    ax.axvline(x=year*365, color='gray', linestyle=':', alpha=0.5)
    ax.text(year*365, 10**7.5, f'Year {year}', ha='center', fontsize=9, alpha=0.7)

ax.set_title('YouTube Performance Envelope - 8 Year View', fontsize=16)
ax.set_xlabel('Days Since Published')
ax.set_ylabel('Views (log scale)')
ax.legend(loc='lower right')
ax.grid(True, alpha=0.3)
ax.set_yscale('log')
ax.set_xlim(0, 2920)
ax.set_ylim(10**3, 10**8)

# Add statistics box
stats_text = f"""Key Milestones (Median):
Day 1: {p50[1]:,.0f} views
Month 1: {p50[30]:,.0f} views
Year 1: {p50[365]:,.0f} views
Year 5: {p50[1825]:,.0f} views
Year 8: {p50[2920]:,.0f} views

8-year growth: {(p50[2920]/p50[1]):.1f}x"""

ax.text(0.02, 0.98, stats_text, transform=ax.transAxes, 
        fontsize=10, verticalalignment='top',
        bbox=dict(boxstyle="round,pad=0.5", facecolor="white", alpha=0.8))

plt.tight_layout()
plt.savefig('clean_8_year_performance_envelope.png', dpi=300, bbox_inches='tight')
print("\n✅ Saved clean visualization to: clean_8_year_performance_envelope.png")

# Create a second figure showing data coverage
fig2, (ax1, ax2) = plt.subplots(1, 2, figsize=(14, 5))

# Yearly data coverage (fixed binning)
yearly_samples = []
year_labels = []
for year in range(8):
    start_day = year * 365
    end_day = min((year + 1) * 365, 2920)
    year_total = np.sum(sample_counts[start_day:end_day])
    yearly_samples.append(year_total)
    year_labels.append(f'Y{year+1}')

ax1.bar(range(8), yearly_samples, alpha=0.7, color='orange')
ax1.set_title('Data Coverage by Year', fontsize=14)
ax1.set_xlabel('Year')
ax1.set_ylabel('Total Sample Count')
ax1.set_xticks(range(8))
ax1.set_xticklabels(year_labels)
ax1.grid(True, alpha=0.3, axis='y')

# Sample size over time (smoothed)
window = 30  # 30-day rolling average
rolling_samples = np.convolve(sample_counts, np.ones(window)/window, mode='same')
ax2.plot(days, rolling_samples, color='green', alpha=0.8)
ax2.fill_between(days, 0, rolling_samples, alpha=0.3, color='green')
ax2.set_title('Sample Size Over Time (30-day average)', fontsize=14)
ax2.set_xlabel('Days Since Published')
ax2.set_ylabel('Average Sample Count')
ax2.grid(True, alpha=0.3)
ax2.set_xlim(0, 2920)

plt.tight_layout()
plt.savefig('data_coverage_8_years.png', dpi=300, bbox_inches='tight')
print("   Saved data coverage to: data_coverage_8_years.png")