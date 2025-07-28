#!/usr/bin/env python3
"""
Create properly normalized performance envelope
The envelope should represent reasonable variation, not extreme ranges
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

def create_normalized_envelope():
    """Create performance envelope with proper normalization"""
    
    # Get smooth envelope data
    print("📊 Creating normalized performance envelope...")
    envelope_response = supabase.table('performance_envelopes')\
        .select('*')\
        .lte('day_since_published', 90)\
        .order('day_since_published')\
        .execute()
    
    envelope_data = envelope_response.data
    
    # Extract arrays
    days = np.array([e['day_since_published'] for e in envelope_data])
    p25 = np.array([e['p25_views'] for e in envelope_data])
    p50 = np.array([e['p50_views'] for e in envelope_data])
    p75 = np.array([e['p75_views'] for e in envelope_data])
    
    # Channel baseline
    channel_baseline = 30000  # A mid-size channel
    global_day1 = p50[1] if len(p50) > 1 else 8478
    scale_factor = channel_baseline / global_day1
    
    # Scale just the median curve
    p50_scaled = p50 * scale_factor
    
    # Create normalized envelope around the scaled median
    # Use percentage-based bands instead of scaling raw percentiles
    # This gives us a reasonable ±30% variation band
    lower_band = p50_scaled * 0.7   # 30% below median
    upper_band = p50_scaled * 1.3   # 30% above median
    
    # Alternative: Use IQR-based normalization
    # Calculate the relative spread at each day
    iqr_ratios = (p75 - p25) / p50  # How wide is the IQR relative to median
    
    # Apply a dampening factor to reduce extreme spreads
    dampened_iqr = np.minimum(iqr_ratios, 0.6)  # Cap at 60% spread
    
    # Create tighter bands
    p25_normalized = p50_scaled * (1 - dampened_iqr/2)
    p75_normalized = p50_scaled * (1 + dampened_iqr/2)
    
    # Simulate an outperforming video
    video_days = [0, 1, 3, 7, 14, 30, 60, 90]
    video_views = [
        0,
        35000,   # Strong start
        68000,   # Picked up by algorithm
        125000,  # Viral moment
        180000,  # Continued growth
        240000,  # Stabilizing
        280000,  # Slower growth
        300000   # Mature phase
    ]
    
    # Calculate performance at day 90
    expected_at_90 = p50_scaled[90]
    actual_at_90 = video_views[-1]
    performance_ratio = actual_at_90 / expected_at_90
    
    # Create the chart
    fig, ax = plt.subplots(figsize=(14, 8))
    
    # Plot normalized envelope (much tighter range)
    ax.fill_between(days, p25_normalized, p75_normalized, 
                    alpha=0.3, color='gray', 
                    label='Expected Range (normalized ±30%)')
    
    # Add a lighter outer band for context
    ax.fill_between(days, lower_band, upper_band, 
                    alpha=0.1, color='lightgray', 
                    label='Wider context (±30%)')
    
    # Plot median line
    ax.plot(days, p50_scaled, '--', color='black', 
            linewidth=2, label='Expected Performance (channel-scaled)', alpha=0.8)
    
    # Plot video trajectory
    ax.plot(video_days, video_views, 'o-', color='#00C851', 
            linewidth=3, markersize=10, label='Actual Performance')
    
    # Add performance annotation
    ax.annotate(f'{performance_ratio:.1f}x expected', 
                xy=(90, 300000),
                xytext=(75, 320000),
                bbox=dict(boxstyle='round,pad=0.5', facecolor='#00C851', alpha=0.8),
                fontsize=14, color='white', weight='bold',
                arrowprops=dict(arrowstyle='->', color='#00C851', lw=2))
    
    # Add classification zones
    ax.axhline(y=p50_scaled[90] * 3, color='#FF1493', linestyle=':', alpha=0.5)
    ax.text(92, p50_scaled[90] * 3.1, 'Viral (>3x)', fontsize=9, color='#FF1493')
    
    ax.axhline(y=p50_scaled[90] * 1.5, color='#00C851', linestyle=':', alpha=0.5)
    ax.text(92, p50_scaled[90] * 1.55, 'Outperforming (>1.5x)', fontsize=9, color='#00C851')
    
    ax.axhline(y=p50_scaled[90] * 0.5, color='#FF8800', linestyle=':', alpha=0.5)
    ax.text(92, p50_scaled[90] * 0.45, 'Underperforming (<0.5x)', fontsize=9, color='#FF8800')
    
    # Labels and formatting
    ax.set_xlabel('Days Since Published', fontsize=12)
    ax.set_ylabel('View Count', fontsize=12)
    ax.set_title('YouTube Performance Envelope - Properly Normalized\nReasonable Expected Range for Channel-Specific Performance', 
                 fontsize=16, pad=20)
    
    # Format y-axis
    ax.yaxis.set_major_formatter(plt.FuncFormatter(
        lambda x, p: f'{x/1000:.0f}K' if x < 1000000 else f'{x/1000000:.1f}M'
    ))
    
    # Limits
    ax.set_xlim(0, 100)
    ax.set_ylim(0, 400000)
    
    # Grid
    ax.grid(True, alpha=0.3)
    ax.legend(loc='upper left', fontsize=11)
    
    # Add technical info
    info_text = f"""Normalization Applied:
• Channel baseline: {channel_baseline:,} views
• Expected range: ±30% of median
• IQR dampening: Max 60% spread
• Performance zones clearly defined

Video Performance:
• Day 90: {actual_at_90:,} views
• Expected: {expected_at_90:,.0f} views
• Ratio: {performance_ratio:.1f}x (Outperforming)"""
    
    ax.text(0.02, 0.98, info_text, transform=ax.transAxes,
            verticalalignment='top', 
            bbox=dict(boxstyle='round', facecolor='white', alpha=0.9, edgecolor='gray'),
            fontsize=10, family='monospace')
    
    plt.tight_layout()
    
    # Save
    output_path = 'normalized_performance_envelope.png'
    plt.savefig(output_path, dpi=300, bbox_inches='tight')
    print(f"💾 Chart saved to: {output_path}")
    
    plt.show()
    
    # Print analysis
    print("\n📊 Normalization Analysis:")
    print(f"Original P25-P75 spread at Day 90: {(p75[90]-p25[90])/p50[90]*100:.0f}% of median")
    print(f"Normalized spread: ±30% (much more reasonable)")
    print(f"Channel scaling: {scale_factor:.1f}x global median")
    print("\n✅ This provides a realistic expected performance range!")

if __name__ == "__main__":
    create_normalized_envelope()