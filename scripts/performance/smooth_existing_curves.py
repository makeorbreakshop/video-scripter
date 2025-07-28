#!/usr/bin/env python3
"""
Smooth the existing performance curves to remove noise
Uses data already in performance_envelopes table
"""

import os
import matplotlib.pyplot as plt
import numpy as np
from supabase import create_client, Client
from dotenv import load_dotenv
from scipy.ndimage import gaussian_filter1d
from datetime import datetime

# Load environment variables
load_dotenv()

# Initialize Supabase client
url = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
supabase: Client = create_client(url, key)

def smooth_existing_curves():
    """Apply better smoothing to existing curves"""
    
    print("🎯 Smoothing existing performance curves...")
    
    # Step 1: Get current data from performance_envelopes
    print("\n1️⃣ Fetching current curve data...")
    
    current_data = supabase.table('performance_envelopes')\
        .select('*')\
        .order('day_since_published')\
        .execute()
    
    # Convert to arrays
    days = np.array([d['day_since_published'] for d in current_data.data])
    
    # Step 2: Apply smoothing to each percentile
    print("\n2️⃣ Applying Gaussian smoothing...")
    
    smoothed_curves = {}
    
    for percentile in ['p10_views', 'p25_views', 'p50_views', 'p75_views', 'p90_views', 'p95_views']:
        raw_values = np.array([d[percentile] for d in current_data.data])
        
        # Apply different smoothing for different periods
        smooth_values = np.zeros_like(raw_values, dtype=float)
        
        # Days 0-7: Very light smoothing (important early growth)
        early_period = raw_values[:8]
        smooth_values[:8] = gaussian_filter1d(early_period, sigma=0.5)
        
        # Days 8-30: Light smoothing
        if len(raw_values) > 30:
            mid_period = raw_values[8:31]
            smooth_values[8:31] = gaussian_filter1d(mid_period, sigma=1.5)
            
            # Days 31-365: Heavier smoothing
            late_period = raw_values[31:]
            smooth_values[31:] = gaussian_filter1d(late_period, sigma=3.0)
        
        # Ensure monotonic growth (cumulative views must increase)
        for i in range(1, len(smooth_values)):
            if smooth_values[i] < smooth_values[i-1]:
                smooth_values[i] = smooth_values[i-1] * 1.001  # Slight growth
        
        smoothed_curves[percentile.replace('_views', '')] = smooth_values
    
    # Step 3: Create visualization
    print("\n3️⃣ Creating visualization...")
    
    fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(14, 12))
    
    # Plot 1: Before and after smoothing (median)
    raw_p50 = np.array([d['p50_views'] for d in current_data.data])
    smooth_p50 = smoothed_curves['p50']
    
    # Focus on first 90 days
    days_90 = days[:91]
    raw_90 = raw_p50[:91]
    smooth_90 = smooth_p50[:91]
    
    ax1.plot(days_90, raw_90, 'r-', linewidth=2, alpha=0.7, label='Current (noisy)')
    ax1.plot(days_90, smooth_90, 'b-', linewidth=2, label='Smoothed')
    
    ax1.set_title('Median Views: Current vs Smoothed (First 90 Days)', fontsize=16)
    ax1.set_xlabel('Days Since Published')
    ax1.set_ylabel('Views')
    ax1.legend()
    ax1.grid(True, alpha=0.3)
    
    # Format y-axis
    ax1.yaxis.set_major_formatter(plt.FuncFormatter(
        lambda x, p: f'{x/1000:.0f}K' if x < 1000000 else f'{x/1000000:.1f}M'
    ))
    
    # Plot 2: All smoothed percentiles
    ax2.fill_between(days, smoothed_curves['p10'], smoothed_curves['p90'],
                     alpha=0.2, color='blue', label='10th-90th percentile')
    ax2.fill_between(days, smoothed_curves['p25'], smoothed_curves['p75'],
                     alpha=0.3, color='blue', label='25th-75th percentile')
    ax2.plot(days, smoothed_curves['p50'], 'b-', linewidth=2, label='Median (50th)')
    
    ax2.set_title('Smoothed Performance Envelope - All Percentiles', fontsize=16)
    ax2.set_xlabel('Days Since Published')
    ax2.set_ylabel('Views')
    ax2.legend()
    ax2.grid(True, alpha=0.3)
    ax2.set_yscale('log')
    
    # Format y-axis
    ax2.yaxis.set_major_formatter(plt.FuncFormatter(
        lambda x, p: f'{x/1000:.0f}K' if x < 1000000 else f'{x/1000000:.1f}M'
    ))
    
    plt.tight_layout()
    plt.savefig('smoothed_performance_curves.png', dpi=300, bbox_inches='tight')
    print(f"\n💾 Saved visualization to: smoothed_performance_curves.png")
    
    # Step 4: Update database with smoothed values
    print("\n4️⃣ Updating database with smoothed curves...")
    
    updates = []
    for i, day in enumerate(days):
        updates.append({
            'day_since_published': int(day),
            'p10_views': int(smoothed_curves['p10'][i]),
            'p25_views': int(smoothed_curves['p25'][i]),
            'p50_views': int(smoothed_curves['p50'][i]),
            'p75_views': int(smoothed_curves['p75'][i]),
            'p90_views': int(smoothed_curves['p90'][i]),
            'p95_views': int(smoothed_curves['p95'][i]),
            'sample_count': current_data.data[i]['sample_count'],
            'updated_at': datetime.now().isoformat()
        })
    
    # Update in batches
    batch_size = 50
    for i in range(0, len(updates), batch_size):
        batch = updates[i:i+batch_size]
        for update in batch:
            supabase.table('performance_envelopes')\
                .upsert(update, on_conflict='day_since_published')\
                .execute()
        print(f"  Updated days {i} to {min(i+batch_size, len(updates))}")
    
    print("\n✅ SUCCESS! Curves smoothed:")
    print(f"  - Removed noise while preserving growth pattern")
    print(f"  - Ensured monotonic growth (cumulative views always increase)")
    print(f"  - Different smoothing levels for early vs late periods")
    
    # Show key metrics
    print("\n📊 Key growth metrics (median):")
    print(f"  Day 1: {smoothed_curves['p50'][1]:,.0f} views")
    print(f"  Day 7: {smoothed_curves['p50'][7]:,.0f} views ({smoothed_curves['p50'][7]/smoothed_curves['p50'][1]:.1f}x day 1)")
    print(f"  Day 30: {smoothed_curves['p50'][30]:,.0f} views")
    print(f"  Day 90: {smoothed_curves['p50'][90]:,.0f} views")
    print(f"  Day 365: {smoothed_curves['p50'][365]:,.0f} views")
    
    # Growth characteristics
    week1_growth = (smoothed_curves['p50'][7] - smoothed_curves['p50'][0]) / 7
    week4_growth = (smoothed_curves['p50'][28] - smoothed_curves['p50'][21]) / 7
    
    print(f"\n📈 Growth characteristics:")
    print(f"  Week 1 avg daily growth: {week1_growth:,.0f} views/day")
    print(f"  Week 4 avg daily growth: {week4_growth:,.0f} views/day")
    print(f"  Deceleration: {week4_growth/week1_growth:.1%} of week 1 rate")

if __name__ == "__main__":
    smooth_existing_curves()