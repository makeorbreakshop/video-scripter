#!/usr/bin/env python3

import os
import psycopg2
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")
conn = psycopg2.connect(DATABASE_URL)
cur = conn.cursor()

# Update just this one video
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
        END,
        updated_at = NOW()
    FROM performance_envelopes pe
    WHERE v.id = 'jR69MydokL4'
    AND pe.day_since_published = LEAST(3650, EXTRACT(DAY FROM NOW() - v.published_at)::INTEGER)
    AND pe.p50_views > 0
    AND v.channel_baseline_at_publish > 0
    RETURNING v.temporal_performance_score, v.envelope_performance_category
""")

result = cur.fetchone()
conn.commit()

print(f"Updated video jR69MydokL4:")
print(f"Temporal score: {result[0]:.3f}x")
print(f"Category: {result[1]}")

cur.close()
conn.close()