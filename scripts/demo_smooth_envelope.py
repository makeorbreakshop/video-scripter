#!/usr/bin/env python3
"""
Demo: Smooth Performance Envelope with Proper Channel Scaling
Shows how the system SHOULD work with curve fitting
"""

import os
import matplotlib.pyplot as plt
import numpy as np
from scipy.interpolate import interp1d
from supabase import create_client, Client
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Initialize Supabase client
url = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
supabase: Client = create_client(url, key)

def create_smooth_curve(days, values):
    """Create smooth cumulative curve from percentile data"""
    # Ensure it starts at 0 views on day 0
    if days[0] != 0:
        days = np.concatenate([[0], days])
        values = np.concatenate([[0], values])
    
    # Use cubic interpolation for smooth curve
    # For days 0-30: Use cubic spline (captures early growth)
    # For days 31+: Use linear (more stable for sparse data)
    
    early_days = days[days <= 30]
    early_values = values[:len(early_days)]
    
    if len(early_days) > 3:
        f_early = interp1d(early_days, early_values, kind='cubic', fill_value='extrapolate')
    else:
        f_early = interp1d(early_days, early_values, kind='linear', fill_value='extrapolate')
    
    # Create smooth daily points
    smooth_days = np.arange(0, max(days) + 1)
    smooth_values = np.zeros_like(smooth_days, dtype=float)
    
    # Fill in the smooth curve
    for i, day in enumerate(smooth_days):
        if day <= 30 and len(early_days) > 1:
            smooth_values[i] = max(0, f_early(day))
        else:
            # Linear interpolation for later days
            idx = np.searchsorted(days, day)
            if idx == 0:
                smooth_values[i] = values[0]
            elif idx >= len(days):
                # Extrapolate using last two points
                if len(days) > 1:
                    slope = (values[-1] - values[-2]) / (days[-1] - days[-2])
                    smooth_values[i] = values[-1] + slope * (day - days[-1])
                else:
                    smooth_values[i] = values[-1]
            else:
                # Interpolate between points
                t = (day - days[idx-1]) / (days[idx] - days[idx-1])
                smooth_values[i] = values[idx-1] + t * (values[idx] - values[idx-1])
    
    # Ensure monotonic (always increasing)
    for i in range(1, len(smooth_values)):
        smooth_values[i] = max(smooth_values[i], smooth_values[i-1])
    
    return smooth_days, smooth_values

def demo_smooth_envelope():
    """Demo showing smooth envelope curves"""
    
    # Get envelope data
    envelope_response = supabase.table('performance_envelopes').select('*').order('day_since_published').execute()
    envelope_data = envelope_response.data
    
    # Extract arrays
    days = np.array([e['day_since_published'] for e in envelope_data])
    p25_raw = np.array([e['p25_views'] for e in envelope_data])
    p50_raw = np.array([e['p50_views'] for e in envelope_data])
    p75_raw = np.array([e['p75_views'] for e in envelope_data])
    
    # Create smooth curves
    smooth_days, p25_smooth = create_smooth_curve(days, p25_raw)
    _, p50_smooth = create_smooth_curve(days, p50_raw)
    _, p75_smooth = create_smooth_curve(days, p75_raw)
    
    # Demo: Scale to a hypothetical channel with 50K baseline
    channel_baseline = 50000  # A channel that typically gets 50K views in first week
    day1_global = p50_raw[1] if len(p50_raw) > 1 else 8478
    scaling_factor = channel_baseline / day1_global
    
    # Scale the curves
    p25_scaled = p25_smooth * scaling_factor
    p50_scaled = p50_smooth * scaling_factor
    p75_scaled = p75_smooth * scaling_factor
    
    # Create hypothetical video trajectory
    # Simulating a video that starts slow then picks up
    video_days = [0, 1, 3, 7, 14, 30, 60, 90, 120]
    video_views = [0, 35000, 48000, 72000, 95000, 135000, 180000, 210000, 235000]
    
    # Create the chart
    plt.figure(figsize=(14, 8))
    
    # Plot smooth envelope
    plt.fill_between(smooth_days[:121], p25_scaled[:121], p75_scaled[:121], 
                     alpha=0.3, color='gray', label='Expected Range (25th-75th %ile)')
    
    # Plot median line
    plt.plot(smooth_days[:121], p50_scaled[:121], '--', color='black', 
             linewidth=2, label='Expected Performance', alpha=0.7)
    
    # Plot video trajectory
    plt.plot(video_days, video_views, 'o-', color='green', linewidth=2, 
             markersize=8, label='Video Performance')
    
    # Calculate performance at day 120
    expected_at_120 = p50_scaled[120]
    actual_at_120 = video_views[-1]
    performance_ratio = actual_at_120 / expected_at_120
    
    # Add performance annotation
    plt.annotate(f'{performance_ratio:.2f}x', 
                 xy=(video_days[-1], video_views[-1]),
                 xytext=(10, 10), textcoords='offset points',
                 bbox=dict(boxstyle='round,pad=0.3', facecolor='green', alpha=0.7),
                 fontsize=10, color='white', weight='bold')
    
    # Labels
    plt.xlabel('Days Since Published', fontsize=12)
    plt.ylabel('View Count', fontsize=12)
    plt.title('Smooth Performance Envelope (Channel-Scaled)\nExample: 50K Baseline Channel', 
              fontsize=14, pad=20)
    
    # Format y-axis
    plt.gca().yaxis.set_major_formatter(plt.FuncFormatter(lambda x, p: f'{x/1000:.0f}K' if x < 1000000 else f'{x/1000000:.1f}M'))
    
    # Limits
    plt.xlim(0, 130)
    plt.ylim(0, 300000)
    
    # Grid and legend
    plt.grid(True, alpha=0.3)
    plt.legend(loc='upper left')
    
    # Stats box
    stats_text = f"""Channel Performance:
Channel Baseline: 50K views
Video at 120 days: 235K views
Expected: {expected_at_120/1000:.0f}K views
Performance: {performance_ratio:.2f}x (Outperforming)"""
    
    plt.text(0.02, 0.98, stats_text, transform=plt.gca().transAxes,
             verticalalignment='top', bbox=dict(boxstyle='round', facecolor='white', alpha=0.9),
             fontsize=10)
    
    plt.tight_layout()
    
    # Save
    output_path = 'smooth_performance_envelope_demo.png'
    plt.savefig(output_path, dpi=300, bbox_inches='tight')
    print(f"💾 Chart saved to: {output_path}")
    
    plt.show()
    
    # Show the difference
    print("\n📊 Comparison:")
    print(f"Raw data points: {len(days)}")
    print(f"Smooth curve points: {len(smooth_days)}")
    print(f"\nDay 1 values:")
    print(f"  Global median: {day1_global:,} views")
    print(f"  Channel baseline: {channel_baseline:,} views")
    print(f"  Scaling factor: {scaling_factor:.1f}x")

if __name__ == "__main__":
    demo_smooth_envelope()