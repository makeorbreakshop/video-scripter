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
print("IMPLEMENTING TEMPORAL CHANNEL BASELINES")
print("Per-video baselines using last 10 videos with curve-based backfill")
print("=" * 60)

conn = psycopg2.connect(DATABASE_URL)
cur = conn.cursor()

try:
    # First, create the temporal baseline calculation function
    print("\n📊 Creating temporal baseline calculation function...")
    
    cur.execute("""
    CREATE OR REPLACE FUNCTION calculate_temporal_channel_baseline(
        p_video_id TEXT
    ) RETURNS NUMERIC AS $$
    DECLARE
        v_channel_id TEXT;
        v_published_at TIMESTAMP;
        v_channel_baseline NUMERIC;
        v_global_p30 NUMERIC;
    BEGIN
        -- Get video's channel and publish date
        SELECT channel_id, published_at
        INTO v_channel_id, v_published_at
        FROM videos
        WHERE id = p_video_id;
        
        IF v_channel_id IS NULL THEN
            RETURN NULL;
        END IF;
        
        -- Get global P50 at day 30 for baseline comparison
        SELECT p50_views INTO v_global_p30
        FROM performance_envelopes
        WHERE day_since_published = 30;
        
        -- Calculate channel baseline using last 10 videos before this one
        WITH previous_videos AS (
            -- Get the 10 videos published before this one from same channel
            SELECT 
                v.id,
                v.published_at,
                v.view_count as current_views,
                LEAST(3650, EXTRACT(DAY FROM NOW() - v.published_at)::INTEGER) as current_age,
                -- Get the most recent snapshot for each video
                vs.view_count as snapshot_views,
                vs.days_since_published as snapshot_age
            FROM videos v
            LEFT JOIN LATERAL (
                SELECT view_count, days_since_published
                FROM view_snapshots
                WHERE video_id = v.id
                AND days_since_published > 0
                ORDER BY snapshot_date DESC
                LIMIT 1
            ) vs ON true
            WHERE v.channel_id = v_channel_id
            AND v.published_at < v_published_at  -- Only videos published BEFORE this one
            AND v.is_short = false  -- Exclude Shorts
            ORDER BY v.published_at DESC
            LIMIT 10
        ),
        estimated_day30_views AS (
            SELECT 
                id,
                published_at,
                CASE
                    -- If we have actual day 30 data, use it
                    WHEN snapshot_age <= 30 THEN snapshot_views
                    -- Otherwise, estimate using the curve-based backfill
                    ELSE snapshot_views * (
                        v_global_p30::FLOAT / 
                        NULLIF((
                            SELECT p50_views 
                            FROM performance_envelopes 
                            WHERE day_since_published = LEAST(snapshot_age, 3650)
                        ), 0)
                    )
                END as estimated_day30
            FROM previous_videos
            WHERE snapshot_views IS NOT NULL
        )
        -- Calculate the median of estimated day-30 views for this channel
        SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY estimated_day30) / NULLIF(v_global_p30, 0)
        INTO v_channel_baseline
        FROM estimated_day30_views;
        
        -- If no previous videos or calculation failed, default to 1.0
        RETURN COALESCE(v_channel_baseline, 1.0);
    END;
    $$ LANGUAGE plpgsql;
    """)
    
    print("✅ Function created successfully")
    
    # Now create a batch update function for efficiency
    print("\n📊 Creating batch update function...")
    
    cur.execute("""
    CREATE OR REPLACE FUNCTION update_temporal_baselines_batch(
        batch_size INTEGER DEFAULT 1000
    ) RETURNS TABLE(videos_updated INTEGER, total_processed INTEGER) AS $$
    DECLARE
        v_updated INTEGER := 0;
        v_processed INTEGER := 0;
        v_batch_updated INTEGER;
    BEGIN
        LOOP
            -- Update a batch of videos
            WITH batch AS (
                SELECT id
                FROM videos
                WHERE is_short = false
                AND published_at IS NOT NULL
                AND channel_baseline_at_publish IS NULL
                ORDER BY published_at DESC, id
                LIMIT batch_size
            )
            UPDATE videos v
            SET 
                channel_baseline_at_publish = calculate_temporal_channel_baseline(v.id),
                updated_at = NOW()
            FROM batch b
            WHERE v.id = b.id;
            
            GET DIAGNOSTICS v_batch_updated = ROW_COUNT;
            
            EXIT WHEN v_batch_updated = 0;
            
            v_updated := v_updated + v_batch_updated;
            v_processed := v_processed + 1;
            
            -- Progress update
            IF v_processed % 10 = 0 THEN
                RAISE NOTICE 'Progress: % videos updated in % batches', v_updated, v_processed;
            END IF;
            
            -- Commit periodically to avoid long transactions
            IF v_processed % 50 = 0 THEN
                RAISE NOTICE 'Committing batch % (% videos so far)', v_processed, v_updated;
            END IF;
        END LOOP;
        
        RETURN QUERY SELECT v_updated, v_processed;
    END;
    $$ LANGUAGE plpgsql;
    """)
    
    print("✅ Batch update function created")
    
    # Test on a few specific videos first
    print("\n🧪 Testing on sample videos...")
    
    # Test on Kenji's channel
    cur.execute("""
        SELECT 
            v.id,
            v.title,
            v.published_at,
            v.view_count,
            calculate_temporal_channel_baseline(v.id) as calculated_baseline
        FROM videos v
        WHERE v.channel_id = 'UCj1VqrHhDte54oLgPG4xpuQ'  -- Kenji
        AND v.is_short = false
        ORDER BY v.published_at DESC
        LIMIT 5
    """)
    
    results = cur.fetchall()
    print("\n📊 J. Kenji López-Alt - Temporal Baselines (newest to oldest):")
    for r in results:
        print(f"  {r[2].strftime('%Y-%m-%d')}: {r[4]:.2f}x - {r[1][:50]}...")
    
    # Ask for confirmation before full update
    print("\n" + "=" * 60)
    print("READY TO CALCULATE TEMPORAL BASELINES")
    print("This will:")
    print("1. Calculate per-video baselines using last 10 videos")
    print("2. Use curve-based backfill for historical estimation")
    print("3. Process ~171,522 regular videos")
    print("4. May take 30-60 minutes for full dataset")
    print("=" * 60)
    
    response = input("\nProceed with full update? (yes/no): ")
    if response.lower() != 'yes':
        print("Update cancelled.")
        exit(0)
    
    # Run the batch update
    print("\n💾 Starting temporal baseline calculation...")
    cur.execute("SELECT * FROM update_temporal_baselines_batch(1000)")
    result = cur.fetchone()
    
    print(f"\n✅ Updated {result[0]:,} videos in {result[1]:,} batches")
    
    # Verify the results
    print("\n🔍 Verifying temporal baselines...")
    cur.execute("""
        SELECT 
            COUNT(*) as total_videos,
            COUNT(channel_baseline_at_publish) as videos_with_baseline,
            AVG(channel_baseline_at_publish) as avg_baseline,
            MIN(channel_baseline_at_publish) as min_baseline,
            MAX(channel_baseline_at_publish) as max_baseline,
            PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY channel_baseline_at_publish) as median_baseline
        FROM videos
        WHERE is_short = false
    """)
    
    stats = cur.fetchone()
    print(f"Total regular videos: {stats[0]:,}")
    print(f"Videos with baselines: {stats[1]:,}")
    print(f"Average baseline: {stats[2]:.2f}x")
    print(f"Median baseline: {stats[5]:.2f}x")
    print(f"Range: {stats[3]:.2f}x to {stats[4]:.2f}x")
    
    # Show channel evolution examples
    print("\n📊 Channel Evolution Examples:")
    
    for channel_id, channel_name in [
        ('UCj1VqrHhDte54oLgPG4xpuQ', 'J. Kenji López-Alt'),
        ('UCe0DNp0mKMqrYVaTundyr9w', 'VlogBrothers'),
        ('UC6107grRI4m0o2-emgoDnAA', 'SmarterEveryDay')
    ]:
        cur.execute("""
            WITH grouped AS (
                SELECT 
                    NTILE(4) OVER (ORDER BY published_at DESC) as quartile,
                    channel_baseline_at_publish
                FROM videos
                WHERE channel_id = %s
                AND is_short = false
                AND channel_baseline_at_publish IS NOT NULL
            )
            SELECT 
                quartile,
                AVG(channel_baseline_at_publish) as avg_baseline,
                COUNT(*) as video_count
            FROM grouped
            GROUP BY quartile
            ORDER BY quartile
        """, (channel_id,))
        
        results = cur.fetchall()
        if results:
            print(f"\n{channel_name}:")
            for q, baseline, count in results:
                period = ['Most Recent', 'Recent', 'Older', 'Oldest'][q-1]
                print(f"  {period:12}: {baseline:.2f}x ({count} videos)")
    
    conn.commit()
    
    print("\n" + "=" * 60)
    print("TEMPORAL BASELINES CALCULATED SUCCESSFULLY!")
    print("\nCompleted:")
    print("✅ Created temporal baseline calculation function")
    print("✅ Calculated per-video baselines using last 10 videos")
    print("✅ Applied curve-based backfill for historical estimation")
    print("\nNext steps:")
    print("1. Update video performance scores using temporal baselines")
    print("2. Create visualization to show channel evolution over time")
    print("=" * 60)
    
except Exception as e:
    print(f"\n❌ Error: {e}")
    conn.rollback()
    import traceback
    traceback.print_exc()
finally:
    cur.close()
    conn.close()