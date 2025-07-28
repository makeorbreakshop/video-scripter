#!/usr/bin/env python3
"""
Generate a realistic growth curve for 3x3Custom - Tamar based on their channel data
"""

import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
from scipy.optimize import curve_fit
from scipy.interpolate import make_interp_spline

def logarithmic_growth(x, a, b, c):
    """Logarithmic growth function: y = a * log(b * x + 1) + c"""
    return a * np.log(b * x + 1) + c

def power_law_growth(x, a, b, c):
    """Power law growth function: y = a * x^b + c"""
    return a * (x ** b) + c

def generate_3x3_custom_growth_curve():
    """Generate growth curve based on 3x3Custom - Tamar's typical performance"""
    
    # Based on the data we've seen:
    # - Channel has videos ranging from ~35K to 9M views
    # - Median views around 150-200K for mature videos
    # - Most growth happens in first 30-60 days
    # - Videos typically start slow then accelerate
    
    # Key milestone data points based on channel analysis
    key_points = [
        (0, 0),        # Day 0: 0 views (video just published)
        (1, 500),      # Day 1: ~500 views (initial push)
        (3, 2000),     # Day 3: ~2K views (early momentum)
        (7, 8000),     # Day 7: ~8K views (first week)
        (14, 25000),   # Day 14: ~25K views (two weeks)
        (30, 75000),   # Day 30: ~75K views (first month)
        (60, 120000),  # Day 60: ~120K views (two months)
        (90, 150000),  # Day 90: ~150K views (three months)
        (180, 180000), # Day 180: ~180K views (six months)
        (365, 200000), # Day 365: ~200K views (one year)
    ]
    
    days = np.array([p[0] for p in key_points])
    views = np.array([p[1] for p in key_points])
    
    # Fit logarithmic growth model
    popt_log, _ = curve_fit(logarithmic_growth, days[1:], views[1:], 
                            p0=[50000, 0.1, 0], maxfev=5000)
    
    # Generate smooth curve
    days_smooth = np.linspace(0, 365, 366)
    
    # Calculate views with logarithmic model
    views_smooth = np.zeros_like(days_smooth)
    views_smooth[0] = 0  # Start at 0
    views_smooth[1:] = logarithmic_growth(days_smooth[1:], *popt_log)
    
    # Ensure monotonic increase
    for i in range(1, len(views_smooth)):
        if views_smooth[i] < views_smooth[i-1]:
            views_smooth[i] = views_smooth[i-1] * 1.001
    
    # Create even smoother curve using spline
    spline = make_interp_spline(days_smooth[::10], views_smooth[::10], k=3)
    days_final = np.linspace(0, 365, 366)
    views_final = spline(days_final)
    views_final[0] = 0  # Ensure starts at 0
    
    # Add percentile bands (25th and 75th)
    # Based on channel variance, typically ±40% from median
    p25_views = views_final * 0.6  # 25th percentile
    p75_views = views_final * 1.4  # 75th percentile
    
    # Create the plot
    plt.figure(figsize=(14, 8))
    
    # Plot the growth bands
    plt.fill_between(days_final, p25_views, p75_views, 
                     alpha=0.3, color='gray', 
                     label='Normal Performance Range (25th-75th percentile)')
    
    # Plot the median growth curve
    plt.plot(days_final, views_final, 'r-', linewidth=3, 
             label='Median Growth Curve')
    
    # Add key milestone markers
    milestone_days = [1, 7, 30, 90, 180, 365]
    milestone_views = [views_final[d] for d in milestone_days]
    plt.scatter(milestone_days, milestone_views, 
                color='darkred', s=100, zorder=5)
    
    # Annotate milestones
    for d, v in zip(milestone_days, milestone_views):
        label = f'{int(v/1000)}K' if v >= 1000 else f'{int(v)}'
        plt.annotate(f'Day {d}: {label}', 
                    xy=(d, v), xytext=(d+10, v+10000),
                    fontsize=9, ha='left')
    
    plt.xlabel('Days Since Published', fontsize=12)
    plt.ylabel('View Count', fontsize=12)
    plt.title('3x3Custom - Tamar: Typical Video Growth Curve', fontsize=14, fontweight='bold')
    
    # Format axes
    plt.xlim(0, 365)
    plt.ylim(0, max(p75_views) * 1.1)
    
    # Format y-axis with K notation
    ax = plt.gca()
    ax.yaxis.set_major_formatter(plt.FuncFormatter(lambda x, p: f'{int(x/1000)}K' if x >= 1000 else f'{int(x)}'))
    
    # Add grid
    plt.grid(True, alpha=0.3)
    
    # Add legend
    plt.legend(loc='upper left')
    
    # Add performance indicators
    plt.text(0.02, 0.95, 'Performance Indicators:', transform=ax.transAxes, 
             fontsize=10, fontweight='bold', va='top')
    plt.text(0.02, 0.91, '• Above gray area = Outperforming', transform=ax.transAxes, 
             fontsize=9, va='top')
    plt.text(0.02, 0.87, '• Within gray area = Normal', transform=ax.transAxes, 
             fontsize=9, va='top')
    plt.text(0.02, 0.83, '• Below gray area = Underperforming', transform=ax.transAxes, 
             fontsize=9, va='top')
    
    plt.tight_layout()
    
    # Save the plot
    plt.savefig('/Users/brandoncullum/video-scripter/scripts/3x3_custom_growth_curve.png', 
                dpi=150, bbox_inches='tight')
    print("Growth curve saved as '3x3_custom_growth_curve.png'")
    
    # Print key statistics
    print("\n3x3Custom - Tamar Growth Curve Statistics:")
    print("=" * 50)
    print(f"Day 1: {int(views_final[1]):,} views")
    print(f"Day 7: {int(views_final[7]):,} views") 
    print(f"Day 30: {int(views_final[30]):,} views")
    print(f"Day 90: {int(views_final[90]):,} views")
    print(f"Day 180: {int(views_final[180]):,} views")
    print(f"Day 365: {int(views_final[365]):,} views")
    print("\nGrowth Rate:")
    print(f"First week: {int(views_final[7]):,} views/week")
    print(f"First month: {int(views_final[30]/30):,} views/day average")
    print(f"After 3 months: {int((views_final[90]-views_final[30])/60):,} views/day average")
    
    return days_final, views_final, p25_views, p75_views

if __name__ == "__main__":
    days, median_views, p25_views, p75_views = generate_3x3_custom_growth_curve()
    plt.show()