#!/usr/bin/env python3
"""
Create 5-year performance envelope chart with median line and percentile bands
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

print("🎯 Creating 5-Year Performance Envelope")
print("=" * 60)

# Get performance envelope data for 5 years
print("\n📊 Fetching performance envelope data for 5 years...")
envelope_data = supabase.table('performance_envelopes')\
    .select('*')\
    .lte('day_since_published', 1825)\
    .order('day_since_published')\
    .execute()

print(f"   Retrieved {len(envelope_data.data)} days of data")

# Extract data
days = np.array([d['day_since_published'] for d in envelope_data.data])
p10 = np.array([d['p10_views'] for d in envelope_data.data])
p25 = np.array([d['p25_views'] for d in envelope_data.data])
p50 = np.array([d['p50_views'] for d in envelope_data.data])  # Median
p75 = np.array([d['p75_views'] for d in envelope_data.data])
p90 = np.array([d['p90_views'] for d in envelope_data.data])
p95 = np.array([d['p95_views'] for d in envelope_data.data])

# Create the chart
fig, ax = plt.subplots(1, 1, figsize=(14, 8))

# Fill the percentile bands
# 10th-90th percentile (lightest gray)
ax.fill_between(days, p10, p90, alpha=0.2, color='gray', label='10th-90th percentile')

# 25th-75th percentile (medium gray)
ax.fill_between(days, p25, p75, alpha=0.4, color='gray', label='25th-75th percentile')

# Plot the median line
ax.plot(days, p50, 'b-', linewidth=3, label='Median (50th percentile)')

# Add year markers
for year in range(1, 6):
    ax.axvline(x=year*365, color='red', linestyle='--', alpha=0.3)
    ax.text(year*365, ax.get_ylim()[1]*0.95, f'Year {year}', 
            ha='center', fontsize=10, alpha=0.7,
            bbox=dict(boxstyle="round,pad=0.3", facecolor='white', alpha=0.7))

# Formatting
ax.set_xlabel('Days Since Published', fontsize=12)
ax.set_ylabel('Views', fontsize=12)
ax.set_title('YouTube Video Performance Envelope - First 5 Years', fontsize=16, fontweight='bold')
ax.legend(fontsize=11, loc='upper left')
ax.grid(True, alpha=0.3)

# Format y-axis with commas
ax.yaxis.set_major_formatter(plt.FuncFormatter(lambda x, p: f'{int(x):,}'))

# Set limits
ax.set_xlim(0, 1825)
ax.set_ylim(0, max(p90) * 1.1)

# Add key milestones
milestones = [
    (1, p50[1] if len(p50) > 1 else 0, "Day 1"),
    (30, p50[30] if len(p50) > 30 else 0, "Month 1"),
    (365, p50[365] if len(p50) > 365 else 0, "Year 1"),
    (1095, p50[1095] if len(p50) > 1095 else 0, "Year 3"),
    (1825, p50[1825] if len(p50) > 1825 else 0, "Year 5")
]

for day, views, label in milestones:
    if views > 0 and day < len(p50):
        ax.annotate(f'{label}: {views:,.0f}', 
                    xy=(day, views),
                    xytext=(day+50, views*1.3),
                    arrowprops=dict(arrowstyle='->', alpha=0.5),
                    fontsize=9, alpha=0.8)

plt.tight_layout()
plt.savefig('performance_envelope_5_years.png', dpi=300, bbox_inches='tight')
print("\n✅ Saved to: performance_envelope_5_years.png")

# Create a cleaner version with just 25-75 band
fig2, ax2 = plt.subplots(1, 1, figsize=(14, 8))

# Fill only the 25th-75th percentile band
ax2.fill_between(days, p25, p75, alpha=0.3, color='gray', label='Normal range (25th-75th percentile)')

# Plot the median line
ax2.plot(days, p50, 'b-', linewidth=3, label='Median performance')

# Plot 10th and 90th percentiles as dotted lines
ax2.plot(days, p10, 'k:', linewidth=1, alpha=0.5, label='10th percentile')
ax2.plot(days, p90, 'k:', linewidth=1, alpha=0.5, label='90th percentile')

# Year markers
for year in range(1, 6):
    ax2.axvline(x=year*365, color='gray', linestyle=':', alpha=0.5)

ax2.set_xlabel('Days Since Published')
ax2.set_ylabel('Views')
ax2.set_title('Median Views with Performance Range - First 5 Years')
ax2.grid(True, alpha=0.3)
ax2.legend()
ax2.yaxis.set_major_formatter(plt.FuncFormatter(lambda x, p: f'{int(x):,}'))
ax2.set_xlim(0, 1825)
ax2.set_ylim(0, max(p90) * 1.1)

plt.tight_layout()
plt.savefig('median_envelope_5_years.png', dpi=300, bbox_inches='tight')
print("   Saved clean version to: median_envelope_5_years.png")

# Print summary statistics
print(f"\n📊 5-Year Performance Summary:")
print(f"   Day 1 Median:    {p50[1]:>10,.0f} views")
print(f"   Month 1 Median:  {p50[30]:>10,.0f} views ({p50[30]/p50[1]:.1f}x)")
print(f"   Year 1 Median:   {p50[365]:>10,.0f} views ({p50[365]/p50[1]:.1f}x)")
if len(p50) > 1095:
    print(f"   Year 3 Median:   {p50[1095]:>10,.0f} views ({p50[1095]/p50[1]:.1f}x)")
if len(p50) > 1825:
    print(f"   Year 5 Median:   {p50[1825]:>10,.0f} views ({p50[1825]/p50[1]:.1f}x)")
    print(f"\n   5-Year Growth:   {p50[1825]/p50[1]:.1f}x")

print(f"\n   Normal Range (25th-75th percentile):")
print(f"   Day 1:    {p25[1]:>10,.0f} - {p75[1]:>10,.0f} views")
print(f"   Year 1:   {p25[365]:>10,.0f} - {p75[365]:>10,.0f} views")
if len(p25) > 1825:
    print(f"   Year 5:   {p25[1825]:>10,.0f} - {p75[1825]:>10,.0f} views")