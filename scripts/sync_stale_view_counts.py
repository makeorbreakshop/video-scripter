#!/usr/bin/env python3

import os
import psycopg2
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
print("SYNCING STALE VIEW COUNTS FROM SNAPSHOTS")
print("This will fix the discrepancy between videos and view_snapshots")
print("=" * 60)

conn = psycopg2.connect(DATABASE_URL)
cur = conn.cursor()

try:
    # First, check the extent of the problem
    print("\n📊 Analyzing stale data...")
    
    cur.execute("""
        WITH latest_snapshots AS (
            SELECT DISTINCT ON (video_id)
                video_id,
                view_count as snapshot_views,
                snapshot_date
            FROM view_snapshots
            ORDER BY video_id, snapshot_date DESC
        )
        SELECT 
            COUNT(*) as total_videos,
            COUNT(CASE WHEN v.view_count != ls.snapshot_views THEN 1 END) as stale_count,
            COUNT(CASE WHEN v.view_count < ls.snapshot_views THEN 1 END) as needs_update,
            AVG(CASE 
                WHEN v.view_count < ls.snapshot_views 
                THEN ls.snapshot_views - v.view_count 
                ELSE 0 
            END) as avg_views_behind
        FROM videos v
        JOIN latest_snapshots ls ON v.id = ls.video_id
        WHERE v.is_short = false
    """)
    
    stats = cur.fetchone()
    print(f"Total videos with snapshots: {stats[0]:,}")
    print(f"Videos with stale data: {stats[1]:,} ({stats[1]/stats[0]*100:.1f}%)")
    print(f"Videos needing update: {stats[2]:,}")
    print(f"Average views behind: {stats[3]:,.0f}")
    
    if stats[2] == 0:
        print("\n✅ No videos need updating!")
        exit(0)
    
    # Create the sync function
    print("\n📊 Creating sync function...")
    
    cur.execute("""
    CREATE OR REPLACE FUNCTION sync_video_view_counts(
        batch_size INTEGER DEFAULT 5000
    ) RETURNS TABLE(
        updated_count INTEGER, 
        total_processed INTEGER,
        avg_change NUMERIC
    ) AS $$
    DECLARE
        v_updated INTEGER := 0;
        v_batch INTEGER := 0;
        v_batch_updated INTEGER;
        v_total_change BIGINT := 0;
        v_batch_change BIGINT;
    BEGIN
        LOOP
            -- Update a batch of videos with their latest snapshot
            WITH latest_snapshots AS (
                SELECT DISTINCT ON (video_id)
                    video_id,
                    view_count as snapshot_views,
                    snapshot_date
                FROM view_snapshots
                WHERE video_id IN (
                    SELECT id 
                    FROM videos 
                    WHERE is_short = false
                    ORDER BY id
                    LIMIT batch_size
                    OFFSET v_batch * batch_size
                )
                ORDER BY video_id, snapshot_date DESC
            ),
            updates AS (
                UPDATE videos v
                SET 
                    view_count = ls.snapshot_views,
                    updated_at = NOW()
                FROM latest_snapshots ls
                WHERE v.id = ls.video_id
                AND v.view_count != ls.snapshot_views  -- Only update if different
                AND v.view_count < ls.snapshot_views   -- Only update if snapshot is newer
                RETURNING 
                    v.id,
                    ls.snapshot_views - v.view_count as view_change
            )
            SELECT 
                COUNT(*),
                COALESCE(SUM(view_change), 0)
            INTO v_batch_updated, v_batch_change
            FROM updates;
            
            EXIT WHEN v_batch_updated = 0 AND v_batch > 0;
            
            v_updated := v_updated + v_batch_updated;
            v_total_change := v_total_change + v_batch_change;
            v_batch := v_batch + 1;
            
            -- Progress update
            IF v_batch % 10 = 0 THEN
                RAISE NOTICE 'Progress: % videos updated in % batches', v_updated, v_batch;
            END IF;
        END LOOP;
        
        RETURN QUERY SELECT 
            v_updated, 
            v_batch,
            CASE 
                WHEN v_updated > 0 THEN v_total_change::NUMERIC / v_updated
                ELSE 0
            END;
    END;
    $$ LANGUAGE plpgsql;
    """)
    
    print("✅ Sync function created")
    
    # Now create function to recalculate temporal scores after sync
    print("\n📊 Creating score recalculation function...")
    
    cur.execute("""
    CREATE OR REPLACE FUNCTION recalculate_temporal_scores_after_sync(
        batch_size INTEGER DEFAULT 5000
    ) RETURNS TABLE(updated_count INTEGER, batch_count INTEGER) AS $$
    DECLARE
        v_updated INTEGER := 0;
        v_batch INTEGER := 0;
        v_batch_updated INTEGER;
    BEGIN
        LOOP
            -- Recalculate temporal scores with updated view counts
            WITH batch AS (
                SELECT 
                    v.id,
                    v.view_count,
                    v.channel_baseline_at_publish,
                    LEAST(3650, EXTRACT(DAY FROM NOW() - v.published_at)::INTEGER) as age_days
                FROM videos v
                WHERE v.is_short = false
                AND v.published_at IS NOT NULL
                AND v.view_count IS NOT NULL
                AND v.channel_baseline_at_publish IS NOT NULL
                ORDER BY v.id
                LIMIT batch_size
                OFFSET v_batch * batch_size
            ),
            scores AS (
                SELECT 
                    b.id,
                    b.view_count,
                    b.channel_baseline_at_publish,
                    pe.p50_views as global_median,
                    CASE 
                        WHEN pe.p50_views > 0 AND b.channel_baseline_at_publish > 0 THEN
                            b.view_count::FLOAT / (pe.p50_views * b.channel_baseline_at_publish)
                        ELSE NULL
                    END as score
                FROM batch b
                LEFT JOIN performance_envelopes pe ON pe.day_since_published = b.age_days
            )
            UPDATE videos v
            SET 
                temporal_performance_score = s.score,
                envelope_performance_category = CASE
                    WHEN s.score >= 3 THEN 'viral'
                    WHEN s.score >= 1.5 THEN 'outperforming'
                    WHEN s.score >= 0.5 THEN 'on_track'
                    WHEN s.score >= 0.2 THEN 'underperforming'
                    ELSE 'poor'
                END
            FROM scores s
            WHERE v.id = s.id
            AND s.score IS NOT NULL;
            
            GET DIAGNOSTICS v_batch_updated = ROW_COUNT;
            
            EXIT WHEN v_batch_updated = 0;
            
            v_updated := v_updated + v_batch_updated;
            v_batch := v_batch + 1;
            
            IF v_batch % 10 = 0 THEN
                RAISE NOTICE 'Score recalc progress: % videos in % batches', v_updated, v_batch;
            END IF;
        END LOOP;
        
        RETURN QUERY SELECT v_updated, v_batch;
    END;
    $$ LANGUAGE plpgsql;
    """)
    
    print("✅ Score recalculation function created")
    
    # Show what will happen
    print("\n" + "=" * 60)
    print("READY TO SYNC VIEW COUNTS")
    print("=" * 60)
    print("\nThis will:")
    print(f"1. Update ~{stats[2]:,} videos with their latest snapshot views")
    print("2. Add an average of {stats[3]:,.0f} views per video")
    print("3. Then recalculate all temporal performance scores")
    print("\nEstimated time: 5-10 minutes")
    print("\nTo execute, uncomment the execution lines below")
    print("=" * 60)
    
    # EXECUTE THE SYNC:
    print("\n💾 Starting view count sync...")
    cur.execute("SELECT * FROM sync_video_view_counts(5000)")
    sync_result = cur.fetchone()
    print(f"✅ Updated {sync_result[0]:,} videos in {sync_result[1]} batches")
    print(f"   Average view increase: {sync_result[2]:,.0f}")
    
    conn.commit()
    
    print("\n💾 Recalculating temporal scores...")
    cur.execute("SELECT * FROM recalculate_temporal_scores_after_sync(5000)")
    score_result = cur.fetchone()
    print(f"✅ Recalculated {score_result[0]:,} scores in {score_result[1]} batches")
    
    conn.commit()
    
    # Verify the results would be correct
    print("\n🔍 Sample of what will change:")
    
    cur.execute("""
        WITH latest_snapshots AS (
            SELECT DISTINCT ON (video_id)
                video_id,
                view_count as snapshot_views
            FROM view_snapshots
            ORDER BY video_id, snapshot_date DESC
        )
        SELECT 
            v.title,
            v.channel_name,
            v.view_count as old_views,
            ls.snapshot_views as new_views,
            ls.snapshot_views - v.view_count as increase,
            v.temporal_performance_score as old_score,
            ls.snapshot_views::FLOAT / (pe.p50_views * v.channel_baseline_at_publish) as new_score
        FROM videos v
        JOIN latest_snapshots ls ON v.id = ls.video_id
        JOIN performance_envelopes pe ON pe.day_since_published = 
            LEAST(3650, EXTRACT(DAY FROM NOW() - v.published_at)::INTEGER)
        WHERE v.is_short = false
        AND v.view_count < ls.snapshot_views
        AND v.channel_baseline_at_publish IS NOT NULL
        ORDER BY ls.snapshot_views - v.view_count DESC
        LIMIT 5
    """)
    
    examples = cur.fetchall()
    for ex in examples:
        print(f"\n  '{ex[0][:40]}...' by {ex[1]}")
        print(f"    Views: {ex[2]:,} → {ex[3]:,} (+{ex[4]:,})")
        print(f"    Score: {ex[5]:.2f}x → {ex[6]:.2f}x")
    
except Exception as e:
    print(f"\n❌ Error: {e}")
    conn.rollback()
    import traceback
    traceback.print_exc()
finally:
    cur.close()
    conn.close()