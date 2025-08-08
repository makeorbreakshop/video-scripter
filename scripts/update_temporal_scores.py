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
print("UPDATING TEMPORAL PERFORMANCE SCORES")
print("Using temporal baselines to calculate final scores")
print("=" * 60)

conn = psycopg2.connect(DATABASE_URL)
cur = conn.cursor()

try:
    # First check current state
    print("\n📊 Checking current state...")
    
    cur.execute("""
        SELECT 
            COUNT(*) as total_videos,
            COUNT(channel_baseline_at_publish) as videos_with_baseline,
            COUNT(temporal_performance_score) as videos_with_score,
            AVG(temporal_performance_score) as avg_score
        FROM videos
        WHERE is_short = false
        AND published_at IS NOT NULL
    """)
    
    stats = cur.fetchone()
    print(f"Total regular videos: {stats[0]:,}")
    print(f"Videos with baselines: {stats[1]:,}")
    print(f"Videos with scores: {stats[2]:,}")
    if stats[3]:
        print(f"Current avg score: {stats[3]:.2f}x")
    
    # Create function to calculate temporal scores
    print("\n📊 Creating temporal score calculation function...")
    
    cur.execute("""
    CREATE OR REPLACE FUNCTION calculate_temporal_performance_scores(
        batch_size INTEGER DEFAULT 20000
    ) RETURNS TABLE(updated_count INTEGER, batch_count INTEGER) AS $$
    DECLARE
        v_updated INTEGER := 0;
        v_batch INTEGER := 0;
        v_batch_updated INTEGER;
    BEGIN
        LOOP
            -- Update a batch of videos
            WITH batch AS (
                SELECT 
                    v.id,
                    v.view_count,
                    v.published_at,
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
                    b.age_days,
                    b.channel_baseline_at_publish,
                    pe.p50_views as global_median,
                    -- Calculate temporal performance score
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
                END,
                updated_at = NOW()
            FROM scores s
            WHERE v.id = s.id
            AND s.score IS NOT NULL;
            
            GET DIAGNOSTICS v_batch_updated = ROW_COUNT;
            
            EXIT WHEN v_batch_updated = 0;
            
            v_updated := v_updated + v_batch_updated;
            v_batch := v_batch + 1;
            
            -- Progress update
            IF v_batch % 5 = 0 THEN
                RAISE NOTICE 'Progress: % videos updated in % batches', v_updated, v_batch;
            END IF;
        END LOOP;
        
        RETURN QUERY SELECT v_updated, v_batch;
    END;
    $$ LANGUAGE plpgsql;
    """)
    
    print("✅ Function created successfully")
    
    # Run the update
    print("\n💾 Starting temporal score calculation...")
    print("Processing in batches of 20,000 videos...")
    
    cur.execute("SELECT * FROM calculate_temporal_performance_scores(20000)")
    result = cur.fetchone()
    
    print(f"\n✅ Updated {result[0]:,} videos in {result[1]:,} batches")
    
    # Commit the changes
    conn.commit()
    
    # Verify the results
    print("\n🔍 Verifying temporal scores...")
    
    cur.execute("""
        SELECT 
            COUNT(*) as videos_with_score,
            AVG(temporal_performance_score) as avg_score,
            MIN(temporal_performance_score) as min_score,
            MAX(temporal_performance_score) as max_score,
            PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY temporal_performance_score) as median_score,
            COUNT(CASE WHEN temporal_performance_score >= 3 THEN 1 END) as viral_count,
            COUNT(CASE WHEN temporal_performance_score >= 1.5 THEN 1 END) as outperforming_count,
            COUNT(CASE WHEN temporal_performance_score >= 0.5 THEN 1 END) as on_track_count
        FROM videos
        WHERE temporal_performance_score IS NOT NULL
        AND is_short = false
    """)
    
    stats = cur.fetchone()
    print(f"Videos with scores: {stats[0]:,}")
    print(f"Average score: {stats[1]:.2f}x")
    print(f"Median score: {stats[4]:.2f}x")
    print(f"Range: {stats[2]:.4f}x to {stats[3]:.2f}x")
    print(f"\nPerformance distribution:")
    print(f"  Viral (≥3x): {stats[5]:,} videos")
    print(f"  Outperforming (≥1.5x): {stats[6]:,} videos")
    print(f"  On Track (≥0.5x): {stats[7]:,} videos")
    
    # Show some specific examples
    print("\n📊 Example videos with temporal scores:")
    
    cur.execute("""
        SELECT 
            v.title,
            v.channel_title,
            v.view_count,
            v.temporal_performance_score,
            v.channel_baseline_at_publish,
            v.envelope_performance_category,
            EXTRACT(DAY FROM NOW() - v.published_at)::INTEGER as age_days
        FROM videos v
        WHERE v.temporal_performance_score IS NOT NULL
        AND v.is_short = false
        AND v.channel_title IN ('J. Kenji López-Alt', 'SmarterEveryDay', 'Vlogbrothers')
        ORDER BY v.temporal_performance_score DESC
        LIMIT 10
    """)
    
    examples = cur.fetchall()
    for ex in examples:
        print(f"\n  {ex[0][:50]}...")
        print(f"    Channel: {ex[1]}")
        print(f"    Views: {ex[2]:,} | Age: {ex[6]} days")
        print(f"    Score: {ex[3]:.2f}x | Baseline: {ex[4]:.2f}x | Category: {ex[5]}")
    
    print("\n" + "=" * 60)
    print("TEMPORAL PERFORMANCE SCORES UPDATED SUCCESSFULLY!")
    print("\nCompleted:")
    print("✅ Calculated temporal scores for all videos with baselines")
    print("✅ Updated performance categories based on scores")
    print("✅ Verified score distribution and ranges")
    print("\nNext steps:")
    print("1. Test the updated UI display")
    print("2. Set up weekly cron job for envelope updates")
    print("3. Create daily incremental updates")
    print("=" * 60)
    
except Exception as e:
    print(f"\n❌ Error: {e}")
    conn.rollback()
    import traceback
    traceback.print_exc()
finally:
    cur.close()
    conn.close()