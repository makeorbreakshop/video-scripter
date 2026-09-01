#!/usr/bin/env python3

import os
import psycopg2
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")
conn = psycopg2.connect(DATABASE_URL)
cur = conn.cursor()

print("=" * 60)
print("RECALCULATE REMAINING TEMPORAL SCORES")
print("=" * 60)

try:
    # Check how many still need updating
    cur.execute("""
        SELECT COUNT(*)
        FROM videos 
        WHERE is_short = false
        AND published_at IS NOT NULL
        AND view_count IS NOT NULL
        AND channel_baseline_at_publish IS NOT NULL
        AND temporal_performance_score IS NULL
    """)
    
    remaining = cur.fetchone()[0]
    print(f"Videos still needing scores: {remaining:,}")
    
    if remaining == 0:
        print("✅ All videos already have scores!")
        exit(0)
    
    # Process remaining videos in batches
    batch_size = 5000
    updated_count = 0
    batch_num = 0
    
    while True:
        # Update videos that don't have scores yet
        cur.execute("""
            UPDATE videos 
            SET 
                temporal_performance_score = 
                    view_count::FLOAT / (pe.p50_views * channel_baseline_at_publish),
                envelope_performance_category = CASE
                    WHEN (view_count::FLOAT / (pe.p50_views * channel_baseline_at_publish)) >= 3 THEN 'viral'
                    WHEN (view_count::FLOAT / (pe.p50_views * channel_baseline_at_publish)) >= 1.5 THEN 'outperforming'
                    WHEN (view_count::FLOAT / (pe.p50_views * channel_baseline_at_publish)) >= 0.5 THEN 'on_track'
                    WHEN (view_count::FLOAT / (pe.p50_views * channel_baseline_at_publish)) >= 0.2 THEN 'underperforming'
                    ELSE 'poor'
                END
            FROM performance_envelopes pe
            WHERE videos.id IN (
                SELECT id 
                FROM videos 
                WHERE is_short = false
                AND published_at IS NOT NULL
                AND view_count IS NOT NULL
                AND channel_baseline_at_publish IS NOT NULL
                AND temporal_performance_score IS NULL
                ORDER BY id
                LIMIT %s
            )
            AND pe.day_since_published = LEAST(3650, EXTRACT(DAY FROM NOW() - videos.published_at)::INTEGER)
            AND pe.p50_views > 0
            AND videos.channel_baseline_at_publish > 0
        """, (batch_size,))
        
        rows_updated = cur.rowcount
        if rows_updated == 0:
            break
            
        updated_count += rows_updated
        batch_num += 1
        
        remaining -= rows_updated
        print(f"Batch {batch_num}: Updated {rows_updated:,} scores ({remaining:,} remaining)")
        
        conn.commit()
        
        if rows_updated < batch_size:
            break
    
    print(f"\n✅ COMPLETE! Updated {updated_count:,} more temporal scores")
    
except Exception as e:
    print(f"\n❌ Error: {e}")
    conn.rollback()
    import traceback
    traceback.print_exc()
finally:
    cur.close()
    conn.close()