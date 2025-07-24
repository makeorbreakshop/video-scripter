#!/usr/bin/env python3
"""
Fix performance curves by removing artificial plateaus
Creates natural smooth curves that better represent YouTube growth patterns
"""

import os
import matplotlib.pyplot as plt
import numpy as np
from supabase import create_client, Client
from dotenv import load_dotenv
from scipy.interpolate import UnivariateSpline
from datetime import datetime

# Load environment variables
load_dotenv()

# Initialize Supabase client
url = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
supabase: Client = create_client(url, key)

def fix_performance_curves():
    """Recalculate curves without monotonic constraint"""
    
    print("🔧 Fixing performance curves by removing artificial plateaus...")
    
    # Step 1: Get raw percentile data directly from view_snapshots
    print("\n1️⃣ Calculating fresh percentiles from raw data...")
    
    # Get data in chunks
    all_snapshots = []
    offset = 0
    batch_size = 1000  # Supabase has a default limit of 1000
    
    while True:
        batch = supabase.table('view_snapshots')\
            .select('days_since_published, view_count')\
            .lte('days_since_published', 365)\
            .gte('days_since_published', 0)\
            .range(offset, offset + batch_size - 1)\
            .execute()
        
        if not batch.data:
            break
            
        all_snapshots.extend(batch.data)
        offset += batch_size
        print(f"  Processed {len(all_snapshots)} snapshots...")
        
        # Continue if we got a full batch
        if len(batch.data) < batch_size:
            break
    
    print(f"✓ Total snapshots: {len(all_snapshots)}")
    
    # Group by day and calculate percentiles
    from collections import defaultdict
    views_by_day = defaultdict(list)
    
    for snap in all_snapshots:
        day = snap['days_since_published']
        views = snap['view_count']
        views_by_day[day].append(views)
    
    # Calculate percentiles for each day
    percentile_data = []
    for day in sorted(views_by_day.keys()):
        views = views_by_day[day]
        if len(views) >= 10:  # Need minimum samples
            percentile_data.append({
                'day': day,
                'count': len(views),
                'p10': np.percentile(views, 10),
                'p25': np.percentile(views, 25),
                'p50': np.percentile(views, 50),
                'p75': np.percentile(views, 75),
                'p90': np.percentile(views, 90),
                'p95': np.percentile(views, 95)
            })
    
    print(f"✓ Calculated percentiles for {len(percentile_data)} days")
    
    # Step 2: Apply smooth interpolation WITHOUT monotonic constraint
    print("\n2️⃣ Applying natural smoothing (no artificial plateaus)...")
    
    # Extract arrays
    days = np.array([d['day'] for d in percentile_data])
    counts = np.array([d['count'] for d in percentile_data])
    
    # Create smooth curves for each percentile
    smooth_days = np.arange(0, 366)
    smooth_data = []
    
    for percentile in ['p10', 'p25', 'p50', 'p75', 'p90', 'p95']:
        raw_values = np.array([d[percentile] for d in percentile_data])
        
        # Weight by sample count
        weights = np.sqrt(counts)
        
        # Use different smoothing for different time periods
        if len(days) > 10:
            # Higher smoothing for less noise
            spline = UnivariateSpline(days, raw_values, w=weights, s=50000000)
            smooth_values = spline(smooth_days)
            
            # Ensure non-negative
            smooth_values = np.maximum(smooth_values, 0)
            
            # Ensure reasonable starting values
            if smooth_values[0] < 100:
                smooth_values[0] = raw_values[0] if len(raw_values) > 0 else 1000
        else:
            # Linear interpolation for sparse data
            smooth_values = np.interp(smooth_days, days, raw_values)
        
        smooth_data.append({
            'percentile': percentile,
            'values': smooth_values
        })
    
    # Step 3: Create visualization comparing old vs new
    print("\n3️⃣ Creating comparison visualization...")
    
    # Get current (monotonic) data
    current_data = supabase.table('performance_envelopes')\
        .select('*')\
        .lte('day_since_published', 365)\
        .order('day_since_published')\
        .execute()
    
    current_days = np.array([d['day_since_published'] for d in current_data.data])
    current_p50 = np.array([d['p50_views'] for d in current_data.data])
    
    # Get new p50 values
    new_p50 = next(d['values'] for d in smooth_data if d['percentile'] == 'p50')
    
    # Create plots
    fig, (ax1, ax2, ax3) = plt.subplots(3, 1, figsize=(14, 16))
    
    # Plot 1: Comparison of median curves
    ax1.plot(current_days, current_p50, 'r-', linewidth=2, label='Current (with plateaus)')
    ax1.plot(smooth_days, new_p50, 'b-', linewidth=2, label='Fixed (natural growth)')
    
    # Highlight plateaus
    for i in range(1, len(current_p50)):
        if current_p50[i] == current_p50[i-1]:
            ax1.axvspan(current_days[i-1], current_days[i], alpha=0.2, color='red')
    
    ax1.set_title('Median View Curves: Current vs Fixed', fontsize=16)
    ax1.set_xlabel('Days Since Published')
    ax1.set_ylabel('Views (Median)')
    ax1.legend()
    ax1.grid(True, alpha=0.3)
    ax1.set_xlim(0, 90)  # Focus on first 90 days
    
    # Format y-axis
    ax1.yaxis.set_major_formatter(plt.FuncFormatter(
        lambda x, p: f'{x/1000:.0f}K' if x < 1000000 else f'{x/1000000:.1f}M'
    ))
    
    # Plot 2: Growth rate comparison
    current_growth = np.gradient(current_p50)
    new_growth = np.gradient(new_p50)
    
    ax2.plot(current_days[1:], current_growth[1:], 'r-', linewidth=2, 
             label='Current (shows artificial jumps)')
    ax2.plot(smooth_days[1:], new_growth[1:], 'b-', linewidth=2,
             label='Fixed (natural deceleration)')
    ax2.axhline(y=0, color='k', linestyle='-', alpha=0.3)
    
    ax2.set_title('Daily Growth Rate (Views/Day)', fontsize=14)
    ax2.set_xlabel('Days Since Published')
    ax2.set_ylabel('Views per Day')
    ax2.legend()
    ax2.grid(True, alpha=0.3)
    ax2.set_xlim(0, 90)
    
    # Plot 3: All percentiles
    ax3.fill_between(smooth_days, 
                     next(d['values'] for d in smooth_data if d['percentile'] == 'p10'),
                     next(d['values'] for d in smooth_data if d['percentile'] == 'p90'),
                     alpha=0.2, color='blue', label='10th-90th percentile')
    ax3.fill_between(smooth_days,
                     next(d['values'] for d in smooth_data if d['percentile'] == 'p25'),
                     next(d['values'] for d in smooth_data if d['percentile'] == 'p75'),
                     alpha=0.3, color='blue', label='25th-75th percentile')
    ax3.plot(smooth_days, new_p50, 'b-', linewidth=2, label='Median (50th)')
    
    ax3.set_title('Fixed Performance Envelope - All Percentiles', fontsize=16)
    ax3.set_xlabel('Days Since Published')
    ax3.set_ylabel('Views')
    ax3.legend()
    ax3.grid(True, alpha=0.3)
    ax3.set_yscale('log')
    
    # Format y-axis
    ax3.yaxis.set_major_formatter(plt.FuncFormatter(
        lambda x, p: f'{x/1000:.0f}K' if x < 1000000 else f'{x/1000000:.1f}M'
    ))
    
    plt.tight_layout()
    plt.savefig('fixed_performance_curves.png', dpi=300, bbox_inches='tight')
    print(f"\n💾 Saved comparison to: fixed_performance_curves.png")
    
    # Step 4: Update database with fixed curves
    print("\n4️⃣ Updating database with fixed curves...")
    
    # Prepare update data
    updates = []
    for i in range(366):
        updates.append({
            'day_since_published': i,
            'p10_views': int(next(d['values'][i] for d in smooth_data if d['percentile'] == 'p10')),
            'p25_views': int(next(d['values'][i] for d in smooth_data if d['percentile'] == 'p25')),
            'p50_views': int(next(d['values'][i] for d in smooth_data if d['percentile'] == 'p50')),
            'p75_views': int(next(d['values'][i] for d in smooth_data if d['percentile'] == 'p75')),
            'p90_views': int(next(d['values'][i] for d in smooth_data if d['percentile'] == 'p90')),
            'p95_views': int(next(d['values'][i] for d in smooth_data if d['percentile'] == 'p95')),
            'sample_count': next((d['count'] for d in percentile_data if d['day'] == i), 0),
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
    
    print("\n✅ SUCCESS! Performance curves fixed:")
    print(f"  - Removed artificial plateaus")
    print(f"  - Natural growth pattern restored")
    print(f"  - Database updated with {len(updates)} days of data")
    
    # Show sample improvements
    print("\n📊 Sample improvements (Day 7):")
    old_day7 = current_p50[7] if len(current_p50) > 7 else 0
    new_day7 = new_p50[7]
    print(f"  Old: {old_day7:,.0f} views")
    print(f"  New: {new_day7:,.0f} views")
    print(f"  Change: {(new_day7/old_day7 - 1)*100:+.1f}%")

if __name__ == "__main__":
    fix_performance_curves()