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
print("FAST VIEW COUNT SYNC")
print("=" * 60)

conn = psycopg2.connect(DATABASE_URL)
cur = conn.cursor()

try:
    print(f"Starting fast sync with 10K batches...")
    
    # Direct bulk update - much faster
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
    """)
    
    updated_count = cur.rowcount
    print(f"✅ Updated {updated_count:,} videos in single operation!")
    
    conn.commit()
    
    print(f"\n💾 Recalculating temporal scores for all videos...")
    
    # Fast score recalculation 
    cur.execute("""
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
        FROM performance_envelopes pe
        WHERE v.is_short = false
        AND v.published_at IS NOT NULL
        AND v.view_count IS NOT NULL
        AND v.channel_baseline_at_publish IS NOT NULL
        AND pe.day_since_published = LEAST(3650, EXTRACT(DAY FROM NOW() - v.published_at)::INTEGER)
        AND pe.p50_views > 0
        AND v.channel_baseline_at_publish > 0
    """)
    
    score_updated = cur.rowcount
    print(f"✅ Recalculated {score_updated:,} temporal scores in single operation!")
    
    conn.commit()
    
    # Final verification
    print("\n🔍 Final verification...")
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
        print("✅ ALL VIDEOS ARE NOW IN SYNC!")
        print("✅ ALL TEMPORAL SCORES UPDATED!")
    else:
        print(f"⚠️ {remaining:,} videos still need updates")
    
except Exception as e:
    print(f"\n❌ Error: {e}")
    conn.rollback()
    import traceback
    traceback.print_exc()
finally:
    cur.close()
    conn.close()