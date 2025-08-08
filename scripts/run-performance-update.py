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
print("RUNNING COMPLETE PERFORMANCE UPDATE")
print("=" * 60)
print(f"Started at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")

# Connect to database
conn = psycopg2.connect(DATABASE_URL)
cur = conn.cursor()

try:
    # Run the master update function
    print("\n🚀 Running refresh_all_performance_scores()...")
    print("This will update channel ratios and all video scores.\n")
    
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
    
    # Verify the update worked
    print("🔍 Verifying update...")
    
    # Check channel ratios
    cur.execute("""
        SELECT COUNT(*) as total,
               COUNT(CASE WHEN performance_ratio > 2 THEN 1 END) as high_performers,
               COUNT(CASE WHEN performance_ratio < 0.5 THEN 1 END) as low_performers
        FROM channel_performance_ratios
    """)
    ratio_stats = cur.fetchone()
    print(f"\n📈 Channel Ratios:")
    print(f"  Total channels with ratios: {ratio_stats[0]}")
    print(f"  High performers (>2x): {ratio_stats[1]}")
    print(f"  Low performers (<0.5x): {ratio_stats[2]}")
    
    # Check video scores
    cur.execute("""
        SELECT envelope_performance_category, COUNT(*) as count
        FROM videos
        WHERE envelope_performance_ratio IS NOT NULL
        GROUP BY envelope_performance_category
        ORDER BY 
            CASE envelope_performance_category
                WHEN 'viral' THEN 1
                WHEN 'outperforming' THEN 2
                WHEN 'on_track' THEN 3
                WHEN 'underperforming' THEN 4
                WHEN 'poor' THEN 5
            END
    """)
    category_counts = cur.fetchall()
    
    print(f"\n📊 Video Performance Distribution:")
    total_videos = sum(count for _, count in category_counts)
    for category, count in category_counts:
        percentage = (count / total_videos * 100) if total_videos > 0 else 0
        emoji = {
            'viral': '🚀',
            'outperforming': '✅',
            'on_track': '📊',
            'underperforming': '⚠️',
            'poor': '🔴'
        }.get(category, '❓')
        print(f"  {emoji} {category}: {count:,} ({percentage:.1f}%)")
    
    # Test a specific video (the Kenji one we've been testing)
    cur.execute("""
        SELECT 
            v.title,
            v.channel_name,
            v.envelope_performance_ratio,
            v.envelope_performance_category,
            cpr.performance_ratio as channel_ratio
        FROM videos v
        LEFT JOIN channel_performance_ratios cpr ON v.channel_id = cpr.channel_id
        WHERE v.id = 'rwlvVTzbbbw'
    """)
    test_video = cur.fetchone()
    
    if test_video:
        print(f"\n🎯 Test Video (Kenji's Sausages):")
        print(f"  Title: {test_video[0]}")
        print(f"  Channel: {test_video[1]}")
        print(f"  Performance Score: {test_video[2]:.2f}x")
        print(f"  Category: {test_video[3]}")
        print(f"  Channel Ratio: {test_video[4]:.2f}x" if test_video[4] else "  Channel Ratio: 1.00x (default)")
    
    print("\n" + "=" * 60)
    print("✅ PERFORMANCE UPDATE COMPLETE!")
    print("=" * 60)
    print(f"Finished at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    
    print("\n📌 What's been updated:")
    print("  1. Channel performance ratios stored in database")
    print("  2. All video scores include channel adjustments")
    print("  3. Search pages can now use pre-calculated scores")
    
    print("\n🔄 For ongoing updates:")
    print("  Daily: SELECT update_recent_video_scores();")
    print("  Weekly: SELECT * FROM refresh_all_performance_scores();")
    
except Exception as e:
    print(f"\n❌ Error: {e}")
    conn.rollback()
finally:
    cur.close()
    conn.close()