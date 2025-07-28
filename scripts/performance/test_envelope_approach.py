#!/usr/bin/env python3
"""
Test script to validate the performance envelope approach
This will run the core calculations and show sample results without database writes
"""

import os
import sys
import numpy as np
import pandas as pd
from datetime import datetime
from dotenv import load_dotenv
from supabase import create_client, Client
import re

# Load environment variables
load_dotenv()

SUPABASE_URL = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    print("❌ Missing environment variables")
    sys.exit(1)

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

def parse_duration_to_seconds(duration: str) -> int:
    """Parse ISO 8601 duration format to seconds"""
    if not duration:
        return 0
    
    match = re.match(r'PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?', duration)
    if not match:
        return 0
    
    hours = int(match.group(1) or 0)
    minutes = int(match.group(2) or 0) 
    seconds = int(match.group(3) or 0)
    
    return hours * 3600 + minutes * 60 + seconds

def test_data_quality():
    """Test our data quality and show key statistics"""
    print("🔍 Testing Data Quality")
    print("=" * 50)
    
    # Get basic snapshot statistics
    query = """
    SELECT 
        COUNT(*) as total_snapshots,
        COUNT(DISTINCT video_id) as unique_videos,
        MIN(days_since_published) as min_day,
        MAX(days_since_published) as max_day,
        AVG(view_count) as avg_views
    FROM view_snapshots vs
    JOIN videos v ON vs.video_id = v.id
    WHERE v.duration IS NOT NULL 
    """
    
    result = supabase.rpc('execute_sql', {'query': query}).execute()
    stats = result.data[0]
    
    print(f"📊 Total snapshots: {stats['total_snapshots']:,}")
    print(f"🎥 Unique videos: {stats['unique_videos']:,}")
    print(f"📅 Day range: {stats['min_day']} to {stats['max_day']}")
    print(f"👁️ Average views: {stats['avg_views']:,.0f}")
    
    return stats

def test_duration_filtering():
    """Test our Shorts filtering logic"""
    print("\n🎬 Testing Duration Filtering")
    print("=" * 50)
    
    query = """
    SELECT 
        v.duration,
        COUNT(*) as video_count
    FROM videos v
    WHERE duration IS NOT NULL
    GROUP BY v.duration
    ORDER BY COUNT(*) DESC
    LIMIT 20
    """
    
    result = supabase.rpc('execute_sql', {'query': query}).execute()
    
    shorts_count = 0
    long_form_count = 0
    
    print("Duration samples:")
    for row in result.data[:10]:
        duration = row['duration']
        count = row['video_count']
        seconds = parse_duration_to_seconds(duration)
        is_short = seconds <= 121
        
        if is_short:
            shorts_count += count
        else:
            long_form_count += count
            
        print(f"  {duration} -> {seconds}s ({'SHORT' if is_short else 'KEEP'}) - {count} videos")
    
    print(f"\n📱 Estimated Shorts: {shorts_count:,}")
    print(f"🎥 Estimated Long-form: {long_form_count:,}")
    
    return shorts_count, long_form_count

def test_early_day_coverage():
    """Test coverage for early days (0-30)"""
    print("\n📈 Testing Early Day Coverage")
    print("=" * 50)
    
    query = """
    SELECT 
        vs.days_since_published,
        COUNT(DISTINCT vs.video_id) as unique_videos,
        COUNT(*) as total_snapshots,
        ROUND(AVG(vs.view_count)) as avg_views,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY vs.view_count) as median_views
    FROM view_snapshots vs
    JOIN videos v ON vs.video_id = v.id
    WHERE v.duration IS NOT NULL 
      AND vs.days_since_published <= 30
    GROUP BY vs.days_since_published
    ORDER BY vs.days_since_published
    """
    
    result = supabase.rpc('execute_sql', {'query': query}).execute()
    
    print("Early days coverage:")
    good_days = 0
    for row in result.data[:11]:  # Show first 10 days
        day = row['days_since_published']
        videos = row['unique_videos']
        snapshots = row['total_snapshots']
        median = row['median_views']
        
        if videos >= 30:  # Our minimum threshold
            good_days += 1
            status = "✅ GOOD"
        else:
            status = "⚠️ LOW"
            
        print(f"  Day {day:2d}: {videos:3d} videos, {snapshots:3d} snapshots, median: {median:,} views {status}")
    
    print(f"\nDays with 30+ videos: {good_days}/31")
    return good_days

