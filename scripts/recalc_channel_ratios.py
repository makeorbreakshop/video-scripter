#!/usr/bin/env python3

import os
import pandas as pd
import numpy as np
import psycopg2
from psycopg2.extras import execute_values
from dotenv import load_dotenv
from datetime import datetime

# Load environment variables
load_dotenv()

# Direct database connection
DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    print("ERROR: DATABASE_URL not found in .env")
    exit(1)

print("=" * 60)
print("RECALCULATING CHANNEL PERFORMANCE RATIOS")
print("Using new Shorts-excluded, smoothed envelopes")
print("=" * 60)

conn = psycopg2.connect(DATABASE_URL)
cur = conn.cursor()

try:
    # First, let's see current state
    print("\n📊 Analyzing current channel ratios...")
    
    cur.execute("""
        SELECT 
            COUNT(DISTINCT channel_id) as total_channels,
            COUNT(DISTINCT CASE WHEN channel_performance_ratio IS NOT NULL THEN channel_id END) as channels_with_ratio,
            AVG(channel_performance_ratio) as avg_ratio,
            MIN(channel_performance_ratio) as min_ratio,
            MAX(channel_performance_ratio) as max_ratio
        FROM videos
        WHERE is_short = false
    """)
    
    stats = cur.fetchone()
    print(f"Total channels (regular videos): {stats[0]:,}")
    print(f"Channels with ratios: {stats[1]:,}")
    if stats[2]:
        print(f"Current avg ratio: {stats[2]:.2f}x")
        print(f"Current range: {stats[3]:.2f}x to {stats[4]:.2f}x")
    
    # Get the new global P50 at day 30 for baseline calculation
    print("\n📊 Getting new global baseline (day 30 P50)...")
    cur.execute("""
        SELECT p50_views 
        FROM performance_envelopes 
        WHERE day_since_published = 30
    """)
    global_p50_day30 = cur.fetchone()[0]
    print(f"Global P50 at day 30: {global_p50_day30:,} views")
    
    # Calculate channel ratios based on first-week performance
    print("\n🔢 Calculating channel performance ratios...")
    print("Method: Median of first 30-day views ÷ Global P50")
    
    # Get channels with sufficient data
    query = """
    WITH channel_early_performance AS (
        SELECT 
            v.channel_id,
            v.channel_title,
            -- Get median views of videos in their first 30 days
            PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY 
                CASE 
                    WHEN vs.days_since_published <= 30 THEN vs.view_count
                    -- For older videos, estimate day-30 views using the curve
                    ELSE vs.view_count * (
                        (SELECT p50_views FROM performance_envelopes WHERE day_since_published = 30)::float /
                        NULLIF((SELECT p50_views FROM performance_envelopes WHERE day_since_published = vs.days_since_published), 0)
                    )
                END
            ) as median_day30_views,
            COUNT(DISTINCT v.id) as video_count,
            MIN(v.published_at) as first_video,
            MAX(v.published_at) as last_video
        FROM videos v
        JOIN view_snapshots vs ON v.id = vs.video_id
        WHERE v.is_short = false
        AND vs.days_since_published > 0
        GROUP BY v.channel_id, v.channel_title
        HAVING COUNT(DISTINCT v.id) >= 5  -- Need at least 5 videos for reliable ratio
    )
    SELECT 
        channel_id,
        channel_title,
        median_day30_views,
        median_day30_views / %s as performance_ratio,
        video_count,
        first_video,
        last_video
    FROM channel_early_performance
    ORDER BY performance_ratio DESC
    """
    
    cur.execute(query, (global_p50_day30,))
    channels = cur.fetchall()
    
    print(f"✅ Calculated ratios for {len(channels)} channels")
    
    # Show top and bottom performers
    print("\n📊 Sample channel ratios (NEW):")
    print("-" * 60)
    print("Top 5 channels:")
    for i in range(min(5, len(channels))):
        ch = channels[i]
        print(f"  {ch[1][:30]:30} {ch[3]:7.2f}x ({ch[4]:3} videos)")
    
    print("\nBottom 5 channels:")
    for i in range(max(0, len(channels)-5), len(channels)):
        ch = channels[i]
        print(f"  {ch[1][:30]:30} {ch[3]:7.2f}x ({ch[4]:3} videos)")
    
    # Prepare bulk update
    print("\n💾 Preparing bulk update...")
    update_data = [(float(ch[3]), ch[0]) for ch in channels]
    
    # First, clear existing ratios to see the full impact
    print("Clearing old ratios...")
    cur.execute("""
        UPDATE videos 
        SET channel_performance_ratio = NULL,
            updated_at = NOW()
        WHERE is_short = false
    """)
    print(f"Cleared {cur.rowcount} video ratios")
    
    # Now update with new ratios
    print("Applying new ratios...")
    update_query = """
        UPDATE videos 
        SET channel_performance_ratio = data.ratio,
            updated_at = NOW()
        FROM (VALUES %s) AS data(ratio, channel_id)
        WHERE videos.channel_id = data.channel_id
        AND videos.is_short = false
    """
    
    execute_values(cur, update_query, update_data, template='(%s, %s)')
    updated_count = cur.rowcount
    
    conn.commit()
    print(f"✅ Updated {updated_count:,} video records")
    
    # Verify the update
    print("\n🔍 Verifying update...")
    cur.execute("""
        SELECT 
            COUNT(DISTINCT channel_id) as channels_updated,
            COUNT(*) as videos_updated,
            AVG(channel_performance_ratio) as new_avg_ratio,
            MIN(channel_performance_ratio) as new_min_ratio,
            MAX(channel_performance_ratio) as new_max_ratio
        FROM videos
        WHERE channel_performance_ratio IS NOT NULL
        AND is_short = false
    """)
    
    verify = cur.fetchone()
    print(f"Channels with ratios: {verify[0]:,}")
    print(f"Videos with ratios: {verify[1]:,}")
    print(f"New avg ratio: {verify[2]:.2f}x")
    print(f"New range: {verify[3]:.2f}x to {verify[4]:.2f}x")
    
    # Show specific channel examples
    print("\n📊 Example channels (before → after):")
    example_channels = [
        'UC6107grRI4m0o2-emgoDnAA',  # SmarterEveryDay
        'UCj1VqrHhDte54oLgPG4xpuQ',  # J. Kenji López-Alt
        'UCe0DNp0mKMqrYVaTundyr9w',  # VlogBrothers
    ]
    
    for channel_id in example_channels:
        cur.execute("""
            SELECT channel_title, channel_performance_ratio
            FROM videos
            WHERE channel_id = %s
            AND is_short = false
            LIMIT 1
        """, (channel_id,))
        result = cur.fetchone()
        if result:
            print(f"  {result[0]}: {result[1]:.2f}x")
    
    print("\n" + "=" * 60)
    print("CHANNEL RATIOS RECALCULATED SUCCESSFULLY!")
    print("\nCompleted:")
    print("✅ Used new Shorts-excluded, smoothed envelopes")
    print("✅ Calculated ratios for channels with 5+ videos")
    print("✅ Updated all regular video records")
    print("\nNext steps:")
    print("1. Implement temporal baselines (per-video)")
    print("2. Update all video performance scores")
    print("=" * 60)
    
except Exception as e:
    print(f"\n❌ Error: {e}")
    conn.rollback()
    import traceback
    traceback.print_exc()
finally:
    cur.close()
    conn.close()