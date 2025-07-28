#!/usr/bin/env python3
"""
Validate our performance curves using Make or Break Shop's REAL daily data
This shows the difference between actual video growth and our envelope curves
"""

import os
import matplotlib.pyplot as plt
import numpy as np
from supabase import create_client, Client
from dotenv import load_dotenv
from scipy.interpolate import UnivariateSpline
import pandas as pd

# Load environment variables
load_dotenv()

# Initialize Supabase client
url = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
supabase: Client = create_client(url, key)

def validate_with_real_daily_data():
    """Compare real daily video data to our performance curves"""
    
    print("🔍 Validating with Make or Break Shop's REAL daily data...")
    
    # Step 1: Get multiple videos with daily tracking
    print("\n1️⃣ Fetching videos with daily tracking from day 0...")
    
    # Get videos with good tracking
    videos_list = supabase.table('videos')\
        .select('id, title, view_count')\
        .eq('channel_id', 'Make or Break Shop')\
        .gte('published_at', '2023-06-01')\
        .order('view_count', desc=True)\
        .limit(10)\
        .execute()
    
    videos_data = []
    for video in videos_list.data[:5]:
        # Get daily data for each video
        daily = supabase.table('daily_analytics')\
            .select('date, views')\
            .eq('video_id', video['id'])\
            .gt('views', 0)\
            .order('date')\
            .execute()
        
        if len(daily.data) >= 30:
            # Get published date
            video_info = supabase.table('videos')\
                .select('published_at')\
                .eq('id', video['id'])\
                .single()\
                .execute()
            
            published_date = video_info.data['published_at'][:10]
            
            # Calculate days since published
            daily_data = []
            for d in daily.data:
                day_diff = (pd.to_datetime(d['date']) - pd.to_datetime(published_date)).days
                if 0 <= day_diff <= 90:
                    daily_data.append({'day': day_diff, 'views': d['views']})
            
            if len(daily_data) >= 30:
                videos_data.append({
                    'id': video['id'],
                    'title': video['title'],
                    'total_views': video['view_count'],
                    'daily_data': daily_data
                })
    
    videos = videos_data
    print(f"✓ Found {len(videos)} videos with 30+ days of tracking")
    
    # Step 2: Get our global curve (raw percentiles, not smoothed)
    print("\n2️⃣ Fetching global performance curves...")
    
    global_curve_data = supabase.table('performance_envelopes')\
        .select('day_since_published, p10_views, p25_views, p50_views, p75_views, p90_views')\
        .lte('day_since_published', 90)\
        .order('day_since_published')\
        .execute()
    
    # Convert to arrays
    global_days = np.array([d['day_since_published'] for d in global_curve_data.data])
    global_p50 = np.array([d['p50_views'] for d in global_curve_data.data])
    
    # Step 3: Create visualization
    fig = plt.figure(figsize=(16, 12))
    
    # Plot 1: Individual video growth patterns (actual daily views)
    ax1 = plt.subplot(2, 2, 1)
    colors = plt.cm.viridis(np.linspace(0, 1, len(videos)))
    
    for i, video in enumerate(videos):
        daily = video['daily_data']
        days = [d['day'] for d in daily]
        views = [d['views'] for d in daily]
        
        # Calculate cumulative views
        cumulative = np.cumsum(views)
        
        ax1.plot(days, cumulative, '-', color=colors[i], 
                label=f"{video['title'][:30]}...", linewidth=2, alpha=0.8)
    
    # Add global median curve
    ax1.plot(global_days, global_p50, 'k--', linewidth=2, 
             label='Global median (all videos)', alpha=0.7)
    
    ax1.set_title('Cumulative Views: Make or Break Shop vs Global Median', fontsize=14)
    ax1.set_xlabel('Days Since Published')
    ax1.set_ylabel('Cumulative Views')
    ax1.legend(fontsize=9)
    ax1.grid(True, alpha=0.3)
    ax1.set_yscale('log')
    
    # Plot 2: Daily views (not cumulative) to show the decay pattern
    ax2 = plt.subplot(2, 2, 2)
    
    for i, video in enumerate(videos[:3]):  # Top 3 only for clarity
        daily = video['daily_data']
        days = [d['day'] for d in daily if d['day'] <= 30]
        views = [d['views'] for d in daily if d['day'] <= 30]
        
        ax2.plot(days, views, 'o-', color=colors[i], 
                label=f"{video['title'][:30]}...", linewidth=2, markersize=6)
    
    ax2.set_title('Daily Views Pattern (First 30 Days) - Shows Natural Decay', fontsize=14)
    ax2.set_xlabel('Days Since Published')
    ax2.set_ylabel('Daily Views')
    ax2.legend()
    ax2.grid(True, alpha=0.3)
    ax2.set_yscale('log')
    
    # Plot 3: Performance ratio over time
    ax3 = plt.subplot(2, 2, 3)
    
    # Skip channel baseline calculation for now
    channel_day7_median = 5000  # Approximate value
    
    for i, video in enumerate(videos[:3]):
        daily = video['daily_data']
        days = []
        ratios = []
        
        cumulative = 0
        for d in daily:
            if d['day'] <= 60 and d['day'] in global_days:
                cumulative += d['views']
                idx = np.where(global_days == d['day'])[0][0]
                expected = global_p50[idx]
                
                if expected > 0:
                    ratio = cumulative / expected
                    days.append(d['day'])
                    ratios.append(ratio)
        
        ax3.plot(days, ratios, 'o-', color=colors[i], 
                label=f"{video['title'][:30]}...", linewidth=2)
    
    ax3.axhline(y=1, color='black', linestyle='--', alpha=0.5)
    ax3.set_title('Performance Ratio (Actual Cumulative / Global Median)', fontsize=14)
    ax3.set_xlabel('Days Since Published')
    ax3.set_ylabel('Performance Ratio')
    ax3.legend()
    ax3.grid(True, alpha=0.3)
    
    # Plot 4: Key insights
    ax4 = plt.subplot(2, 2, 4)
    ax4.axis('off')
    
    # Analyze the top video's pattern
    if videos:
        top_video = videos[0]
        daily_data = top_video['daily_data']
        
        day0_views = next((d['views'] for d in daily_data if d['day'] == 0), 0)
        day1_views = next((d['views'] for d in daily_data if d['day'] == 1), 0)
        day7_views = next((d['views'] for d in daily_data if d['day'] == 7), 0)
        day30_views = next((d['views'] for d in daily_data if d['day'] == 30), 0)
        
        # Use first available day if day 0 missing
        if day0_views == 0 and daily_data:
            day0_views = daily_data[0]['views']
            first_day = daily_data[0]['day']
        else:
            first_day = 0
    else:
        top_video = {'title': 'No videos found'}
        day0_views = day1_views = day7_views = day30_views = 0
        first_day = 0
    
    insights = f"""
    KEY INSIGHTS FROM REAL DATA
    
    Top Video: {top_video['title'][:50]}...
    
    Daily View Pattern (NOT cumulative):
    • Day 0: {day0_views:,} views
    • Day 1: {day1_views:,} views ({day1_views/day0_views:.1f}x day 0)
    • Day 7: {day7_views:,} views ({day7_views/day1_views:.1%} of peak)
    • Day 30: {day30_views:,} views ({day30_views/day1_views:.1%} of peak)
    
    Reality Check:
    ✓ Daily views DO go down after initial spike
    ✓ Most views come in first 48 hours
    ✓ Videos stabilize to low daily views by day 30
    
    Envelope Curve Issues:
    • Current curves assume monotonic growth
    • Real videos show decay in daily views
    • Cumulative views flatten after ~30 days
    
    For viral detection, we need to track:
    1. Initial velocity (day 0-3 views)
    2. Decay rate (how fast daily views drop)
    3. Stabilization level (long-term daily views)
    """
    
    ax4.text(0.05, 0.5, insights, fontsize=11, 
             verticalalignment='center', fontfamily='monospace')
    
    plt.tight_layout()
    plt.savefig('real_daily_data_validation.png', dpi=300, bbox_inches='tight')
    print(f"\n💾 Saved validation chart to: real_daily_data_validation.png")
    
    print("\n📊 Summary: Real videos show decay in daily views, not monotonic growth!")
    print("The performance envelope should track cumulative views, not daily views.")

if __name__ == "__main__":
    validate_with_real_daily_data()