#!/usr/bin/env python3

import os
import psycopg2
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")
conn = psycopg2.connect(DATABASE_URL)
cur = conn.cursor()

print("=" * 60)
print("RECALCULATE ALL TEMPORAL SCORES (FIXED)")
print("=" * 60)

try:
    # Get total count
    cur.execute("""
        SELECT COUNT(*)
        FROM videos 
        WHERE is_short = false
        AND channel_baseline_at_publish IS NOT NULL
        AND published_at IS NOT NULL
        AND view_count IS NOT NULL
    """)
    
    total_videos = cur.fetchone()[0]
    print(f"Videos to process: {total_videos:,}")
    
    # Process in batches until done
    batch_size = 5000
    updated_count = 0
    batch_num = 0
    
    while updated_count < total_videos:
        cur.execute("""
            WITH batch AS (
                SELECT v.id
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
                temporal_performance_score = 
                    v.view_count::FLOAT / (pe.p50_views * v.channel_baseline_at_publish),
                envelope_performance_category = CASE
                    WHEN (v.view_count::FLOAT / (pe.p50_views * v.channel_baseline_at_publish)) >= 3 THEN 'viral'
                    WHEN (v.view_count::FLOAT / (pe.p50_views * v.channel_baseline_at_publish)) >= 1.5 THEN 'outperforming'
                    WHEN (v.view_count::FLOAT / (pe.p50_views * v.channel_baseline_at_publish)) >= 0.5 THEN 'on_track'
                    WHEN (v.view_count::FLOAT / (pe.p50_views * v.channel_baseline_at_publish)) >= 0.2 THEN 'underperforming'
                    ELSE 'poor'
                END
            FROM batch b
            JOIN performance_envelopes pe ON pe.day_since_published = LEAST(3650, EXTRACT(DAY FROM NOW() - v.published_at)::INTEGER)
            WHERE v.id = b.id
            AND pe.p50_views > 0
            AND v.channel_baseline_at_publish > 0
        """, (batch_size, batch_num * batch_size))
        
        rows_updated = cur.rowcount
        if rows_updated == 0:
            break
            
        updated_count += rows_updated
        batch_num += 1
        
        print(f"Batch {batch_num}: Updated {rows_updated:,} scores (Total: {updated_count:,}/{total_videos:,})")
        
        conn.commit()
        
        if rows_updated < batch_size:
            break
    
    print(f"\n✅ COMPLETE! Updated {updated_count:,} temporal scores")
    
except Exception as e:
    print(f"\n❌ Error: {e}")
    conn.rollback()
    import traceback
    traceback.print_exc()
finally:
    cur.close()
    conn.close()