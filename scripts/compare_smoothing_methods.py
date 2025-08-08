#!/usr/bin/env python3
"""
Compare original spiky performance curves with various smoothing methods
"""

import os
import matplotlib.pyplot as plt
import numpy as np
from supabase import create_client, Client
from dotenv import load_dotenv
import pandas as pd
from scipy.ndimage import gaussian_filter1d
from scipy.interpolate import UnivariateSpline
from scipy.optimize import curve_fit

# Load environment variables
load_dotenv()

# Initialize Supabase client
url = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
supabase: Client = create_client(url, key)

def logistic_curve(x, L, k, x0):
    """Logistic growth curve: L / (1 + exp(-k*(x-x0)))"""
    return L / (1 + np.exp(-k * (x - x0)))

def fetch_envelope_data():
    """Fetch current performance envelope data"""
    
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
    return pd.DataFrame(envelope_data)

def rolling_window_smooth(df, window=7):
    """Apply rolling window smoothing"""
    df_smooth = df.copy()
    
    # Apply rolling mean with centered window
    for col in ['p10_views', 'p25_views', 'p50_views', 'p75_views', 'p90_views']:
        df_smooth[col] = df[col].rolling(window=window, center=True, min_periods=1).mean()
    
    return df_smooth

def gaussian_smooth(df, sigma=2):
    """Apply Gaussian smoothing"""
    df_smooth = df.copy()
    
    for col in ['p10_views', 'p25_views', 'p50_views', 'p75_views', 'p90_views']:
        df_smooth[col] = gaussian_filter1d(df[col], sigma=sigma)
    
    return df_smooth

def spline_smooth(df, smoothing_factor=1000000):
    """Apply spline smoothing"""
    df_smooth = df.copy()
    days = df['day_since_published'].values
    
    for col in ['p10_views', 'p25_views', 'p50_views', 'p75_views', 'p90_views']:
        spline = UnivariateSpline(days, df[col].values, s=smoothing_factor)
        df_smooth[col] = spline(days)
        # Ensure non-negative
        df_smooth[col] = np.maximum(df_smooth[col], 0)
    
    return df_smooth

def parametric_fit(df):
    """Fit logistic curves to each percentile"""
    df_smooth = df.copy()
    days = df['day_since_published'].values
    
    for col in ['p10_views', 'p25_views', 'p50_views', 'p75_views', 'p90_views']:
        try:
            # Initial guess: max value, growth rate, midpoint
            p0 = [df[col].max() * 1.5, 0.05, 30]
            popt, _ = curve_fit(logistic_curve, days, df[col].values, p0=p0, maxfev=5000)
            df_smooth[col] = logistic_curve(days, *popt)
        except:
            # If logistic fit fails, keep original
            print(f"  Warning: Logistic fit failed for {col}, using spline fallback")
            spline = UnivariateSpline(days, df[col].values, s=10000000)
            df_smooth[col] = spline(days)
    
    return df_smooth

def calculate_stability_metrics(df_original, df_smooth, percentile='p50_views'):
    """Calculate how stable the smoothed version is"""
    
    # Daily changes in original
    daily_changes_orig = np.abs(np.diff(df_original[percentile])) / df_original[percentile].values[:-1]
    daily_changes_smooth = np.abs(np.diff(df_smooth[percentile])) / df_smooth[percentile].values[:-1]
    
    # Count large jumps (>10% change)
    large_jumps_orig = np.sum(daily_changes_orig > 0.1)
    large_jumps_smooth = np.sum(daily_changes_smooth > 0.1)
    
    # Average volatility
    avg_volatility_orig = np.mean(daily_changes_orig)
    avg_volatility_smooth = np.mean(daily_changes_smooth)
    
    return {
        'large_jumps_original': large_jumps_orig,
        'large_jumps_smooth': large_jumps_smooth,
        'avg_volatility_original': avg_volatility_orig,
        'avg_volatility_smooth': avg_volatility_smooth,
        'stability_improvement': (1 - avg_volatility_smooth/avg_volatility_orig) * 100
    }

