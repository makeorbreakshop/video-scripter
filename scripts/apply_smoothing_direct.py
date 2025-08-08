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
print("APPLYING 7-DAY SMOOTHING TO PERFORMANCE ENVELOPES")
print("=" * 60)

# Connect to database
conn = psycopg2.connect(DATABASE_URL)
cur = conn.cursor()

try:
    # Fetch all view snapshots
    print("\n📊 Fetching view snapshots from database...")
    query = """
    SELECT days_since_published, view_count
    FROM view_snapshots
    WHERE view_count IS NOT NULL
    AND days_since_published >= 0
    AND days_since_published <= 3650
    """
    
    cur.execute(query)
    snapshots = cur.fetchall()
    print(f"✅ Fetched {len(snapshots):,} snapshots")
    
    # Convert to DataFrame
    df = pd.DataFrame(snapshots, columns=['days_since_published', 'view_count'])
    print(f"📊 Unique days in data: {df['days_since_published'].nunique():,}")
    
    # Calculate percentiles for each day
    print("\n🔢 Calculating percentiles for each day...")
    percentiles = df.groupby('days_since_published')['view_count'].quantile([0.10, 0.25, 0.50, 0.75, 0.90]).unstack()
    percentiles.columns = ['p10_views', 'p25_views', 'p50_views', 'p75_views', 'p90_views']
    
    # Add sample count
    sample_counts = df.groupby('days_since_published').size()
    percentiles['sample_count'] = sample_counts
    
    # Filter days with at least 10 samples
    percentiles = percentiles[percentiles['sample_count'] >= 10]
    percentiles = percentiles.sort_index()
    print(f"✅ Calculated percentiles for {len(percentiles)} days")
    
    # Apply 7-day rolling average (centered window)
    print("\n🔄 Applying 7-day rolling average smoothing...")
    smoothed = percentiles.copy()
    for col in ['p10_views', 'p25_views', 'p50_views', 'p75_views', 'p90_views']:
        smoothed[f'{col}_smooth'] = percentiles[col].rolling(window=7, center=True, min_periods=1).mean()
        smoothed[f'{col}_smooth'] = smoothed[f'{col}_smooth'].round().astype(int)
    
    print("✅ Smoothing complete")
    
    # Show comparison
    print("\n📊 Sample comparison:")
    sample_days = [1, 7, 30, 90, 365]
    for day in sample_days:
        if day in smoothed.index:
            row = smoothed.loc[day]
            print(f"\nDay {day}:")
            print(f"  P50 Before: {row['p50_views']:,} views")
            print(f"  P50 After:  {row['p50_views_smooth']:,} views")
            change = ((row['p50_views_smooth'] - row['p50_views']) / row['p50_views'] * 100) if row['p50_views'] > 0 else 0
            print(f"  Change: {change:+.1f}%")
    
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
    cur.execute("SELECT * FROM performance_envelopes WHERE day_since_published = 7")
    result = cur.fetchone()
    if result:
        print(f"  Day 7 P50 (from DB): {result[3]:,} views")
    
    print("\n" + "=" * 60)
    print("SMOOTHING APPLIED SUCCESSFULLY!")
    print("Next steps:")
    print("1. Test single video: node scripts/test-single-video-update.js")
    print("2. Bulk update all videos: node scripts/bulk_update_video_scores.js")
    print("=" * 60)
    
except Exception as e:
    print(f"\n❌ Error: {e}")
    conn.rollback()
finally:
    cur.close()
    conn.close()