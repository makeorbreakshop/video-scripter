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
print("RECALCULATE ALL TEMPORAL SCORES (BATCHED)")
print("Fixing scores calculated with stale view data")
print("=" * 60)

conn = psycopg2.connect(DATABASE_URL)
cur = conn.cursor()

try:
    # Check current state
    cur.execute("""
        SELECT 
            COUNT(*) as total,
            COUNT(CASE WHEN temporal_performance_score IS NOT NULL THEN 1 END) as have_scores,
            COUNT(CASE WHEN channel_baseline_at_publish IS NOT NULL THEN 1 END) as have_baselines
        FROM videos 
        WHERE is_short = false
    """)
    
    stats = cur.fetchone()
    print(f"Total regular videos: {stats[0]:,}")
    print(f"Videos with baselines: {stats[2]:,}")
    print(f"Videos with scores (OLD): {stats[1]:,}")
    
    if stats[2] == 0:
        print("❌ No videos have baselines!")
        exit(1)
    
    print(f"\n💾 Recalculating ALL temporal scores in batches of 5,000...")
    
    # Batched recalculation
    batch_size = 5000
    updated_count = 0
    batch_num = 0
    
    while True:
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
                END,
                updated_at = NOW()
            FROM batch b, performance_envelopes pe
            WHERE v.id = b.id
            AND pe.day_since_published = LEAST(3650, EXTRACT(DAY FROM NOW() - v.published_at)::INTEGER)
            AND pe.p50_views > 0
            AND v.channel_baseline_at_publish > 0
        """, (batch_size, batch_num * batch_size))
        
        rows_updated = cur.rowcount
        if rows_updated == 0:
            break
            
        updated_count += rows_updated
        batch_num += 1
        
        print(f"Batch {batch_num}: Updated {rows_updated:,} scores (Total: {updated_count:,})")
        
        conn.commit()
        
        if rows_updated < batch_size:
            break
    
    print(f"\n✅ Updated {updated_count:,} temporal scores!")
    
    # Verify results
    print("\n🔍 Final verification...")
    cur.execute("""
        SELECT 
            COUNT(*) as total,
            COUNT(CASE WHEN temporal_performance_score IS NOT NULL THEN 1 END) as have_scores,
            ROUND(AVG(temporal_performance_score), 2) as avg_score,
            ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY temporal_performance_score), 2) as median_score
        FROM videos 
        WHERE is_short = false
        AND temporal_performance_score IS NOT NULL
    """)
    
    final_stats = cur.fetchone()
    print(f"Videos with scores: {final_stats[1]:,}")
    print(f"Average score: {final_stats[2]}x")
    print(f"Median score: {final_stats[3]}x")
    
    if final_stats[1] >= stats[2]:
        print(f"\n🎉 SUCCESS! All videos with baselines now have temporal scores!")
    else:
        missing = stats[2] - final_stats[1]
        print(f"\n⚠️ {missing:,} videos still missing scores")
    
except Exception as e:
    print(f"\n❌ Error: {e}")
    conn.rollback()
    import traceback
    traceback.print_exc()
finally:
    cur.close()
    conn.close()