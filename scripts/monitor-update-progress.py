#!/usr/bin/env python3

import os
import psycopg2
import time
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Direct database connection
DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    print("ERROR: DATABASE_URL not found in .env")
    exit(1)

print("📊 MONITORING UPDATE PROGRESS")
print("=" * 60)

while True:
    try:
        conn = psycopg2.connect(DATABASE_URL)
        cur = conn.cursor()
        
        # Check channel ratios
        cur.execute("SELECT COUNT(*) FROM channel_performance_ratios")
        channels_done = cur.fetchone()[0]
        
        # Check video updates
        cur.execute("""
            SELECT 
                COUNT(*) FILTER (WHERE envelope_performance_ratio IS NOT NULL) as updated,
                COUNT(*) as total
            FROM videos 
            WHERE published_at IS NOT NULL
        """)
        videos_updated, videos_total = cur.fetchone()
        
        # Check category distribution
        cur.execute("""
            SELECT envelope_performance_category, COUNT(*) 
            FROM videos 
            WHERE envelope_performance_ratio IS NOT NULL 
            GROUP BY envelope_performance_category
        """)
        categories = cur.fetchall()
        
        # Clear screen and show progress
        os.system('clear' if os.name == 'posix' else 'cls')
        print("📊 PERFORMANCE UPDATE PROGRESS")
        print("=" * 60)
        print(f"\n📈 Channel Ratios: {channels_done:,} calculated")
        print(f"\n📹 Videos Updated: {videos_updated:,} / {videos_total:,} ({videos_updated/videos_total*100:.1f}%)")
        
        if categories:
            print("\n📊 Category Distribution:")
            for cat, count in categories:
                if cat:
                    emoji = {'viral': '🚀', 'outperforming': '✅', 'on_track': '📊', 
                            'underperforming': '⚠️', 'poor': '🔴'}.get(cat, '❓')
                    print(f"  {emoji} {cat}: {count:,}")
        
        print(f"\n🔄 Refreshing in 5 seconds... (Ctrl+C to stop)")
        
        cur.close()
        conn.close()
        
        time.sleep(5)
        
    except KeyboardInterrupt:
        print("\n\n✋ Monitoring stopped")
        break
    except Exception as e:
        print(f"Error: {e}")
        time.sleep(5)