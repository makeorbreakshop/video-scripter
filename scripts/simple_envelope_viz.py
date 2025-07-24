#!/usr/bin/env python3
"""
Simple Performance Envelope Visualization
Shows the proper YouTube-style envelope curves
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

def fetch_envelope_data():
    """Fetch the performance envelope curves"""
    response = supabase.table('performance_envelopes').select('*').order('day_since_published').execute()
    return response.data

def create_envelope_chart(envelope_data):
    """Create proper YouTube-style performance envelope chart"""
    
    # Extract data
    days = np.array([row['day_since_published'] for row in envelope_data])
    p10 = np.array([row['p10_views'] for row in envelope_data])
    p25 = np.array([row['p25_views'] for row in envelope_data])
    p50 = np.array([row['p50_views'] for row in envelope_data])
    p75 = np.array([row['p75_views'] for row in envelope_data])
    p90 = np.array([row['p90_views'] for row in envelope_data])
    p95 = np.array([row['p95_views'] for row in envelope_data])
    
    # Create the chart
    plt.figure(figsize=(14, 8))
    
    # Plot envelope bands (these represent expected view ranges by age)
    plt.fill_between(days, p25, p75, alpha=0.3, color='gray', label='Normal Range (25th-75th percentile)')
    plt.fill_between(days, p10, p25, alpha=0.2, color='lightcoral', label='Below Normal (10th-25th percentile)')
    plt.fill_between(days, p75, p90, alpha=0.2, color='lightgreen', label='Above Normal (75th-90th percentile)')
    plt.fill_between(days, p90, p95, alpha=0.15, color='gold', label='Outperforming (90th-95th percentile)')
    
    # Plot percentile lines
    plt.plot(days, p50, 'k-', linewidth=2, label='Median (50th percentile)', alpha=0.8)
    plt.plot(days, p25, '--', color='gray', linewidth=1, alpha=0.6, label='25th percentile')
    plt.plot(days, p75, '--', color='gray', linewidth=1, alpha=0.6, label='75th percentile')
    
    # Formatting
    plt.xlabel('Days Since Published', fontsize=12)
    plt.ylabel('Expected View Count', fontsize=12)
    plt.title('YouTube Performance Envelope - Expected View Growth Over Time\n(Based on 480K+ View Snapshots from Real Videos)', fontsize=14, pad=20)
    
    # Format y-axis to show K/M notation
    plt.gca().yaxis.set_major_formatter(plt.FuncFormatter(lambda x, p: f'{x/1000:.0f}K' if x < 1000000 else f'{x/1000000:.1f}M'))
    
    # Set reasonable axis limits
    plt.xlim(0, 365)
    plt.ylim(0, max(p95) * 1.1)
    
    # Add grid
    plt.grid(True, alpha=0.3)
    
    # Legend
    plt.legend(loc='upper left', framealpha=0.9)
    
    # Add key statistics
    day_0_median = p50[0] if len(p50) > 0 else 0
    day_1_median = p50[1] if len(p50) > 1 else 0
    day_7_median = p50[7] if len(p50) > 7 else 0
    day_30_median = p50[30] if len(p50) > 30 else 0
    day_365_median = p50[-1] if len(p50) > 0 else 0
    
    stats_text = f"""Expected Performance Benchmarks:
Day 0: {day_0_median:,.0f} views (median)
Day 1: {day_1_median:,.0f} views ({day_1_median/day_0_median:.1f}x)
Day 7: {day_7_median:,.0f} views ({day_7_median/day_0_median:.1f}x)
Day 30: {day_30_median:,.0f} views ({day_30_median/day_0_median:.1f}x)
Day 365: {day_365_median:,.0f} views ({day_365_median/day_0_median:.1f}x)

Usage: Compare actual video views to these
expected ranges to identify over/under performance."""
    
    plt.text(0.65, 0.98, stats_text, transform=plt.gca().transAxes,
             verticalalignment='top', bbox=dict(boxstyle='round', facecolor='white', alpha=0.9),
             fontsize=9)
    
    # Add example performance classifications
    plt.axhline(y=day_30_median * 3, color='red', linestyle=':', alpha=0.7, linewidth=1)
    plt.text(200, day_30_median * 3.1, 'Viral (3x expected)', fontsize=8, color='red')
    
    plt.axhline(y=day_30_median * 1.5, color='orange', linestyle=':', alpha=0.7, linewidth=1)
    plt.text(200, day_30_median * 1.6, 'Outperforming (1.5x expected)', fontsize=8, color='orange')
    
    plt.tight_layout()
    return plt

def main():
    """Generate proper envelope visualization"""
    
    print("📊 Fetching performance envelope data...")
    envelope_data = fetch_envelope_data()
    
    if not envelope_data:
        print("❌ No envelope data found!")
        return
    
    print(f"✅ Loaded {len(envelope_data)} envelope data points")
    
    # Create chart
    chart = create_envelope_chart(envelope_data)
    
    # Save
    output_path = 'youtube_performance_envelope.png'
    chart.savefig(output_path, dpi=300, bbox_inches='tight')
    print(f"💾 Chart saved to: {output_path}")
    
    # Show
    print("📊 Displaying YouTube performance envelope...")
    chart.show()

if __name__ == "__main__":
    main()