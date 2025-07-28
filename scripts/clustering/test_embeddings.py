#!/usr/bin/env python3
"""
Test script to verify title embeddings are available in the database
"""

import os
import sys
from dotenv import load_dotenv
import psycopg2
from psycopg2.extras import RealDictCursor

# Load environment variables
load_dotenv()

# Database connection
DB_URL = os.getenv('DATABASE_URL')
if not DB_URL:
    print("Error: DATABASE_URL not found in environment variables")
    sys.exit(1)

def test_embeddings():
    """Test database connection and check for embeddings"""
    try:
        conn = psycopg2.connect(DB_URL)
        cur = conn.cursor(cursor_factory=RealDictCursor)
        
        # Check if title_embedding column exists
        cur.execute("""
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_name = 'videos' 
        AND column_name = 'title_embedding'
        """)
        
        column_info = cur.fetchone()
        if column_info:
            print(f"✓ Found title_embedding column: {column_info['data_type']}")
        else:
            print("✗ title_embedding column not found in videos table")
            return
        
        # Count videos with embeddings
        cur.execute("""
        SELECT 
            COUNT(*) as total_videos,
            COUNT(title_embedding) as videos_with_embeddings,
            COUNT(*) FILTER (WHERE title_embedding IS NOT NULL AND published_at >= '2024-01-01') as embeddings_2024,
            COUNT(*) FILTER (WHERE title_embedding IS NOT NULL AND published_at >= '2025-01-01') as embeddings_2025
        FROM videos
        """)
        
        stats = cur.fetchone()
        print(f"\nEmbedding Statistics:")
        print(f"  Total videos: {stats['total_videos']:,}")
        print(f"  Videos with embeddings: {stats['videos_with_embeddings']:,}")
        print(f"  Embeddings from 2024: {stats['embeddings_2024']:,}")
        print(f"  Embeddings from 2025: {stats['embeddings_2025']:,}")
        print(f"  Coverage: {stats['videos_with_embeddings']/stats['total_videos']*100:.1f}%")
        
        # Check embedding dimensions
        cur.execute("""
        SELECT 
            id, 
            title,
            array_length(string_to_array(trim(both '[]' from title_embedding::text), ','), 1) as dimensions
        FROM videos 
        WHERE title_embedding IS NOT NULL 
        LIMIT 1
        """)
        
        sample = cur.fetchone()
        if sample:
            print(f"\nEmbedding Dimensions: {sample['dimensions']}")
            print(f"Sample video: {sample['title'][:60]}...")
        
        # Check for clustering tables
        cur.execute("""
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name IN ('video_hdbscan_clusters', 'hdbscan_cluster_metadata')
        """)
        
        existing_tables = [row['table_name'] for row in cur.fetchall()]
        print(f"\nExisting clustering tables: {existing_tables if existing_tables else 'None'}")
        
        cur.close()
        conn.close()
        
        print("\n✓ Database connection successful!")
        
    except Exception as e:
        print(f"✗ Error: {e}")
        sys.exit(1)

if __name__ == "__main__":
    print("Testing Title Embeddings")
    print("=" * 40)
    test_embeddings()