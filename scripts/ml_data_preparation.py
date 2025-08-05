#!/usr/bin/env python3
"""
ML Performance Prediction - Data Preparation Script
Creates training dataset with log-space multipliers for XGBoost model
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

def fetch_training_data(limit=5000):
    """Fetch training videos with view snapshots"""
    
    query = """
    -- Get training videos with comprehensive snapshot data
    WITH training_candidates AS (
        SELECT 
            v.id,
            v.title,
            v.published_at,
            v.topic_cluster_id,
            v.format_type,
            v.channel_id,
            v.channel_avg_views,
            EXTRACT(DOW FROM v.published_at) as day_of_week,
            EXTRACT(HOUR FROM v.published_at) as hour_of_day,
            array_length(string_to_array(v.title, ' '), 1) as title_word_count
        FROM videos v 
        WHERE EXISTS (
            SELECT 1 FROM view_snapshots vs 
            WHERE vs.video_id = v.id
            GROUP BY vs.video_id 
            HAVING COUNT(*) >= 5 AND MAX(vs.days_since_published) >= 20
        )
        AND v.topic_cluster_id IS NOT NULL 
        AND v.topic_cluster_id > 0  -- Exclude outliers
        AND v.format_type IS NOT NULL
        AND v.published_at < NOW() - INTERVAL '30 days'
        AND v.channel_avg_views > 100  -- Reasonable baseline
        ORDER BY RANDOM()
        LIMIT %s
    )
    SELECT 
        tc.id as video_id,
        tc.title,
        tc.published_at,
        tc.topic_cluster_id,
        tc.format_type,
        tc.channel_id,
        tc.day_of_week,
        tc.hour_of_day,
        tc.title_word_count,
        tc.channel_avg_views,
        vs.days_since_published,
        vs.view_count
    FROM training_candidates tc
    JOIN view_snapshots vs ON vs.video_id = tc.id
    WHERE vs.days_since_published BETWEEN 1 AND 60
    ORDER BY tc.id, vs.days_since_published;
    """
    
    conn = get_db_connection()
    df = pd.read_sql_query(query, conn, params=[limit])
    conn.close()
    
    print(f"Fetched {len(df)} snapshot records for {df['video_id'].nunique()} videos")
    return df

def interpolate_snapshots(group):
    """Interpolate view counts for missing days"""
    # Create full day range
    min_day = group['days_since_published'].min()
    max_day = group['days_since_published'].max()
    full_days = pd.DataFrame({
        'days_since_published': range(min_day, min(max_day + 1, 31))
    })
    
    # Merge with actual data
    merged = full_days.merge(group, on='days_since_published', how='left')
    
    # Interpolate missing values
    merged['view_count'] = merged['view_count'].interpolate(method='linear')
    
    return merged

def create_training_features(df):
    """Create ML training dataset with log-space multipliers"""
    
    # Group by video and interpolate snapshots
    video_data = []
    processed_count = 0
    valid_count = 0
    
    for video_id, group in df.groupby('video_id'):
        processed_count += 1
        
        # Get basic video info
        video_info = group.iloc[0][['video_id', 'title', 'published_at', 'topic_cluster_id', 
                                   'format_type', 'channel_id', 'day_of_week', 'hour_of_day', 
                                   'title_word_count', 'channel_avg_views']].to_dict()
        
        # Check if we have early and late snapshots
        days_available = set(group['days_since_published'].values)
        has_early = any(d <= 3 for d in days_available)
        has_late = any(d >= 20 for d in days_available)
        
        if not (has_early and has_late):
            continue
            
        # Interpolate snapshots
        interpolated = interpolate_snapshots(group[['days_since_published', 'view_count']])
        
        # Extract key day snapshots (use closest available if exact day missing)
        day_views = {}
        for target_day in [1, 3, 7, 14, 30]:
            # Find closest day within ±2 days
            available_days = interpolated['days_since_published'].values
            closest_day = min(available_days, key=lambda x: abs(x - target_day))
            
            if abs(closest_day - target_day) <= 2:  # Within 2 days tolerance
                day_data = interpolated[interpolated['days_since_published'] == closest_day]
                if not day_data.empty:
                    day_views[f'day_{target_day}_views'] = day_data['view_count'].iloc[0]
        
        # Only include videos with day 1 and day 30 data
        if 'day_1_views' in day_views and 'day_30_views' in day_views:
            video_info.update(day_views)
            
            # Calculate log-space multipliers
            baseline = video_info['channel_avg_views']
            if baseline > 0:
                for day in [1, 3, 7, 14, 30]:
                    views_key = f'day_{day}_views'
                    if views_key in video_info and video_info[views_key] > 0:
                        log_multiplier = np.log(video_info[views_key]) - np.log(baseline)
                        video_info[f'day_{day}_log_multiplier'] = log_multiplier
                        video_info[f'day_{day}_performance_ratio'] = video_info[views_key] / baseline
            
            # Calculate velocity features
            if 'day_3_views' in day_views and 'day_7_views' in day_views:
                if day_views['day_3_views'] > 0:
                    video_info['view_velocity_3_7'] = (day_views['day_7_views'] - day_views['day_3_views']) / day_views['day_3_views']
            
            video_data.append(video_info)
            valid_count += 1
    
    training_df = pd.DataFrame(video_data)
    print(f"Processed {processed_count} videos → {valid_count} valid training examples")
    
    return training_df

def clean_and_validate_data(df):
    """Clean data and remove invalid entries"""
    initial_count = len(df)
    
    if initial_count == 0:
        print("⚠️ No data to clean - empty dataset")
        return df
    
    # Remove videos with invalid log multipliers
    for col in df.columns:
        if 'log_multiplier' in col:
            df = df[df[col].notna()]
            df = df[np.isfinite(df[col])]
            # Cap extreme values at ±3 (20x performance difference)
            df.loc[df[col] > 3, col] = 3
            df.loc[df[col] < -3, col] = -3
    
    # Remove videos with zero or negative views
    view_cols = [col for col in df.columns if col.endswith('_views')]
    for col in view_cols:
        if col in df.columns:
            df = df[df[col] > 0]
    
    if initial_count > 0:
        retention_pct = len(df)/initial_count*100
        print(f"Cleaned dataset: {initial_count} → {len(df)} videos ({retention_pct:.1f}% retained)")
    else:
        print("No data to clean")
    
    return df

def save_training_data(df, output_path="data/ml_training_dataset.csv"):
    """Save training dataset to CSV"""
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    
    df.to_csv(output_path, index=False)
    print(f"Saved training dataset to {output_path}")
    
    # Save summary statistics
    summary = {
        'total_videos': len(df),
        'date_range': {
            'earliest': df['published_at'].min().isoformat(),
            'latest': df['published_at'].max().isoformat()
        },
        'topics': df['topic_cluster_id'].nunique(),
        'formats': df['format_type'].nunique(),
        'channels': df['channel_id'].nunique(),
        'log_multiplier_stats': {
            'day_30_mean': float(df['day_30_log_multiplier'].mean()),
            'day_30_std': float(df['day_30_log_multiplier'].std()),
            'day_30_min': float(df['day_30_log_multiplier'].min()),
            'day_30_max': float(df['day_30_log_multiplier'].max())
        }
    }
    
    with open(output_path.replace('.csv', '_summary.json'), 'w') as f:
        json.dump(summary, f, indent=2, default=str)
    
    print(f"Dataset summary: {summary['total_videos']} videos, {summary['topics']} topics, {summary['formats']} formats")
    print(f"Day 30 log multiplier: μ={summary['log_multiplier_stats']['day_30_mean']:.3f}, σ={summary['log_multiplier_stats']['day_30_std']:.3f}")

def main():
    """Main execution"""
    print("🚀 Starting ML data preparation...")
    
    # Fetch raw data
    print("📊 Fetching training data from database...")
    raw_df = fetch_training_data(limit=5000)
    
    # Create features
    print("⚙️ Creating training features...")
    training_df = create_training_features(raw_df)
    
    # Clean and validate
    print("🧹 Cleaning and validating data...")
    clean_df = clean_and_validate_data(training_df)
    
    # Save results
    print("💾 Saving training dataset...")
    save_training_data(clean_df)
    
    print("✅ Data preparation complete!")
    
    # Display sample
    print("\n📋 Sample training data:")
    display_cols = ['video_id', 'topic_cluster_id', 'format_type', 
                   'day_1_log_multiplier', 'day_30_log_multiplier']
    # Add performance ratio if it exists
    if 'performance_ratio_30d' in clean_df.columns:
        display_cols.append('performance_ratio_30d')
    elif 'day_30_performance_ratio' in clean_df.columns:
        display_cols.append('day_30_performance_ratio')
    
    print(clean_df[display_cols].head())

if __name__ == "__main__":
    main()