def create_comparison_plots(df_original, smoothed_versions):
    """Create comprehensive comparison plots"""
    
    fig = plt.figure(figsize=(20, 16))
    fig.suptitle('Performance Envelope Smoothing Comparison', fontsize=16, y=1.02)
    
    # Create 3x2 grid for different views
    # Row 1: First 30 days comparison
    # Row 2: Full year comparison  
    # Row 3: Zoom on problematic region (days 100-200)
    
    for row, (day_range, title_suffix) in enumerate([
        ((0, 30), 'First 30 Days'),
        ((0, 365), 'Full Year'),
        ((100, 200), 'Days 100-200 (Spiky Region)')
    ]):
        
        # Left column: All methods overlaid
        ax_left = plt.subplot(3, 2, row*2 + 1)
        
        df_range = df_original[(df_original['day_since_published'] >= day_range[0]) & 
                               (df_original['day_since_published'] <= day_range[1])]
        
        # Plot original (spiky)
        ax_left.plot(df_range['day_since_published'], df_range['p50_views'], 
                    'lightgray', linewidth=1, alpha=0.5, label='Original (Spiky)')
        
        # Plot each smoothed version
        colors = ['blue', 'green', 'red', 'purple']
        for (name, df_smooth), color in zip(smoothed_versions.items(), colors):
            df_smooth_range = df_smooth[(df_smooth['day_since_published'] >= day_range[0]) & 
                                       (df_smooth['day_since_published'] <= day_range[1])]
            ax_left.plot(df_smooth_range['day_since_published'], df_smooth_range['p50_views'],
                        color, linewidth=2, label=name, alpha=0.8)
        
        ax_left.set_title(f'Median (P50) Comparison - {title_suffix}')
        ax_left.set_xlabel('Days Since Published')
        ax_left.set_ylabel('Views')
        ax_left.legend()
        ax_left.grid(True, alpha=0.3)
        
        # Format y-axis
        ax_left.yaxis.set_major_formatter(plt.FuncFormatter(
            lambda x, p: f'{x/1000:.0f}K' if x < 1000000 else f'{x/1000000:.1f}M'
        ))
        
        # Right column: Show the "best" smoothed with confidence bands
        ax_right = plt.subplot(3, 2, row*2 + 2)
        
        # Use 7-day rolling as the "recommended" approach
        df_best = smoothed_versions['7-Day Rolling']
        df_best_range = df_best[(df_best['day_since_published'] >= day_range[0]) & 
                                (df_best['day_since_published'] <= day_range[1])]
        
        # Show all percentiles for context
        ax_right.fill_between(df_best_range['day_since_published'],
                             df_best_range['p10_views'], df_best_range['p90_views'],
                             alpha=0.2, color='blue', label='10th-90th percentile')
        ax_right.fill_between(df_best_range['day_since_published'],
                             df_best_range['p25_views'], df_best_range['p75_views'],
                             alpha=0.3, color='blue', label='25th-75th percentile')
        ax_right.plot(df_best_range['day_since_published'], df_best_range['p50_views'],
                     'b-', linewidth=2, label='Median (smoothed)')
        
        # Overlay original median as dots
        ax_right.scatter(df_range['day_since_published'], df_range['p50_views'],
                        color='red', s=10, alpha=0.5, label='Original median')
        
        ax_right.set_title(f'Recommended: 7-Day Rolling - {title_suffix}')
        ax_right.set_xlabel('Days Since Published')
        ax_right.set_ylabel('Views')
        ax_right.legend()
        ax_right.grid(True, alpha=0.3)
        
        # Format y-axis
        ax_right.yaxis.set_major_formatter(plt.FuncFormatter(
            lambda x, p: f'{x/1000:.0f}K' if x < 1000000 else f'{x/1000000:.1f}M'
        ))
    
    plt.tight_layout()
    return fig

def main():
    # Fetch original data
    df_original = fetch_envelope_data()
    df_original = df_original.sort_values('day_since_published')
    
    print("\n🔄 Applying smoothing methods...")
    
    # Apply different smoothing methods
    smoothed_versions = {
        '7-Day Rolling': rolling_window_smooth(df_original, window=7),
        'Gaussian (σ=2)': gaussian_smooth(df_original, sigma=2),
        'Spline': spline_smooth(df_original, smoothing_factor=1000000),
        'Logistic Fit': parametric_fit(df_original)
    }
    
    # Calculate stability metrics for each method
    print("\n📊 Stability Analysis (using median/P50):")
    print("-" * 60)
    
    for name, df_smooth in smoothed_versions.items():
        metrics = calculate_stability_metrics(df_original, df_smooth)
        print(f"\n{name}:")
        print(f"  Large jumps (>10%): {metrics['large_jumps_original']} → {metrics['large_jumps_smooth']}")
        print(f"  Avg volatility: {metrics['avg_volatility_original']:.1%} → {metrics['avg_volatility_smooth']:.1%}")
        print(f"  Stability improvement: {metrics['stability_improvement']:.1f}%")
    
    # Create comparison plots
    print("\n📈 Creating comparison visualizations...")
    fig = create_comparison_plots(df_original, smoothed_versions)
    
    # Save the figure
    output_file = 'smoothing_comparison.png'
    plt.savefig(output_file, dpi=150, bbox_inches='tight')
    print(f"\n💾 Saved comparison to: {output_file}")
    
    # Show specific examples of improvement
    print("\n🎯 Example: Day 150 median views")
    print("-" * 40)
    day_150_orig = df_original[df_original['day_since_published'] == 150]['p50_views'].values[0]
    print(f"Original (spiky): {day_150_orig:,.0f} views")
    
    for name, df_smooth in smoothed_versions.items():
        day_150_smooth = df_smooth[df_smooth['day_since_published'] == 150]['p50_views'].values[0]
        diff_pct = (day_150_smooth - day_150_orig) / day_150_orig * 100
        print(f"{name:15}: {day_150_smooth:,.0f} views ({diff_pct:+.1f}%)")
    
    print("\n✅ Analysis complete! Check 'smoothing_comparison.png'")
    
    plt.show()

if __name__ == "__main__":
    main()