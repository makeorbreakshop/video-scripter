#!/usr/bin/env python3

import os
import psycopg2
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    print("ERROR: DATABASE_URL not found in .env")
    exit(1)

print("=" * 60)
print("SIMPLE VIEW COUNT SYNC")
print("=" * 60)

conn = psycopg2.connect(DATABASE_URL)
cur = conn.cursor()

try:
    # Check how many need updating
    cur.execute("""
        WITH latest_snapshots AS (
            SELECT DISTINCT ON (video_id)
                video_id,
                view_count as snapshot_views
            FROM view_snapshots
            ORDER BY video_id, snapshot_date DESC
        )
        SELECT COUNT(*)
        FROM videos v
        JOIN latest_snapshots ls ON v.id = ls.video_id
        WHERE v.is_short = false
        AND v.view_count < ls.snapshot_views
    """)
    
    total_to_update = cur.fetchone()[0]
    print(f"Videos needing update: {total_to_update:,}")
    
    if total_to_update == 0:
        print("✅ No videos need updating!")
        exit(0)
    
    # Simple update in small batches
    batch_size = 1000
    updated_count = 0
    batch_num = 0
    
    while True:
        # Update batch
        cur.execute("""
            WITH latest_snapshots AS (
                SELECT DISTINCT ON (video_id)
                    video_id,
                    view_count as snapshot_views
                FROM view_snapshots
                ORDER BY video_id, snapshot_date DESC
            )
            UPDATE videos 
            SET 
                view_count = ls.snapshot_views,
                updated_at = NOW()
            FROM latest_snapshots ls
            WHERE videos.id = ls.video_id
            AND videos.is_short = false
            AND videos.view_count < ls.snapshot_views
            AND videos.id IN (
                SELECT v.id 
                FROM videos v
                JOIN latest_snapshots ls2 ON v.id = ls2.video_id
                WHERE v.is_short = false 
                AND v.view_count < ls2.snapshot_views
                ORDER BY v.id
                LIMIT %s
            )
        """, (batch_size,))
        
        rows_updated = cur.rowcount
        if rows_updated == 0:
            break
            
        updated_count += rows_updated
        batch_num += 1
        
        print(f"Batch {batch_num}: Updated {rows_updated:,} videos (Total: {updated_count:,}/{total_to_update:,})")
        
        # Commit each batch
        conn.commit()
        
        if updated_count >= total_to_update:
            break
    
    print(f"\n✅ Updated {updated_count:,} videos total")
    
    # Now recalculate temporal scores for updated videos
    print("\n💾 Recalculating temporal scores...")
    
    score_batch_size = 2000
    score_updated = 0
    score_batch_num = 0
    
    while True:
        cur.execute("""
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
                LIMIT %s
                OFFSET %s
            )
            UPDATE videos v
            SET 
                temporal_performance_score = CASE 
                    WHEN pe.p50_views > 0 AND b.channel_baseline_at_publish > 0 THEN
                        b.view_count::FLOAT / (pe.p50_views * b.channel_baseline_at_publish)
                    ELSE NULL
                END,
                envelope_performance_category = CASE
                    WHEN (b.view_count::FLOAT / (pe.p50_views * b.channel_baseline_at_publish)) >= 3 THEN 'viral'
                    WHEN (b.view_count::FLOAT / (pe.p50_views * b.channel_baseline_at_publish)) >= 1.5 THEN 'outperforming'
                    WHEN (b.view_count::FLOAT / (pe.p50_views * b.channel_baseline_at_publish)) >= 0.5 THEN 'on_track'
                    WHEN (b.view_count::FLOAT / (pe.p50_views * b.channel_baseline_at_publish)) >= 0.2 THEN 'underperforming'
                    ELSE 'poor'
                END
            FROM batch b
            LEFT JOIN performance_envelopes pe ON pe.day_since_published = b.age_days
            WHERE v.id = b.id
            AND pe.p50_views > 0
            AND b.channel_baseline_at_publish > 0
        """, (score_batch_size, score_batch_num * score_batch_size))
        
        rows_updated = cur.rowcount
        if rows_updated == 0:
            break
            
        score_updated += rows_updated
        score_batch_num += 1
        
        print(f"Score batch {score_batch_num}: Updated {rows_updated:,} scores (Total: {score_updated:,})")
        
        conn.commit()
        
        if rows_updated < score_batch_size:
            break
    
    print(f"\n✅ Recalculated {score_updated:,} temporal scores")
    
    # Final verification
    print("\n🔍 Final check...")
    cur.execute("""
        WITH latest_snapshots AS (
            SELECT DISTINCT ON (video_id)
                video_id,
                view_count as snapshot_views
            FROM view_snapshots
            ORDER BY video_id, snapshot_date DESC
        )
        SELECT COUNT(*)
        FROM videos v
        JOIN latest_snapshots ls ON v.id = ls.video_id
        WHERE v.is_short = false
        AND v.view_count < ls.snapshot_views
    """)
    
    remaining = cur.fetchone()[0]
    print(f"Videos still needing update: {remaining:,}")
    
    if remaining == 0:
        print("✅ All videos are now in sync!")
    
except Exception as e:
    print(f"\n❌ Error: {e}")
    conn.rollback()
    import traceback
    traceback.print_exc()
finally:
    cur.close()
    conn.close()