#!/usr/bin/env python3
"""
Simple demo showing smooth curves vs raw data
"""

import matplotlib.pyplot as plt
import numpy as np

# Sample data from our performance_envelopes table
sample_days = [0, 1, 7, 30, 90, 180, 365]
sample_p50 = [3520, 8478, 15903, 29022, 26507, 39232, 59542]

# Create smooth curve by interpolation
all_days = np.arange(0, 366)
smooth_p50 = np.interp(all_days, sample_days, sample_p50)

# Ensure monotonic increase (views can only go up)
for i in range(1, len(smooth_p50)):
    smooth_p50[i] = max(smooth_p50[i], smooth_p50[i-1])

# Channel scaling example
channel_baseline = 25000  # This channel typically gets 25K views in week 1
global_day1 = 8478  # Global median at day 1
scale_factor = channel_baseline / global_day1

# Scale the curve to this channel
channel_curve = smooth_p50 * scale_factor

# Create example video performance
video_days = [0, 1, 7, 14, 30, 60, 90]
video_views = [0, 18000, 42000, 58000, 85000, 110000, 125000]

# Plot
fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(16, 6))

# Left: Raw vs Smooth
ax1.scatter(sample_days, sample_p50, color='red', s=100, label='Raw Percentile Data', zorder=5)
ax1.plot(all_days[:91], smooth_p50[:91], 'b-', linewidth=2, label='Smooth Curve')
ax1.set_xlabel('Days Since Published')
ax1.set_ylabel('Views')
ax1.set_title('Raw Data Points vs Smooth Curve')
ax1.legend()
ax1.grid(True, alpha=0.3)
ax1.set_xlim(0, 90)

# Right: Channel-Scaled Performance
ax2.fill_between(all_days[:91], channel_curve[:91] * 0.5, channel_curve[:91] * 1.5, 
                 alpha=0.3, color='gray', label='Expected Range (±50%)')
ax2.plot(all_days[:91], channel_curve[:91], '--', color='black', 
         linewidth=2, label='Expected for this Channel')
ax2.plot(video_days, video_views, 'o-', color='green', linewidth=2, 
         markersize=8, label='Actual Video Performance')

# Calculate performance
expected_day90 = channel_curve[90]
actual_day90 = video_views[-1]
ratio = actual_day90 / expected_day90

ax2.annotate(f'{ratio:.2f}x expected', 
             xy=(90, 125000), xytext=(70, 140000),
             arrowprops=dict(arrowstyle='->', color='green'),
             fontsize=12, color='green', weight='bold')

ax2.set_xlabel('Days Since Published')
ax2.set_ylabel('Views')
ax2.set_title(f'Channel-Scaled Performance (Baseline: {channel_baseline:,} views)')
ax2.legend()
ax2.grid(True, alpha=0.3)
ax2.set_xlim(0, 90)
ax2.set_ylim(0, 150000)

# Format y-axis
for ax in [ax1, ax2]:
    ax.yaxis.set_major_formatter(plt.FuncFormatter(lambda x, p: f'{x/1000:.0f}K'))

plt.tight_layout()
plt.savefig('smooth_envelope_comparison.png', dpi=300, bbox_inches='tight')
print("💾 Chart saved to: smooth_envelope_comparison.png")
plt.show()

print("\n📊 Key Points:")
print("1. Raw data is spiky - we need smooth curves")
print("2. Curves must be monotonic (always increasing)")
print("3. Scale global curve to channel baseline")
print(f"4. Example: Channel baseline {channel_baseline:,} vs global {global_day1:,} = {scale_factor:.1f}x scaling")
print(f"5. Video performing at {ratio:.2f}x expected for this channel")