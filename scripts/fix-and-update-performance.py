#!/usr/bin/env python3

import os
import psycopg2
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Direct database connection
DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    print("ERROR: DATABASE_URL not found in .env")
    exit(1)

print("=" * 60)
print("FIXING COLUMN AND UPDATING PERFORMANCE SCORES")
print("=" * 60)

# Connect to database
conn = psycopg2.connect(DATABASE_URL)
cur = conn.cursor()

try:
    # Step 1: Alter the column (ALREADY DONE - SKIPPING)
    print("\n📝 Step 1: Column already expanded - skipping...")
    
    # Step 2: Update the function to cap extreme values
    print("\n📝 Step 2: Updating the function to handle large values...")
    cur.execute("""
        CREATE OR REPLACE FUNCTION update_all_video_scores(batch_size INTEGER DEFAULT 5000)
        RETURNS TABLE(
            videos_updated INTEGER,
            total_videos INTEGER,
            execution_time INTERVAL
        ) AS $$
        DECLARE
            v_updated INTEGER := 0;
            v_total INTEGER;
            v_batch_count INTEGER;
            v_offset INTEGER := 0;
            v_start_time TIMESTAMP;
        BEGIN
            v_start_time := clock_timestamp();
            
            SELECT COUNT(*) INTO v_total FROM videos WHERE published_at IS NOT NULL;
            
            RAISE NOTICE 'Starting update for % videos', v_total;
            
            LOOP
                WITH video_batch AS (
                    SELECT 
                        v.id,
                        v.view_count,
                        v.channel_id,
                        v.published_at,
                        LEAST(3650, EXTRACT(DAY FROM NOW() - v.published_at)::INTEGER) as days_old
                    FROM videos v
                    WHERE v.published_at IS NOT NULL
                    ORDER BY v.id
                    LIMIT batch_size
                    OFFSET v_offset
                ),
                score_calc AS (
                    SELECT 
                        vb.id,
                        vb.view_count,
                        vb.days_old,
                        pe.p50_views as global_median,
                        COALESCE(cpr.performance_ratio, 1.0) as channel_ratio,
                        CASE 
                            WHEN pe.p50_views > 0 THEN
                                -- Cap at 999 to prevent overflow
                                LEAST(999, vb.view_count::FLOAT / (pe.p50_views * COALESCE(cpr.performance_ratio, 1.0)))
                            ELSE NULL
                        END as performance_score
                    FROM video_batch vb
                    LEFT JOIN performance_envelopes pe ON pe.day_since_published = vb.days_old
                    LEFT JOIN channel_performance_ratios cpr ON cpr.channel_id = vb.channel_id
                    WHERE pe.p50_views IS NOT NULL
                )
                UPDATE videos v
                SET 
                    envelope_performance_ratio = ROUND(sc.performance_score::NUMERIC, 3),
                    envelope_performance_category = CASE
                        WHEN sc.performance_score > 3.0 THEN 'viral'
                        WHEN sc.performance_score >= 1.5 THEN 'outperforming'
                        WHEN sc.performance_score >= 0.5 THEN 'on_track'
                        WHEN sc.performance_score >= 0.2 THEN 'underperforming'
                        ELSE 'poor'
                    END
                FROM score_calc sc
                WHERE v.id = sc.id
                AND sc.performance_score IS NOT NULL;
                
                GET DIAGNOSTICS v_batch_count = ROW_COUNT;
                
                EXIT WHEN v_batch_count = 0;
                
                v_updated := v_updated + v_batch_count;
                v_offset := v_offset + batch_size;
                
                IF v_updated % 20000 = 0 THEN
                    RAISE NOTICE 'Progress: % / % videos (%.1f%%)', 
                        v_updated, v_total, (v_updated::FLOAT / v_total * 100);
                END IF;
            END LOOP;
            
            RETURN QUERY SELECT v_updated, v_total, (clock_timestamp() - v_start_time);
        END;
        $$ LANGUAGE plpgsql;
    """)
    conn.commit()
    print("✅ Function updated successfully!")
    
    # Step 3: Run the complete update
    print("\n📝 Step 3: Running the complete performance update...")
    print("This will take 2-3 minutes...\n")
    
    cur.execute("SELECT * FROM refresh_all_performance_scores();")
    results = cur.fetchall()
    
    print("\n📊 Update Results:")
    print("-" * 60)
    for row in results:
        step_name, items_updated, items_total, duration = row
        print(f"{step_name}:")
        print(f"  Updated: {items_updated:,} / {items_total:,} items")
        print(f"  Duration: {duration}")
        print()
    
    conn.commit()
    
    # Verify it worked
    print("🔍 Verifying the update...")
    cur.execute("""
        SELECT 
            v.id,
            v.title,
            v.channel_name,
            v.envelope_performance_ratio,
            v.envelope_performance_category,
            cpr.performance_ratio as channel_ratio
        FROM videos v
        LEFT JOIN channel_performance_ratios cpr ON v.channel_id = cpr.channel_id
        WHERE v.id = 'rwlvVTzbbbw'
    """)
    result = cur.fetchone()
    
    if result:
        print(f"\n✅ Test Video (Kenji's Sausages):")
        print(f"  Performance Score: {result[3]}x")
        print(f"  Category: {result[4]}")
        print(f"  Channel Multiplier: {result[5]}x" if result[5] else "  Channel Multiplier: 1.00x")
    
    print("\n" + "=" * 60)
    print("✅ ALL DONE!")
    print("=" * 60)
    
except Exception as e:
    print(f"\n❌ Error: {e}")
    conn.rollback()
finally:
    cur.close()
    conn.close()