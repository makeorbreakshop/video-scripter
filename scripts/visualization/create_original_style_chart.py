#!/usr/bin/env python3
"""
Create the original style 90-day chart with clear percentile bands
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

print("🎯 Creating Original Style 90-Day Chart")
print("=" * 60)

# Get curve data for first 90 days
print("\n📊 Fetching performance envelope data...")
curve_data = supabase.table('performance_envelopes')\
    .select('*')\
    .lte('day_since_published', 90)\
    .order('day_since_published')\
    .execute()

print(f"   Retrieved {len(curve_data.data)} days of curve data")

# Extract arrays
days = np.array([d['day_since_published'] for d in curve_data.data])
p10 = np.array([d['p10_views'] for d in curve_data.data])
p25 = np.array([d['p25_views'] for d in curve_data.data])
p50 = np.array([d['p50_views'] for d in curve_data.data])
p75 = np.array([d['p75_views'] for d in curve_data.data])
p90 = np.array([d['p90_views'] for d in curve_data.data])

# Create the chart in original style
fig, ax = plt.subplots(1, 1, figsize=(10, 6))

# Fill between percentiles with good opacity
ax.fill_between(days, p10, p90, alpha=0.2, color='blue', label='10th-90th percentile')
ax.fill_between(days, p25, p75, alpha=0.4, color='blue', label='25th-75th percentile')

# Bold median line
ax.plot(days, p50, 'b-', linewidth=3, label='Median (50th percentile)')

# Add some reference lines
ax.plot(days, p90, 'b--', linewidth=1, alpha=0.7, label='90th percentile')
ax.plot(days, p10, 'b--', linewidth=1, alpha=0.7, label='10th percentile')

# Formatting
ax.set_xlabel('Days Since Published', fontsize=12)
ax.set_ylabel('Views', fontsize=12)
ax.set_title('YouTube Video Performance - First 90 Days', fontsize=14, fontweight='bold')
ax.grid(True, alpha=0.3)
ax.legend(loc='upper left')

# Format y-axis with commas
ax.yaxis.set_major_formatter(plt.FuncFormatter(lambda x, p: f'{int(x):,}'))

# Set x-axis limits
ax.set_xlim(0, 90)
ax.set_ylim(bottom=0)

# Add annotations for key milestones
ax.annotate(f'Day 1: {p50[1]:,.0f} views', 
            xy=(1, p50[1]), xytext=(5, p50[1]*1.5),
            arrowprops=dict(arrowstyle='->', alpha=0.5),
            fontsize=9, alpha=0.8)

ax.annotate(f'Day 30: {p50[30]:,.0f} views', 
            xy=(30, p50[30]), xytext=(35, p50[30]*1.3),
            arrowprops=dict(arrowstyle='->', alpha=0.5),
            fontsize=9, alpha=0.8)

ax.annotate(f'Day 90: {p50[90]:,.0f} views', 
            xy=(90, p50[90]), xytext=(75, p50[90]*1.2),
            arrowprops=dict(arrowstyle='->', alpha=0.5),
            fontsize=9, alpha=0.8)

plt.tight_layout()
plt.savefig('original_style_90_day_chart.png', dpi=300, bbox_inches='tight')
print("\n✅ Saved to: original_style_90_day_chart.png")

# Create a second version with log scale
fig2, ax2 = plt.subplots(1, 1, figsize=(10, 6))

# Fill between percentiles
ax2.fill_between(days, p10, p90, alpha=0.2, color='blue', label='10th-90th percentile')
ax2.fill_between(days, p25, p75, alpha=0.4, color='blue', label='25th-75th percentile')

# Bold median line
ax2.plot(days, p50, 'b-', linewidth=3, label='Median')

# Reference lines
ax2.plot(days, p90, 'g--', linewidth=1.5, alpha=0.8, label='90th percentile (high performers)')
ax2.plot(days, p10, 'r--', linewidth=1.5, alpha=0.8, label='10th percentile (low performers)')

# Formatting
ax2.set_xlabel('Days Since Published', fontsize=12)
ax2.set_ylabel('Views (log scale)', fontsize=12)
ax2.set_title('YouTube Video Performance - First 90 Days (Log Scale)', fontsize=14, fontweight='bold')
ax2.grid(True, alpha=0.3, which='both')
ax2.legend(loc='lower right')
ax2.set_yscale('log')
ax2.set_xlim(0, 90)
ax2.set_ylim(bottom=100)

plt.tight_layout()
plt.savefig('original_style_90_day_log_chart.png', dpi=300, bbox_inches='tight')
print("   Saved log scale version to: original_style_90_day_log_chart.png")