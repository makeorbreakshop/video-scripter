#!/usr/bin/env python3
"""
ML Performance Prediction - FIXED Data Preparation Script
Uses 180K+ videos with performance curves for backfilling missing snapshots
"""

import pandas as pd
import numpy as np
import json
from datetime import datetime
import psycopg2
from urllib.parse import urlparse
import os
from dotenv import load_dotenv

load_dotenv()

def get_db_connection():
    """Get database connection from DATABASE_URL"""
    database_url = os.getenv('DATABASE_URL')
    if not database_url:
        raise ValueError("DATABASE_URL environment variable not set")
    
    return psycopg2.connect(database_url)

def fetch_performance_envelopes():
    """Get global performance curves for backfilling"""
    
    query = """
    SELECT day_since_published, p10_views, p25_views, p50_views, p75_views, p90_views
    FROM performance_envelopes 
    WHERE day_since_published IN (1, 3, 7, 14, 30)
    ORDER BY day_since_published;
    """
    
    conn = get_db_connection()
    df = pd.read_sql(query, conn)
    conn.close()
    
    print(f"📊 Loaded performance envelopes for days: {df['day_since_published'].tolist()}")
    return df

def fetch_training_videos(limit=50000):
    """Fetch ALL videos with topic/format data for training"""
    
    query = """
    WITH video_features AS (
        SELECT 
            v.id,
            v.title,
            v.published_at,
            v.topic_cluster_id,
            v.format_type,
            v.channel_id,
            v.rolling_baseline_views as channel_avg_views,
            v.view_count as current_views,
            EXTRACT(DOW FROM v.published_at) as day_of_week,
            EXTRACT(HOUR FROM v.published_at) as hour_of_day,
            array_length(string_to_array(v.title, ' '), 1) as title_word_count,
            DATE_PART('day', NOW() - v.published_at) as days_old,
            
            -- Get actual snapshots where available
            vpt.day_1_views,
            vpt.week_1_views as day_7_views,
            vpt.month_1_views as day_30_views
            
        FROM videos v 
        LEFT JOIN video_performance_trends vpt ON v.id = vpt.video_id
        WHERE v.topic_cluster_id IS NOT NULL 
        AND v.format_type IS NOT NULL
        AND v.rolling_baseline_views > 0
        AND v.view_count > 0
        AND v.published_at IS NOT NULL
        AND DATE_PART('day', NOW() - v.published_at) >= 30  -- At least 30 days old
        LIMIT %s
    )
    SELECT * FROM video_features
    ORDER BY published_at DESC;  -- Newest first for better training data
    """
    
    conn = get_db_connection()
    df = pd.read_sql(query, conn, params=[limit])
    conn.close()
    
    print(f"📊 Loaded {len(df)} training candidates")
    print(f"   - Have day_1_views: {df['day_1_views'].notna().sum()}")
    print(f"   - Have day_7_views: {df['day_7_views'].notna().sum()}")  
    print(f"   - Have day_30_views: {df['day_30_views'].notna().sum()}")
    print(f"   - Unique topics: {df['topic_cluster_id'].nunique()}")
    print(f"   - Unique formats: {df['format_type'].nunique()}")
    
    return df

def backfill_missing_snapshots(df, envelopes):
    """Use performance curves to estimate missing snapshot data"""
    
    print("🔧 Backfilling missing snapshots using performance curves...")
    
    # Create envelope lookup dict
    envelope_lookup = {}
    for _, row in envelopes.iterrows():
        day = row['day_since_published']
        envelope_lookup[day] = {
            'p10': row['p10_views'],
            'p25': row['p25_views'], 
            'p50': row['p50_views'],
            'p75': row['p75_views'],
            'p90': row['p90_views']
        }
    
    backfilled_count = {'day_1': 0, 'day_7': 0, 'day_30': 0}
    
    for idx, row in df.iterrows():
        channel_baseline = row['channel_avg_views']
        current_views = row['current_views']
        
        # Calculate where this video sits in the performance envelope based on current performance
        # Use current views vs baseline to estimate performance tier
        if channel_baseline > 0:
            current_multiplier = current_views / channel_baseline
            
            # Map current performance to envelope percentile (rough heuristic)
            if current_multiplier >= 5.0:
                percentile = 'p90'
            elif current_multiplier >= 2.0:
                percentile = 'p75'
            elif current_multiplier >= 1.0:
                percentile = 'p50'
            elif current_multiplier >= 0.5:
                percentile = 'p25'
            else:
                percentile = 'p10'
        else:
            percentile = 'p50'  # Default to median
        
        # Backfill missing snapshots using performance curve + channel scaling
        for day, col in [(1, 'day_1_views'), (7, 'day_7_views'), (30, 'day_30_views')]:
            if pd.isna(row[col]) and day in envelope_lookup:
                # Scale global curve by channel baseline
                global_views = envelope_lookup[day][percentile]
                estimated_views = global_views * (channel_baseline / 50000)  # Scale by baseline
                estimated_views = max(0, int(estimated_views))  # Ensure positive
                
                df.at[idx, col] = estimated_views
                backfilled_count[f'day_{day}'] += 1
    
    print(f"   ✅ Backfilled day_1: {backfilled_count['day_1']}")
    print(f"   ✅ Backfilled day_7: {backfilled_count['day_7']}")
    print(f"   ✅ Backfilled day_30: {backfilled_count['day_30']}")
    
    return df

