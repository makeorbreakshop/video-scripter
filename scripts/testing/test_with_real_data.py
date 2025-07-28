#!/usr/bin/env python3
"""
Test the performance envelope with actual Supabase data
"""

import os
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
from supabase import create_client, Client
from datetime import datetime, timedelta
from dotenv import load_dotenv
from performance_envelope_prototype import (
    get_channel_data, 
    calculate_performance_envelope,
    smooth_envelope,
    plot_performance_envelope
)

# Load environment variables
load_dotenv()

def test_with_minimal_data():
    """Test with a small amount of real data"""
    
    print("Testing with real Supabase data...")
    
    # Try to get some data
    df, video_info = get_channel_data("3x3Custom - Tamar", baseline_days=365*5, min_videos=1)
    
    if df is None or len(df) == 0:
        print("No data found!")
        return
    
    print(f"Data found: {len(df)} snapshots from {df['video_id'].nunique()} videos")
    print(f"Age range: {df['days_since_published'].min()} to {df['days_since_published'].max()} days")
    print(f"View range: {df['view_count'].min():,} to {df['view_count'].max():,} views")
    
    # Show data distribution
    print("\nData by age:")
    age_dist = df.groupby('days_since_published').agg({
        'view_count': ['count', 'min', 'max', 'mean']
    }).round(0)
    print(age_dist.head(10))
    
    # Try envelope calculation
    print("\nCalculating performance envelope...")
    daily_stats = calculate_performance_envelope(df, max_days=100)
    
    if len(daily_stats) == 0:
        print("No daily stats calculated!")
        return
    
    print(f"Envelope calculated for {len(daily_stats)} days")
    print(daily_stats.head())
    
    # Try smoothing
    print("\nSmoothing envelope...")
    smooth_stats = smooth_envelope(daily_stats)
    print(f"Smooth envelope has {len(smooth_stats)} points")
    
    if len(smooth_stats) > 0:
        print(smooth_stats.head())
    
    # Simple plot
    plt.figure(figsize=(12, 6))
    
    # Plot raw data
    plt.subplot(1, 2, 1)
    plt.scatter(df['days_since_published'], df['view_count'], alpha=0.5, s=20)
    plt.xlabel('Days Since Published')
    plt.ylabel('Views')
    plt.title('Raw Snapshot Data')
    plt.yscale('log')
    
    # Plot envelope if we have enough data
    plt.subplot(1, 2, 2)
    if len(daily_stats) > 1:
        plt.fill_between(daily_stats['days_since_published'], 
                        daily_stats['p25'], daily_stats['p75'],
                        alpha=0.3, color='gray', label='25th-75th percentile')
        plt.plot(daily_stats['days_since_published'], daily_stats['p50'], 
                color='red', label='Median')
        plt.xlabel('Days Since Published')
        plt.ylabel('Views')
        plt.title('Performance Envelope')
        plt.legend()
    else:
        plt.text(0.5, 0.5, 'Not enough data\nfor envelope', 
                transform=plt.gca().transAxes, ha='center', va='center')
    
    plt.tight_layout()
    plt.savefig('/Users/brandoncullum/video-scripter/scripts/envelope_test.png', dpi=150, bbox_inches='tight')
    print("\nPlot saved as 'envelope_test.png'")
    
    return df, daily_stats, smooth_stats

if __name__ == "__main__":
    result = test_with_minimal_data()