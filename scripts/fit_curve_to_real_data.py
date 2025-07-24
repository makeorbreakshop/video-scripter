#!/usr/bin/env python3
"""
Fit a curve to the ACTUAL view tracking data
"""

import os
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
from supabase import create_client, Client
from datetime import datetime, timedelta
from dotenv import load_dotenv
from scipy.optimize import curve_fit
from scipy.interpolate import make_interp_spline, interp1d
import re

# Load environment variables
load_dotenv()

# Supabase connection
url = os.getenv('NEXT_PUBLIC_SUPABASE_URL')
key = os.getenv('SUPABASE_SERVICE_ROLE_KEY')
supabase: Client = create_client(url, key)

def is_youtube_short(duration, title='', description=''):
    """Check if video is a YouTube Short"""
    if duration:
        match = re.match(r'^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$', duration)
        if match:
            hours = int(match.group(1) or 0)
            minutes = int(match.group(2) or 0) 
            seconds = int(match.group(3) or 0)
            total_seconds = hours * 3600 + minutes * 60 + seconds
            if total_seconds <= 121:
                return True
    
    combined_text = (title + ' ' + description).lower()
    if '#shorts' in combined_text or '#youtubeshorts' in combined_text:
        return True
    
    return False

def power_law(x, a, b, c):
    """Power law: y = a * x^b + c"""
    return a * np.power(x + 1, b) + c  # +1 to avoid issues at x=0

def exponential_growth(x, a, b, c):
    """Exponential: y = a * (1 - exp(-b*x)) + c"""
    return a * (1 - np.exp(-b * x)) + c

def fit_curve_to_channel_data(channel_name):
    """Fit a curve to actual view tracking data"""
    
    print(f"Getting real data for: {channel_name}")
    
    # Get ALL videos and snapshots
    response = supabase.table('videos').select('''
        id,
        title,
        published_at,
        duration,
        description,
        view_snapshots (
            days_since_published,
            view_count,
            snapshot_date
        )
    ''').eq('channel_name', channel_name).execute()
    
    videos = response.data
    print(f"Found {len(videos)} total videos")
    
    # Collect all data points
    all_data_points = []
    
    for video in videos:
        # Skip shorts
        if is_youtube_short(video.get('duration', ''), video.get('title', ''), video.get('description', '')):
            continue
            
        if video.get('view_snapshots'):
            for snapshot in video['view_snapshots']:
                all_data_points.append({
                    'days': snapshot['days_since_published'],
                    'views': snapshot['view_count']
                })
    
    if not all_data_points:
        print("No data found!")
        return None
    
    df = pd.DataFrame(all_data_points)
    print(f"Total data points: {len(df)}")
    
    # Calculate median views at each day
    median_by_day = df.groupby('days')['views'].agg(['median', 'count', 'min', 'max']).reset_index()
    
    # Filter to days with enough data (at least 1 video)
    median_by_day = median_by_day[median_by_day['count'] >= 1]
    
    print(f"Days with sufficient data: {len(median_by_day)}")
    print(f"Day range: {median_by_day['days'].min()} to {median_by_day['days'].max()}")
    
    # Prepare data for curve fitting
    days = median_by_day['days'].values
    median_views = median_by_day['median'].values
    
    # Add a synthetic day 0 point (0 views)
    days = np.concatenate([[0], days])
    median_views = np.concatenate([[0], median_views])
    
    # Try to fit power law
    try:
        # Initial guess: a=1000, b=0.5, c=0
        popt, pcov = curve_fit(power_law, days, median_views, 
                              p0=[1000, 0.5, 0],
                              bounds=([0, 0, -np.inf], [np.inf, 2, np.inf]),
                              maxfev=5000)
        
        print(f"Fitted power law: y = {popt[0]:.1f} * (x+1)^{popt[1]:.3f} + {popt[2]:.1f}")
        
        # Generate smooth curve
        days_smooth = np.linspace(0, min(365, days.max()), 366)
        fitted_curve = power_law(days_smooth, *popt)
        
    except Exception as e:
        print(f"Curve fitting failed: {e}")
        # Fallback to simple interpolation
        f = interp1d(days, median_views, kind='linear', fill_value='extrapolate')
        days_smooth = np.linspace(0, min(365, days.max()), 366)
        fitted_curve = f(days_smooth)
    
    # Create the plot
    plt.figure(figsize=(14, 8))
    
    # Plot all raw data points
    plt.scatter(df['days'], df['views'], alpha=0.2, s=20, color='lightblue', 
                label='All data points')
    
    # Plot median points used for fitting
    plt.scatter(median_by_day['days'], median_by_day['median'], 
                color='blue', s=50, zorder=5,
                label=f'Median values (n≥3 videos)')
    
    # Plot the fitted curve
    plt.plot(days_smooth, fitted_curve, 'r-', linewidth=3,
             label='Fitted growth curve')
    
    # Add confidence bands based on data variance
    # Calculate 25th and 75th percentiles
    p25_by_day = df.groupby('days')['views'].quantile(0.25).reset_index()
    p75_by_day = df.groupby('days')['views'].quantile(0.75).reset_index()
    
    # Merge with days that have enough data
    p25_merged = pd.merge(median_by_day[['days']], p25_by_day, on='days', how='left')
    p75_merged = pd.merge(median_by_day[['days']], p75_by_day, on='days', how='left')
    
    if len(p25_merged) > 1 and len(p75_merged) > 1:
        # Interpolate percentile bands
        f_p25 = interp1d(p25_merged['days'], p25_merged['views'], 
                         kind='linear', fill_value='extrapolate')
        f_p75 = interp1d(p75_merged['days'], p75_merged['views'], 
                         kind='linear', fill_value='extrapolate')
        
        # Only plot bands where we have data
        band_days = days_smooth[days_smooth <= median_by_day['days'].max()]
        p25_band = np.maximum(0, f_p25(band_days))
        p75_band = f_p75(band_days)
        
        plt.fill_between(band_days, p25_band, p75_band, 
                        alpha=0.2, color='gray',
                        label='25th-75th percentile range')
    
    plt.xlabel('Days Since Published', fontsize=12)
    plt.ylabel('View Count', fontsize=12)
    plt.title(f'{channel_name}: Growth Curve Fitted to Real Data', fontsize=14, fontweight='bold')
    
    # Format y-axis
    ax = plt.gca()
    ax.yaxis.set_major_formatter(plt.FuncFormatter(lambda x, p: f'{int(x/1000)}K' if x >= 1000 else f'{int(x)}'))
    
    # Set reasonable limits
    plt.xlim(0, min(365, days.max() * 1.1))
    plt.ylim(0, fitted_curve.max() * 1.2)
    
    plt.legend()
    plt.grid(True, alpha=0.3)
    plt.tight_layout()
    
    # Save
    plt.savefig('/Users/brandoncullum/video-scripter/scripts/fitted_real_curve.png', 
                dpi=150, bbox_inches='tight')
    print("\\nCurve saved as 'fitted_real_curve.png'")
    
    # Print statistics
    print(f"\\nFitted curve values:")
    for d in [1, 7, 30, 90, 180, 365]:
        if d < len(fitted_curve):
            print(f"Day {d}: {int(fitted_curve[d]):,} views")
    
    return days_smooth, fitted_curve

if __name__ == "__main__":
    channel = "3x3Custom - Tamar"
    result = fit_curve_to_channel_data(channel)
    plt.show()