def create_training_features(df):
    """Calculate log-space multipliers and other ML features"""
    
    print("⚙️ Creating ML training features...")
    
    training_examples = []
    
    for _, row in df.iterrows():
        baseline = row['channel_avg_views']
        if baseline <= 0:
            continue
            
        video_info = {
            'video_id': row['id'],
            'title': row['title'],
            'topic_cluster_id': int(row['topic_cluster_id']),
            'format_type': row['format_type'],
            'day_of_week': int(row['day_of_week']),
            'hour_of_day': int(row['hour_of_day']),
            'title_word_count': int(row['title_word_count']),
            'channel_avg_views': baseline,
            'published_at': row['published_at']
        }
        
        # Calculate log-space multipliers for each day
        has_all_snapshots = True
        for day, col in [(1, 'day_1_views'), (7, 'day_7_views'), (30, 'day_30_views')]:
            views = row[col]
            if pd.notna(views) and views > 0:
                log_multiplier = np.log(views) - np.log(baseline)
                video_info[f'day_{day}_views'] = int(views)
                video_info[f'day_{day}_log_multiplier'] = log_multiplier
            else:
                has_all_snapshots = False
                break
                
        # Calculate view velocity (day 3-7 growth rate) 
        if 'day_7_log_multiplier' in video_info and 'day_1_log_multiplier' in video_info:
            day_1_views = video_info['day_1_views'] 
            day_7_views = video_info['day_7_views']
            if day_1_views > 0:
                video_info['view_velocity_3_7'] = (day_7_views - day_1_views) / day_1_views
            else:
                video_info['view_velocity_3_7'] = 0
        
        if has_all_snapshots:
            training_examples.append(video_info)
    
    print(f"✅ Created {len(training_examples)} complete training examples")
    return pd.DataFrame(training_examples)

def save_training_dataset(df, filename="data/ml_training_dataset_fixed.csv"):
    """Save the prepared training dataset"""
    
    os.makedirs("data", exist_ok=True)
    df.to_csv(filename, index=False)
    
    print(f"💾 Saved training dataset: {filename}")
    print(f"   - Total examples: {len(df)}")
    print(f"   - Topics: {df['topic_cluster_id'].nunique()}")
    print(f"   - Formats: {df['format_type'].nunique()}")
    print(f"   - Date range: {df['published_at'].min()} to {df['published_at'].max()}")
    
    # Show sample statistics
    print(f"\n📈 Log Multiplier Statistics:")
    for day in [1, 7, 30]:
        col = f'day_{day}_log_multiplier'
        if col in df.columns:
            mean_mult = np.exp(df[col].mean())
            print(f"   Day {day}: {mean_mult:.2f}x average multiplier")

def main():
    """Main data preparation pipeline"""
    print("🚀 Starting FIXED ML data preparation...")
    
    # Load performance envelopes for backfilling
    print("📊 Loading global performance curves...")
    envelopes = fetch_performance_envelopes()
    
    # Fetch training videos (ALL with required features)
    print("📁 Fetching training candidates...")
    df = fetch_training_videos(limit=50000)  # Get 50K candidates
    
    if len(df) < 1000:
        print("⚠️ Not enough videos found - check database")
        return
    
    # Backfill missing snapshots using performance curves
    df = backfill_missing_snapshots(df, envelopes)
    
    # Create training features with log-space multipliers
    training_df = create_training_features(df)
    
    if len(training_df) < 1000:
        print("⚠️ Not enough complete training examples")
        return
        
    # Save training dataset
    save_training_dataset(training_df)
    
    print("✅ FIXED data preparation complete!")
    print(f"   🎯 {len(training_df)} training examples ready")
    print("   📈 Ready for XGBoost model training")

if __name__ == "__main__":
    main()