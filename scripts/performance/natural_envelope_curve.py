#!/usr/bin/env python3
"""
Create natural envelope curves without monotonic constraint
Better for viral detection and outlier identification
"""

import os
import matplotlib.pyplot as plt
import numpy as np
from supabase import create_client, Client
from dotenv import load_dotenv
from scipy.interpolate import UnivariateSpline

# Load environment variables
load_dotenv()

# Initialize Supabase client
url = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
supabase: Client = create_client(url, key)

def calculate_natural_envelope():
    """Calculate envelope without forcing monotonicity"""
    
    print("📊 Calculating natural performance envelope...")
    
    # Get raw view snapshot data
    print("Fetching view snapshots...")
    
    # Get count of snapshots per day
    day_counts = {}
    percentiles_by_day = {}
    
    # Process in chunks to handle large dataset
    offset = 0
    batch_size = 10000
    
    while True:
        snapshots = supabase.table('view_snapshots')\
            .select('days_since_published, view_count')\
            .order('days_since_published')\
            .range(offset, offset + batch_size - 1)\
            .execute()
        
        if not snapshots.data:
            break
            
        # Group by day
        for snap in snapshots.data:
            day = snap['days_since_published']
            views = snap['view_count']
            
            if day not in percentiles_by_day:
                percentiles_by_day[day] = []
            percentiles_by_day[day].append(views)
        
        offset += batch_size
        print(f"  Processed {offset} snapshots...")
    
    print(f"✓ Total days with data: {len(percentiles_by_day)}")
    
    # Calculate percentiles for each day
    envelope_data = []
    for day in sorted(percentiles_by_day.keys()):
        if day > 365:  # Focus on first year
            continue
            
        views = percentiles_by_day[day]
        if len(views) >= 10:  # Need minimum data
            p25 = np.percentile(views, 25)
            p50 = np.percentile(views, 50)
            p75 = np.percentile(views, 75)
            
            envelope_data.append({
                'day': day,
                'count': len(views),
                'p25': p25,
                'p50': p50,
                'p75': p75
            })
    
    print(f"✓ Days with sufficient data: {len(envelope_data)}")
    
    # Extract arrays
    days = np.array([e['day'] for e in envelope_data])
    p25_raw = np.array([e['p25'] for e in envelope_data])
    p50_raw = np.array([e['p50'] for e in envelope_data])
    p75_raw = np.array([e['p75'] for e in envelope_data])
    counts = np.array([e['count'] for e in envelope_data])
    
    # Create smooth curves using splines (no monotonic constraint)
    # Weight by number of observations
    weights = np.sqrt(counts)  # Square root to avoid over-weighting
    
    # Fit splines
    spline_p25 = UnivariateSpline(days, p25_raw, w=weights, s=1000)
    spline_p50 = UnivariateSpline(days, p50_raw, w=weights, s=1000)
    spline_p75 = UnivariateSpline(days, p75_raw, w=weights, s=1000)
    
    # Generate smooth curves
    smooth_days = np.linspace(0, 365, 366)
    p25_smooth = spline_p25(smooth_days)
    p50_smooth = spline_p50(smooth_days)
    p75_smooth = spline_p75(smooth_days)
    
    # Ensure we start at 0
    p25_smooth[0] = 0
    p50_smooth[0] = 0
    p75_smooth[0] = 0
    
    # Create visualization
    fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(14, 12))
    
    # Top plot: Raw vs Smooth
    ax1.scatter(days, p50_raw, alpha=0.5, s=20, c=counts, cmap='viridis', 
                label='Raw median (sized by count)')
    ax1.plot(smooth_days, p50_smooth, 'b-', linewidth=2, 
             label='Natural smooth curve')
    
    # Add monotonic version for comparison
    p50_monotonic = p50_smooth.copy()
    for i in range(1, len(p50_monotonic)):
        p50_monotonic[i] = max(p50_monotonic[i], p50_monotonic[i-1])
    ax1.plot(smooth_days, p50_monotonic, 'r--', linewidth=2, alpha=0.7,
             label='Forced monotonic (current)')
    
    ax1.set_title('Natural vs Monotonic Curves', fontsize=14)
    ax1.set_xlabel('Days Since Published')
    ax1.set_ylabel('Views (Median)')
    ax1.legend()
    ax1.grid(True, alpha=0.3)
    
    # Format y-axis
    ax1.yaxis.set_major_formatter(plt.FuncFormatter(
        lambda x, p: f'{x/1000:.0f}K' if x < 1000000 else f'{x/1000000:.1f}M'
    ))
    
    # Bottom plot: Growth rate (derivative)
    growth_rate = np.gradient(p50_smooth)
    growth_rate_monotonic = np.gradient(p50_monotonic)
    
    ax2.plot(smooth_days[1:], growth_rate[1:], 'b-', linewidth=2,
             label='Natural growth rate')
    ax2.plot(smooth_days[1:], growth_rate_monotonic[1:], 'r--', linewidth=2, alpha=0.7,
             label='Monotonic growth rate')
    ax2.axhline(y=0, color='k', linestyle='-', alpha=0.3)
    
    ax2.set_title('Daily Growth Rate (Views/Day)', fontsize=14)
    ax2.set_xlabel('Days Since Published')
    ax2.set_ylabel('Views per Day')
    ax2.legend()
    ax2.grid(True, alpha=0.3)
    
    plt.tight_layout()
    
    # Save plot
    output_path = 'natural_envelope_curve.png'
    plt.savefig(output_path, dpi=300, bbox_inches='tight')
    print(f"\n💾 Saved visualization to: {output_path}")
    
    # Analysis
    print("\n📊 ANALYSIS:")
    print(f"Natural curve characteristics:")
    print(f"  - Day 1: {p50_smooth[1]:,.0f} views")
    print(f"  - Day 7: {p50_smooth[7]:,.0f} views")
    print(f"  - Day 30: {p50_smooth[30]:,.0f} views")
    print(f"  - Day 90: {p50_smooth[90]:,.0f} views")
    print(f"  - Day 365: {p50_smooth[365]:,.0f} views")
    
    # Find plateaus in monotonic version
    plateaus = []
    for i in range(1, len(p50_monotonic)):
        if p50_monotonic[i] == p50_monotonic[i-1]:
            if not plateaus or plateaus[-1][-1] != i-1:
                plateaus.append([i-1, i])
            else:
                plateaus[-1][-1] = i
    
    print(f"\nMonotonic version has {len(plateaus)} artificial plateaus")
    print("Major plateaus:")
    for p in plateaus[:5]:
        print(f"  Days {p[0]}-{p[1]}: stuck at {p50_monotonic[p[0]]:,.0f} views")
    
    return smooth_days, p25_smooth, p50_smooth, p75_smooth

if __name__ == "__main__":
    calculate_natural_envelope()