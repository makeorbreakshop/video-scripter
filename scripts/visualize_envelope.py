#!/usr/bin/env python3
"""
Visualize Performance Envelope Chart
Shows the YouTube-style performance curves we just generated
"""

import os
import sys
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
    """Fetch the performance envelope curves from database"""
    print("📊 Fetching performance envelope data...")
    
    response = supabase.table('performance_envelopes').select('*').order('day_since_published').execute()
    
    if not response.data:
        print("❌ No performance envelope data found!")
        return None
    
    print(f"✅ Loaded {len(response.data)} data points")
    return response.data

def create_envelope_chart(data):
    """Create the YouTube-style performance envelope chart"""
    
    # Extract data
    days = [row['day_since_published'] for row in data]
    p10 = [row['p10_views'] for row in data]
    p25 = [row['p25_views'] for row in data]
    p50 = [row['p50_views'] for row in data]
    p75 = [row['p75_views'] for row in data]
    p90 = [row['p90_views'] for row in data]
    p95 = [row['p95_views'] for row in data]
    
    # Create the chart
    plt.figure(figsize=(14, 8))
    
    # Fill the envelope areas
    plt.fill_between(days, p25, p75, alpha=0.3, color='gray', label='Normal Range (25th-75th %ile)')
    plt.fill_between(days, p10, p25, alpha=0.15, color='lightblue', label='Below Normal (10th-25th %ile)')
    plt.fill_between(days, p75, p90, alpha=0.15, color='lightgreen', label='Above Normal (75th-90th %ile)')
    plt.fill_between(days, p90, p95, alpha=0.1, color='gold', label='Outperforming (90th-95th %ile)')
    
    # Plot the median line
    plt.plot(days, p50, color='black', linewidth=2, label='Median Performance', alpha=0.8)
    
    # Formatting
    plt.xlabel('Days Since Published', fontsize=12)
    plt.ylabel('View Count', fontsize=12)
    plt.title('YouTube Performance Envelope - Global Growth Curves\n(Based on 480K+ View Snapshots)', fontsize=14, pad=20)
    
    # Format y-axis to show K/M notation
    plt.gca().yaxis.set_major_formatter(plt.FuncFormatter(lambda x, p: f'{x/1000:.0f}K' if x < 1000000 else f'{x/1000000:.1f}M'))
    
    # Set reasonable axis limits
    plt.xlim(0, 365)
    plt.ylim(0, max(p95) * 1.1)
    
    # Add grid
    plt.grid(True, alpha=0.3)
    
    # Legend
    plt.legend(loc='upper left', framealpha=0.9)
    
    # Add key statistics as text
    day_0_median = p50[0] if p50 else 0
    day_365_median = p50[-1] if p50 else 0
    growth_multiple = day_365_median / day_0_median if day_0_median > 0 else 0
    
    stats_text = f"""Key Statistics:
Day 0 Median: {day_0_median:,} views
Day 365 Median: {day_365_median:,} views
Growth: {growth_multiple:.1f}x over 1 year
Total Data Points: {len(data)} days"""
    
    plt.text(0.02, 0.98, stats_text, transform=plt.gca().transAxes, 
             verticalalignment='top', bbox=dict(boxstyle='round', facecolor='white', alpha=0.8),
             fontsize=10)
    
    # Tight layout
    plt.tight_layout()
    
    return plt

def main():
    """Main function to generate and display the chart"""
    
    # Fetch data
    data = fetch_envelope_data()
    if not data:
        return
    
    # Create chart
    chart = create_envelope_chart(data)
    
    # Save the chart
    output_path = 'performance_envelope_chart.png'
    chart.savefig(output_path, dpi=300, bbox_inches='tight')
    print(f"💾 Chart saved to: {output_path}")
    
    # Show the chart
    print("📊 Displaying performance envelope chart...")
    chart.show()

if __name__ == "__main__":
    main()