def test_tier_bias():
    """Test for tier-based selection bias"""
    print("\n⚖️ Testing Tier Bias")
    print("=" * 50)
    
    query = """
    SELECT 
        vtp.tier,
        COUNT(DISTINCT vs.video_id) as unique_videos,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY vs.view_count) as median_views,
        AVG(vs.view_count) as avg_views
    FROM view_snapshots vs
    JOIN view_tracking_priority vtp ON vs.video_id = vtp.video_id
    WHERE vs.days_since_published <= 30
    GROUP BY vtp.tier
    ORDER BY vtp.tier
    """
    
    result = supabase.rpc('execute_sql', {'query': query}).execute()
    
    print("Tier performance distribution:")
    tier_medians = {}
    for row in result.data:
        tier = row['tier']
        videos = row['unique_videos']
        median = row['median_views']
        avg = row['avg_views']
        
        tier_medians[tier] = median
        print(f"  Tier {tier}: {videos:,} videos, median: {median:,} views, avg: {avg:,.0f}")
    
    # Calculate bias correction weights
    if tier_medians:
        min_median = min(tier_medians.values())
        print(f"\nBias correction weights (based on min median: {min_median:,}):")
        for tier, median in tier_medians.items():
            weight = min_median / median
            print(f"  Tier {tier}: weight = {weight:.3f}")
    
    return tier_medians

def test_sample_percentiles():
    """Calculate sample percentiles for a few early days"""
    print("\n📊 Testing Sample Percentiles")
    print("=" * 50)
    
    test_days = [0, 1, 7, 14, 30]
    
    for day in test_days:
        query = f"""
        SELECT view_count
        FROM view_snapshots vs
        JOIN videos v ON vs.video_id = v.id
        WHERE v.duration IS NOT NULL 
          AND vs.days_since_published = {day}
        ORDER BY view_count
        """
        
        result = supabase.rpc('execute_sql', {'query': query}).execute()
        views = [row['view_count'] for row in result.data]
        
        if len(views) >= 10:
            p25 = np.percentile(views, 25)
            p50 = np.percentile(views, 50)
            p75 = np.percentile(views, 75)
            
            print(f"Day {day:2d}: {len(views):3d} videos | p25: {p25:8,.0f} | p50: {p50:8,.0f} | p75: {p75:8,.0f}")
        else:
            print(f"Day {day:2d}: {len(views):3d} videos | Too few for reliable percentiles")

def main():
    """Run all tests"""
    print("🚀 Testing YouTube Performance Envelope Approach")
    print("=" * 60)
    
    try:
        # Run all tests
        test_data_quality()
        test_duration_filtering()
        good_days = test_early_day_coverage()
        tier_medians = test_tier_bias()
        test_sample_percentiles()
        
        # Final assessment
        print("\n" + "=" * 60)
        print("🎯 ASSESSMENT SUMMARY")
        print("=" * 60)
        
        if good_days >= 20:
            print("✅ Data Quality: EXCELLENT - Sufficient coverage for reliable percentiles")
        elif good_days >= 10:
            print("⚠️ Data Quality: GOOD - Adequate coverage with some interpolation needed")
        else:
            print("❌ Data Quality: POOR - May need different approach")
            
        if tier_medians:
            max_bias = max(tier_medians.values()) / min(tier_medians.values())
            if max_bias > 5:
                print("⚠️ Selection Bias: HIGH - Tier weighting correction essential")
            else:
                print("✅ Selection Bias: MANAGEABLE - Tier weighting will help")
        
        print("🎉 Ready to proceed with full envelope calculation!")
        
    except Exception as e:
        print(f"❌ Error during testing: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()