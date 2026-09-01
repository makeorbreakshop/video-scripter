#!/usr/bin/env python3

import os
import psycopg2
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")
conn = psycopg2.connect(DATABASE_URL)
cur = conn.cursor()

print("=" * 60)
print("RECALCULATE ALL TEMPORAL SCORES - ROBUST VERSION")
print("=" * 60)

try:
    # First, check what we're dealing with
    cur.execute("""
        SELECT 
            COUNT(*) as total,
            COUNT(CASE WHEN temporal_performance_score IS NOT NULL THEN 1 END) as have_scores,
            COUNT(CASE WHEN temporal_performance_score IS NULL THEN 1 END) as need_scores
        FROM videos 
        WHERE is_short = false
        AND channel_baseline_at_publish IS NOT NULL
        AND published_at IS NOT NULL
        AND view_count IS NOT NULL
    """)
    
    stats = cur.fetchone()
    print(f"Total eligible videos: {stats[0]:,}")
    print(f"Already have scores: {stats[1]:,}")
    print(f"Need scores: {stats[2]:,}")
    
    if stats[2] == 0:
        print("✅ All videos already have scores!")
        exit(0)
    
    # Get list of ALL video IDs that need updating
    print(f"\n📊 Fetching IDs of videos needing scores...")
    cur.execute("""
        SELECT id 
        FROM videos 
        WHERE is_short = false
        AND channel_baseline_at_publish IS NOT NULL
        AND published_at IS NOT NULL
        AND view_count IS NOT NULL
        AND temporal_performance_score IS NULL
        ORDER BY id
    """)
    
    video_ids = [row[0] for row in cur.fetchall()]
    total_to_update = len(video_ids)
    print(f"Found {total_to_update:,} videos to update")
    
    # Process in batches
    batch_size = 5000
    updated_count = 0
    failed_count = 0
    batch_num = 0
    
    for i in range(0, total_to_update, batch_size):
        batch_ids = video_ids[i:i+batch_size]
        batch_num += 1
        
        # Update this specific batch
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
            WHERE videos.id = ANY(%s)
            AND pe.day_since_published = LEAST(3650, EXTRACT(DAY FROM NOW() - videos.published_at)::INTEGER)
            AND pe.p50_views > 0
            AND videos.channel_baseline_at_publish > 0
        """, (batch_ids,))
        
        rows_updated = cur.rowcount
        updated_count += rows_updated
        failed_in_batch = len(batch_ids) - rows_updated
        failed_count += failed_in_batch
        
        print(f"Batch {batch_num}/{(total_to_update + batch_size - 1) // batch_size}: Updated {rows_updated:,} of {len(batch_ids):,} videos (Total: {updated_count:,}/{total_to_update:,})")
        
        if failed_in_batch > 0:
            print(f"  ⚠️ {failed_in_batch} videos couldn't be updated (likely missing envelope data)")
        
        conn.commit()
    
    print(f"\n🎉 COMPLETE!")
    print(f"✅ Successfully updated: {updated_count:,} videos")
    if failed_count > 0:
        print(f"⚠️ Couldn't update: {failed_count:,} videos (likely missing envelope data for their age)")
    
    # Final verification
    cur.execute("""
        SELECT COUNT(*) 
        FROM videos 
        WHERE is_short = false
        AND temporal_performance_score IS NOT NULL
    """)
    
    final_count = cur.fetchone()[0]
    print(f"\n📊 Final count: {final_count:,} videos have temporal scores")
    
except Exception as e:
    print(f"\n❌ Error: {e}")
    conn.rollback()
    import traceback
    traceback.print_exc()
finally:
    cur.close()
    conn.close()