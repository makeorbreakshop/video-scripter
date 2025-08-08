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
    print("Please add the direct database connection string")
    exit(1)

print("=" * 60)
print("RECALCULATING PERFORMANCE ENVELOPES (EXCLUDING SHORTS)")
print("=" * 60)

# Connect to database
conn = psycopg2.connect(DATABASE_URL)
cur = conn.cursor()

try:
    # First, let's see the impact of excluding Shorts
    print("\n📊 Analyzing data composition...")
    
    cur.execute("""
        SELECT 
            COUNT(DISTINCT v.id) as total_videos,
            COUNT(DISTINCT CASE WHEN v.is_short = true THEN v.id END) as shorts_count,
            COUNT(DISTINCT CASE WHEN v.is_short = false THEN v.id END) as regular_count
        FROM videos v
        JOIN view_snapshots vs ON v.id = vs.video_id
    """)
    
    stats = cur.fetchone()
    print(f"Total videos with snapshots: {stats[0]:,}")
    print(f"Shorts: {stats[1]:,} ({stats[1]/stats[0]*100:.1f}%)")
    print(f"Regular videos: {stats[2]:,} ({stats[2]/stats[0]*100:.1f}%)")
    
    # Fetch view snapshots EXCLUDING Shorts
    print("\n📊 Fetching view snapshots (regular videos only)...")
    query = """
    SELECT vs.days_since_published, vs.view_count
    FROM view_snapshots vs
    JOIN videos v ON v.id = vs.video_id
    WHERE vs.view_count IS NOT NULL
    AND vs.days_since_published >= 0
    AND vs.days_since_published <= 3650
    AND v.is_short = false  -- EXCLUDE SHORTS
    """
    
    cur.execute(query)
    snapshots = cur.fetchall()
    print(f"✅ Fetched {len(snapshots):,} snapshots from regular videos")
    
    # Convert to DataFrame
    df = pd.DataFrame(snapshots, columns=['days_since_published', 'view_count'])
    print(f"📊 Unique days in data: {df['days_since_published'].nunique():,}")
    
    # Calculate percentiles for each day
    print("\n🔢 Calculating percentiles for each day (regular videos only)...")
    percentiles = df.groupby('days_since_published')['view_count'].quantile([0.10, 0.25, 0.50, 0.75, 0.90]).unstack()
    percentiles.columns = ['p10_views', 'p25_views', 'p50_views', 'p75_views', 'p90_views']
    
    # Add sample count
    sample_counts = df.groupby('days_since_published').size()
    percentiles['sample_count'] = sample_counts
    
    # Filter days with at least 10 samples
    percentiles = percentiles[percentiles['sample_count'] >= 10]
    percentiles = percentiles.sort_index()
    print(f"✅ Calculated percentiles for {len(percentiles)} days")
    
    # Get current envelope values for comparison
    print("\n📊 Comparing to current envelopes (with Shorts)...")
    cur.execute("""
        SELECT day_since_published, p10_views, p25_views, p50_views, p75_views, p90_views
        FROM performance_envelopes
        WHERE day_since_published IN (1, 7, 30, 90, 365)
        ORDER BY day_since_published
    """)
    current_envelopes = cur.fetchall()
    
    print("\nComparison (Current WITH Shorts vs New WITHOUT Shorts):")
    print("-" * 60)
    for row in current_envelopes:
        day = row[0]
        if day in percentiles.index:
            new_row = percentiles.loc[day]
            print(f"\nDay {day}:")
            print(f"  P10: {row[1]:,} → {int(new_row['p10_views']):,} ({(new_row['p10_views']/row[1]-1)*100:+.1f}%)")
            print(f"  P25: {row[2]:,} → {int(new_row['p25_views']):,} ({(new_row['p25_views']/row[2]-1)*100:+.1f}%)")
            print(f"  P50: {row[3]:,} → {int(new_row['p50_views']):,} ({(new_row['p50_views']/row[3]-1)*100:+.1f}%)")
            print(f"  P75: {row[4]:,} → {int(new_row['p75_views']):,} ({(new_row['p75_views']/row[4]-1)*100:+.1f}%)")
            print(f"  P90: {row[5]:,} → {int(new_row['p90_views']):,} ({(new_row['p90_views']/row[5]-1)*100:+.1f}%)")
    
    # Apply 7-day rolling average (centered window)
    print("\n🔄 Applying 7-day rolling average smoothing...")
    smoothed = percentiles.copy()
    for col in ['p10_views', 'p25_views', 'p50_views', 'p75_views', 'p90_views']:
        smoothed[f'{col}_smooth'] = percentiles[col].rolling(window=7, center=True, min_periods=1).mean()
        smoothed[f'{col}_smooth'] = smoothed[f'{col}_smooth'].round().astype(int)
    
    print("✅ Smoothing complete")
    
    # Show smoothed comparison
    print("\n📊 Final smoothed values (Shorts excluded + 7-day smoothing):")
    print("-" * 60)
    sample_days = [1, 7, 30, 90, 365]
    for day in sample_days:
        if day in smoothed.index:
            row = smoothed.loc[day]
            print(f"\nDay {day}:")
            print(f"  P10: {row['p10_views_smooth']:,} views")
            print(f"  P25: {row['p25_views_smooth']:,} views")
            print(f"  P50: {row['p50_views_smooth']:,} views")
            print(f"  P75: {row['p75_views_smooth']:,} views")
            print(f"  P90: {row['p90_views_smooth']:,} views")
            print(f"  Sample count: {row['sample_count']:,}")
    
    # Ask for confirmation before updating
    print("\n" + "=" * 60)
    print("READY TO UPDATE PERFORMANCE ENVELOPES")
    print("This will:")
    print("1. Replace ALL envelope values with Shorts-excluded data")
    print("2. Apply 7-day smoothing to reduce volatility")
    print("3. Affect all downstream calculations (channel ratios, video scores)")
    print("=" * 60)
    
    response = input("\nProceed with update? (yes/no): ")
    if response.lower() != 'yes':
        print("Update cancelled.")
        exit(0)
    
    # Update database
    print("\n💾 Updating performance_envelopes table...")
    
    # Prepare update data
    update_data = []
    for day in smoothed.index:
        row = smoothed.loc[day]
        update_data.append((
            int(day),  # day_since_published
            int(row['p10_views_smooth']),
            int(row['p25_views_smooth']),
            int(row['p50_views_smooth']),
            int(row['p75_views_smooth']),
            int(row['p90_views_smooth']),
            int(row['sample_count'])
        ))
    
    # Update using INSERT ON CONFLICT
    update_query = """
    INSERT INTO performance_envelopes 
    (day_since_published, p10_views, p25_views, p50_views, p75_views, p90_views, sample_count)
    VALUES %s
    ON CONFLICT (day_since_published) 
    DO UPDATE SET
        p10_views = EXCLUDED.p10_views,
        p25_views = EXCLUDED.p25_views,
        p50_views = EXCLUDED.p50_views,
        p75_views = EXCLUDED.p75_views,
        p90_views = EXCLUDED.p90_views,
        sample_count = EXCLUDED.sample_count,
        updated_at = NOW()
    """
    
    execute_values(cur, update_query, update_data)
    conn.commit()
    
    print(f"✅ Updated {len(update_data)} envelope records")
    
    # Verify the update
    print("\n🔍 Verifying update...")
    cur.execute("""
        SELECT day_since_published, p50_views, sample_count
        FROM performance_envelopes 
        WHERE day_since_published IN (1, 7, 30, 90, 365)
        ORDER BY day_since_published
    """)
    results = cur.fetchall()
    for row in results:
        print(f"  Day {row[0]:3}: P50 = {row[1]:,} views (n={row[2]:,})")
    
    print("\n" + "=" * 60)
    print("ENVELOPES RECALCULATED SUCCESSFULLY!")
    print("\nCompleted:")
    print("✅ Excluded Shorts from calculations")
    print("✅ Applied 7-day smoothing")
    print("✅ Updated performance_envelopes table")
    print("\nNext steps:")
    print("1. Recalculate channel performance ratios")
    print("2. Implement temporal baselines")
    print("3. Update all video scores")
    print("=" * 60)
    
except Exception as e:
    print(f"\n❌ Error: {e}")
    conn.rollback()
finally:
    cur.close()
    conn.close()