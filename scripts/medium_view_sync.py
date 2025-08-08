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
print("MEDIUM SPEED VIEW COUNT SYNC")
print("=" * 60)

conn = psycopg2.connect(DATABASE_URL)
cur = conn.cursor()

try:
    # Check how many still need updating
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
        WHERE v.view_count < ls.snapshot_views
    """)
    
    total_to_update = cur.fetchone()[0]
    print(f"Videos still needing update: {total_to_update:,}")
    
    if total_to_update == 0:
        print("✅ All videos already synced!")
        exit(0)
    
    # Use 10K batches - much faster but safer than single operation
    batch_size = 10000
    updated_count = 0
    batch_num = 0
    
    while True:
        print(f"\nProcessing batch {batch_num + 1} of ~{(total_to_update // batch_size) + 1}...")
        
        # Update in 10K chunks
        cur.execute("""
            WITH latest_snapshots AS (
                SELECT DISTINCT ON (video_id)
                    video_id,
                    view_count as snapshot_views
                FROM view_snapshots
                ORDER BY video_id, snapshot_date DESC
            ),
            batch_videos AS (
                SELECT v.id
                FROM videos v
                JOIN latest_snapshots ls ON v.id = ls.video_id
                WHERE v.view_count < ls.snapshot_views
                ORDER BY v.id
                LIMIT %s
            )
            UPDATE videos 
            SET 
                view_count = ls.snapshot_views,
                updated_at = NOW()
            FROM latest_snapshots ls, batch_videos bv
            WHERE videos.id = ls.video_id
            AND videos.id = bv.id
        """, (batch_size,))
        
        rows_updated = cur.rowcount
        if rows_updated == 0:
            break
            
        updated_count += rows_updated
        batch_num += 1
        
        print(f"✅ Updated {rows_updated:,} videos (Total: {updated_count:,}/{total_to_update:,})")
        
        # Commit each batch
        conn.commit()
        
        if updated_count >= total_to_update:
            break
    
    print(f"\n🎉 View sync complete! Updated {updated_count:,} videos total")
    
    # Now recalculate temporal scores in 5K batches
    print("\n💾 Recalculating temporal scores...")
    
    score_updated = 0
    score_batch_num = 0
    score_batch_size = 5000
    
    while True:
        cur.execute("""
            WITH batch AS (
                SELECT v.id
                FROM videos v
                WHERE v.published_at IS NOT NULL
                AND v.view_count IS NOT NULL
                AND v.channel_baseline_at_publish IS NOT NULL
                ORDER BY v.id
                LIMIT %s
                OFFSET %s
            )
            UPDATE videos v
            SET 
                temporal_performance_score = CASE 
                    WHEN pe.p50_views > 0 AND v.channel_baseline_at_publish > 0 THEN
                        v.view_count::FLOAT / (pe.p50_views * v.channel_baseline_at_publish)
                    ELSE NULL
                END,
                envelope_performance_category = CASE
                    WHEN (v.view_count::FLOAT / (pe.p50_views * v.channel_baseline_at_publish)) >= 3 THEN 'viral'
                    WHEN (v.view_count::FLOAT / (pe.p50_views * v.channel_baseline_at_publish)) >= 1.5 THEN 'outperforming'
                    WHEN (v.view_count::FLOAT / (pe.p50_views * v.channel_baseline_at_publish)) >= 0.5 THEN 'on_track'
                    WHEN (v.view_count::FLOAT / (pe.p50_views * v.channel_baseline_at_publish)) >= 0.2 THEN 'underperforming'
                    ELSE 'poor'
                END
            FROM batch b, performance_envelopes pe
            WHERE v.id = b.id
            AND pe.day_since_published = LEAST(3650, EXTRACT(DAY FROM NOW() - v.published_at)::INTEGER)
            AND pe.p50_views > 0
            AND v.channel_baseline_at_publish > 0
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
    print("🎉 ALL DONE! Videos synced and scores updated!")
    
except Exception as e:
    print(f"\n❌ Error: {e}")
    conn.rollback()
    import traceback
    traceback.print_exc()
finally:
    cur.close()
    conn.close()