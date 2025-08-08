#!/usr/bin/env python3
"""
Visualize global performance envelope curves to check for spikes
"""

import os
import matplotlib.pyplot as plt
import numpy as np
from supabase import create_client, Client
from dotenv import load_dotenv
import pandas as pd

# Load environment variables
load_dotenv()

# Initialize Supabase client
url = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
supabase: Client = create_client(url, key)

def fetch_and_visualize():
    """Fetch performance envelope data and create visualizations"""
    
    print("📊 Fetching global performance envelope data...")
    
    # Fetch envelope data
    envelope_data = []
    offset = 0
    batch_size = 1000
    
    while True:
        batch = supabase.table('performance_envelopes')\
            .select('day_since_published, p10_views, p25_views, p50_views, p75_views, p90_views, sample_count')\
            .gte('day_since_published', 0)\
            .lte('day_since_published', 365)\
            .order('day_since_published')\
            .range(offset, offset + batch_size - 1)\
            .execute()
        
        if not batch.data:
            break
            
        envelope_data.extend(batch.data)
        
        if len(batch.data) < batch_size:
            break
        offset += batch_size
    
    print(f"✅ Fetched {len(envelope_data)} days of envelope data")
    
    # Convert to DataFrame
    df = pd.DataFrame(envelope_data)
    df = df.sort_values('day_since_published')
    
    # Create comprehensive visualization
    fig, axes = plt.subplots(3, 2, figsize=(16, 14))
    fig.suptitle('Global Performance Envelope Analysis (715K+ Snapshots)', fontsize=16, y=1.02)
    
    # 1. Full envelope curves (0-365 days) - Linear Scale
    ax1 = axes[0, 0]
    ax1.fill_between(df['day_since_published'], 
                     df['p10_views'], df['p90_views'],
                     alpha=0.2, color='blue', label='10th-90th percentile')
    ax1.fill_between(df['day_since_published'],
                     df['p25_views'], df['p75_views'],
                     alpha=0.3, color='blue', label='25th-75th percentile')
    ax1.plot(df['day_since_published'], df['p50_views'], 
             'b-', linewidth=2, label='Median (50th)')
    ax1.set_title('Full Year View - Linear Scale')
    ax1.set_xlabel('Days Since Published')
    ax1.set_ylabel('Views')
    ax1.legend(loc='upper left')
    ax1.grid(True, alpha=0.3)
    ax1.set_xlim(0, 365)
    
    # Format y-axis
    ax1.yaxis.set_major_formatter(plt.FuncFormatter(
        lambda x, p: f'{x/1000:.0f}K' if x < 1000000 else f'{x/1000000:.1f}M'
    ))
    
    # 2. Full envelope curves - Log Scale (to see early days better)
    ax2 = axes[0, 1]
    ax2.fill_between(df['day_since_published'], 
                     df['p10_views'], df['p90_views'],
                     alpha=0.2, color='green', label='10th-90th percentile')
    ax2.fill_between(df['day_since_published'],
                     df['p25_views'], df['p75_views'],
                     alpha=0.3, color='green', label='25th-75th percentile')
    ax2.plot(df['day_since_published'], df['p50_views'], 
             'g-', linewidth=2, label='Median (50th)')
    ax2.set_title('Full Year View - Log Scale')
    ax2.set_xlabel('Days Since Published')
    ax2.set_ylabel('Views (log scale)')
    ax2.set_yscale('log')
    ax2.legend(loc='upper left')
    ax2.grid(True, alpha=0.3)
    ax2.set_xlim(0, 365)
    
    # 3. First 30 days (critical period)
    df_30 = df[df['day_since_published'] <= 30]
    ax3 = axes[1, 0]
    ax3.fill_between(df_30['day_since_published'], 
                     df_30['p10_views'], df_30['p90_views'],
                     alpha=0.2, color='purple', label='10th-90th percentile')
    ax3.fill_between(df_30['day_since_published'],
                     df_30['p25_views'], df_30['p75_views'],
                     alpha=0.3, color='purple', label='25th-75th percentile')
    ax3.plot(df_30['day_since_published'], df_30['p50_views'], 
             'purple', linewidth=2, label='Median', marker='o', markersize=3)
    ax3.set_title('First 30 Days (Critical Growth Period)')
    ax3.set_xlabel('Days Since Published')
    ax3.set_ylabel('Views')
    ax3.legend(loc='upper left')
    ax3.grid(True, alpha=0.3)
    ax3.set_xlim(0, 30)
    
    # Format y-axis
    ax3.yaxis.set_major_formatter(plt.FuncFormatter(
        lambda x, p: f'{x/1000:.0f}K' if x < 1000000 else f'{x/1000000:.1f}M'
    ))
    
    # 4. Growth rate (daily change in median)
    ax4 = axes[1, 1]
    growth_rate = np.gradient(df['p50_views'])
    # Smooth the growth rate to reduce noise
    from scipy.ndimage import gaussian_filter1d
    smoothed_growth = gaussian_filter1d(growth_rate, sigma=2)
    
    ax4.plot(df['day_since_published'], growth_rate, 
             'lightgray', linewidth=0.5, alpha=0.5, label='Raw daily growth')
    ax4.plot(df['day_since_published'], smoothed_growth, 
             'r-', linewidth=2, label='Smoothed growth rate')
    ax4.axhline(y=0, color='k', linestyle='-', alpha=0.3)
    ax4.set_title('Daily Growth Rate (Views/Day)')
    ax4.set_xlabel('Days Since Published')
    ax4.set_ylabel('Views per Day')
    ax4.legend()
    ax4.grid(True, alpha=0.3)
    ax4.set_xlim(0, 365)
    
    # 5. Sample counts (data quality indicator)
    ax5 = axes[2, 0]
    ax5.bar(df['day_since_published'], df['sample_count'], 
            color='orange', alpha=0.7, width=1)
    ax5.set_title('Sample Count by Day (Data Quality)')
    ax5.set_xlabel('Days Since Published')
    ax5.set_ylabel('Number of Videos')
    ax5.grid(True, alpha=0.3)
    ax5.set_xlim(0, 365)
    
    # Add horizontal line at 30 (minimum threshold)
    ax5.axhline(y=30, color='r', linestyle='--', alpha=0.5, label='Min threshold (30)')
    ax5.legend()
    
    # 6. Percentile spread (volatility indicator)
    ax6 = axes[2, 1]
    spread_90_10 = (df['p90_views'] - df['p10_views']) / df['p50_views']
    spread_75_25 = (df['p75_views'] - df['p25_views']) / df['p50_views']
    
    ax6.plot(df['day_since_published'], spread_90_10, 
             'b-', linewidth=1, label='90-10 spread / median', alpha=0.7)
    ax6.plot(df['day_since_published'], spread_75_25, 
             'g-', linewidth=2, label='75-25 spread / median')
    ax6.set_title('Relative Spread (Volatility)')
    ax6.set_xlabel('Days Since Published')
    ax6.set_ylabel('Spread Ratio')
    ax6.legend()
    ax6.grid(True, alpha=0.3)
    ax6.set_xlim(0, 365)
    
    plt.tight_layout()
    
    # Save the figure
    output_file = 'global_performance_envelope.png'
    plt.savefig(output_file, dpi=150, bbox_inches='tight')
    print(f"\n💾 Saved visualization to: {output_file}")
    
    # Print statistics
    print("\n📊 Key Statistics:")
    print(f"Day 1 median: {df[df['day_since_published']==1]['p50_views'].values[0]:,.0f} views")
    print(f"Day 7 median: {df[df['day_since_published']==7]['p50_views'].values[0]:,.0f} views")
    print(f"Day 30 median: {df[df['day_since_published']==30]['p50_views'].values[0]:,.0f} views")
    print(f"Day 90 median: {df[df['day_since_published']==90]['p50_views'].values[0]:,.0f} views")
    print(f"Day 365 median: {df[df['day_since_published']==365]['p50_views'].values[0]:,.0f} views")
    
    # Check for spikes
    print("\n🔍 Checking for spikes...")
    median_changes = np.diff(df['p50_views'])
    large_jumps = np.where(np.abs(median_changes) > df['p50_views'].values[:-1] * 0.2)[0]
    
    if len(large_jumps) > 0:
        print(f"Found {len(large_jumps)} days with >20% jumps:")
        for idx in large_jumps[:10]:  # Show first 10
            day = df.iloc[idx]['day_since_published']
            before = df.iloc[idx]['p50_views']
            after = df.iloc[idx+1]['p50_views']
            change_pct = (after - before) / before * 100
            print(f"  Day {day} → {day+1}: {before:,.0f} → {after:,.0f} ({change_pct:+.1f}%)")
    else:
        print("No major spikes detected (all changes < 20%)")
    
    plt.show()

if __name__ == "__main__":
    fetch_and_visualize()