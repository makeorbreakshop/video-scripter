#!/usr/bin/env python3
"""
Performance Envelope ML Model Training
Train ML model on 698K+ view snapshots to predict performance envelopes
"""

import os
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import seaborn as sns
from datetime import datetime
import json
import pickle

import xgboost as xgb
from sklearn.model_selection import train_test_split
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.preprocessing import LabelEncoder
from supabase import create_client, Client
from dotenv import load_dotenv

# Load environment
load_dotenv()

# Initialize Supabase
url = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
supabase: Client = create_client(url, key)

def fetch_training_data(limit=None):
    """Fetch comprehensive training data from database"""
    
    print("📊 Fetching training data from database...")
    
    # Get performance envelope training data
    # We need: video metadata + view snapshots for full performance curves
    query = """
    SELECT 
        v.id as video_id,
        v.title,
        v.channel_name,
        v.channel_id,
        v.published_at,
        v.format_type,
        v.topic_cluster_id,
        v.topic_domain,
        
        -- Channel characteristics from metadata
        (v.metadata->'channel_stats'->>'subscriber_count')::bigint as subscriber_count,
        (v.metadata->'channel_stats'->>'video_count')::bigint as channel_video_count,
        
        -- Video characteristics
        LENGTH(v.title) as title_length,
        array_length(string_to_array(v.title, ' '), 1) as title_word_count,
        EXTRACT(DOW FROM v.published_at) as day_of_week,
        EXTRACT(HOUR FROM v.published_at) as hour_of_day,
        
        -- View snapshots data
        vs.days_since_published,
        vs.view_count,
        vs.snapshot_date
        
    FROM videos v
    INNER JOIN view_snapshots vs ON v.id = vs.video_id
    WHERE v.format_type IS NOT NULL
        AND v.topic_cluster_id IS NOT NULL
        AND v.metadata->'channel_stats'->>'subscriber_count' IS NOT NULL
        AND vs.view_count > 0
        AND vs.days_since_published BETWEEN 0 AND 365  -- Focus on first year
    """
    
    if limit:
        query += f" LIMIT {limit}"
    
    # Execute query using raw SQL approach
    try:
        # Build query in parts due to complexity
        base_query = supabase.table('videos')\
            .select('id,title,channel_name,channel_id,published_at,format_type,topic_cluster_id,topic_domain,metadata')\
            .not_('format_type', 'is', None)\
            .not_('topic_cluster_id', 'is', None)
        
        if limit:
            base_query = base_query.limit(limit)
        
        videos_result = base_query.execute()
        
        if not videos_result.data:
            print("❌ No videos found")
            return None
        
        print(f"✓ Loaded {len(videos_result.data):,} videos")
        
        # Get snapshots for these videos
        video_ids = [v['id'] for v in videos_result.data]
        
        # Process in batches to avoid query size limits
        batch_size = 1000
        all_snapshots = []
        
        for i in range(0, len(video_ids), batch_size):
            batch_ids = video_ids[i:i + batch_size]
            
            snapshots_result = supabase.table('view_snapshots')\
                .select('video_id, days_since_published, view_count, snapshot_date')\
                .in_('video_id', batch_ids)\
                .gt('view_count', 0)\
                .gte('days_since_published', 0)\
                .lte('days_since_published', 365)\
                .execute()
            
            if snapshots_result.data:
                all_snapshots.extend(snapshots_result.data)
            
            print(f"   Loaded snapshots batch {i//batch_size + 1}/{(len(video_ids)-1)//batch_size + 1}")
        
        print(f"✓ Loaded {len(all_snapshots):,} view snapshots")
        
        # Combine videos and snapshots
        videos_df = pd.DataFrame(videos_result.data)
        snapshots_df = pd.DataFrame(all_snapshots)
        
        # Merge datasets
        df = snapshots_df.merge(videos_df, left_on='video_id', right_on='id', how='inner')
        
        print(f"✓ Combined dataset: {len(df):,} training records")
        return df
        
    except Exception as e:
        print(f"❌ Error fetching data: {e}")
        return None

def prepare_features(df):
    """Prepare features for ML training"""
    
    print("🔧 Preparing features for ML training...")
    
    # Extract subscriber count from metadata
    def extract_subscriber_count(metadata):
        if pd.isna(metadata) or metadata is None:
            return 10000  # Default
        if isinstance(metadata, str):
            try:
                metadata = json.loads(metadata)
            except:
                return 10000
        if isinstance(metadata, dict):
            channel_stats = metadata.get('channel_stats', {})
            sub_count = channel_stats.get('subscriber_count')
            if sub_count:
                try:
                    return int(sub_count)
                except:
                    return 10000
        return 10000
    
    df['subscriber_count'] = df['metadata'].apply(extract_subscriber_count)
    
    # Create channel tier feature
    df['channel_tier'] = pd.cut(df['subscriber_count'], 
                               bins=[0, 1000, 10000, 100000, 1000000, float('inf')],
                               labels=['micro', 'small', 'medium', 'large', 'mega'])
    
    # Create time-based features from published_at
    df['published_at'] = pd.to_datetime(df['published_at'])
    df['day_of_week'] = df['published_at'].dt.dayofweek
    df['hour_of_day'] = df['published_at'].dt.hour
    df['is_weekend'] = df['day_of_week'].isin([5, 6])  # Saturday=5, Sunday=6
    df['is_prime_time'] = df['hour_of_day'].between(12, 18)  # 12-6 PM
    
    # Create video characteristics
    df['title_length'] = df['title'].str.len().fillna(50)
    df['title_word_count'] = df['title'].str.split().str.len().fillna(8)
    
    # Log transform view counts for better distribution
    df['log_views'] = np.log1p(df['view_count'])
    
    # Normalize days since published
    df['days_normalized'] = df['days_since_published'] / 365.0
    
    # Create performance trajectory features
    # For each video, calculate relative performance at different stages
    trajectory_features = []
    
    print("📈 Calculating performance trajectory features...")
    
    for video_id in df['video_id'].unique():
        video_data = df[df['video_id'] == video_id].sort_values('days_since_published')
        
        if len(video_data) < 3:  # Need at least 3 snapshots
            continue
            
        # Calculate growth rates
        video_data['view_growth_rate'] = video_data['view_count'].pct_change()
        video_data['cumulative_growth'] = (video_data['view_count'] / video_data['view_count'].iloc[0]) - 1
        
        # Calculate performance relative to channel
        channel_median = df[df['channel_name'] == video_data['channel_name'].iloc[0]]['view_count'].median()
        video_data['channel_relative_performance'] = video_data['view_count'] / channel_median
        
        trajectory_features.append(video_data)
    
    # Combine all trajectory features
    df_enhanced = pd.concat(trajectory_features, ignore_index=True)
    
    print(f"✓ Enhanced dataset: {len(df_enhanced):,} records with trajectory features")
    return df_enhanced

def create_performance_envelope_targets(df):
    """Create target variables for performance envelope prediction"""
    
    print("🎯 Creating performance envelope prediction targets...")
    
    # For each day/channel combination, calculate percentile targets
    envelope_targets = []
    
    # Group by days_since_published and channel characteristics
    for days in sorted(df['days_since_published'].unique()):
        day_data = df[df['days_since_published'] == days]
        
        for channel_tier in day_data['channel_tier'].unique():
            if pd.isna(channel_tier):
                continue
                
            tier_data = day_data[day_data['channel_tier'] == channel_tier]
            
            if len(tier_data) < 10:  # Need minimum samples
                continue
            
            # Calculate percentiles for this day/tier combination
            percentiles = {
                'days_since_published': days,
                'channel_tier': channel_tier,
                'sample_count': len(tier_data),
                'p10_views': tier_data['view_count'].quantile(0.10),
                'p25_views': tier_data['view_count'].quantile(0.25),
                'p50_views': tier_data['view_count'].quantile(0.50),
                'p75_views': tier_data['view_count'].quantile(0.75),
                'p90_views': tier_data['view_count'].quantile(0.90),
                'mean_views': tier_data['view_count'].mean(),
                'std_views': tier_data['view_count'].std()
            }
            
            envelope_targets.append(percentiles)
    
    envelope_df = pd.DataFrame(envelope_targets)
    print(f"✓ Created {len(envelope_df):,} envelope target combinations")
    
    return envelope_df

def train_envelope_model(df, envelope_targets):
    """Train XGBoost model to predict performance envelopes"""
    
    print("🤖 Training performance envelope ML model...")
    
    # Prepare features for envelope prediction
    # We want to predict what the envelope should be for any channel/day combination
    
    # Create training data by joining video features with envelope targets
    training_data = []
    
    for _, row in envelope_targets.iterrows():
        # Get sample videos for this day/tier combination
        sample_videos = df[
            (df['days_since_published'] == row['days_since_published']) &
            (df['channel_tier'] == row['channel_tier'])
        ].sample(min(100, len(df)), random_state=42)  # Sample up to 100 videos
        
        for _, video in sample_videos.iterrows():
            # Create training record
            training_record = {
                'days_since_published': row['days_since_published'],
                'subscriber_count': video['subscriber_count'],
                'channel_tier_encoded': LabelEncoder().fit_transform([video['channel_tier']])[0] if pd.notna(video['channel_tier']) else 0,
                'format_type': video['format_type'],
                'topic_cluster_id': video['topic_cluster_id'],
                'title_word_count': video['title_word_count'],
                'day_of_week': video['day_of_week'],
                'hour_of_day': video['hour_of_day'],
                'is_weekend': video['is_weekend'],
                'is_prime_time': video['is_prime_time'],
                
                # Targets (what we want to predict)
                'target_p50_views': row['p50_views'],
                'target_p10_views': row['p10_views'],
                'target_p90_views': row['p90_views'],
                'target_std_views': row['std_views']
            }
            training_data.append(training_record)
    
    training_df = pd.DataFrame(training_data)
    print(f"✓ Created {len(training_df):,} training examples")
    
    # Prepare features and targets
    feature_columns = [
        'days_since_published', 'subscriber_count', 'channel_tier_encoded',
        'topic_cluster_id', 'title_word_count', 'day_of_week', 'hour_of_day',
        'is_weekend', 'is_prime_time'
    ]
    
    # One-hot encode categorical features
    format_dummies = pd.get_dummies(training_df['format_type'], prefix='format')
    features_df = pd.concat([training_df[feature_columns], format_dummies], axis=1)
    
    # Multiple targets (we'll train separate models for each percentile)
    targets = {
        'p50_model': training_df['target_p50_views'],
        'p10_model': training_df['target_p10_views'],
        'p90_model': training_df['target_p90_views']
    }
    
    models = {}
    
    for model_name, target in targets.items():
        print(f"🎯 Training {model_name}...")
        
        # Split data
        X_train, X_test, y_train, y_test = train_test_split(
            features_df, target, test_size=0.2, random_state=42
        )
        
        # Train XGBoost model
        model = xgb.XGBRegressor(
            n_estimators=200,
            max_depth=10,
            learning_rate=0.1,
            subsample=0.8,
            colsample_bytree=0.8,
            random_state=42,
            n_jobs=-1
        )
        
        model.fit(X_train, y_train)
        
        # Evaluate
        train_pred = model.predict(X_train)
        test_pred = model.predict(X_test)
        
        train_mae = mean_absolute_error(y_train, train_pred)
        test_mae = mean_absolute_error(y_test, test_pred)
        train_r2 = r2_score(y_train, train_pred)
        test_r2 = r2_score(y_test, test_pred)
        
        print(f"   {model_name} - Train MAE: {train_mae:.0f}, Test MAE: {test_mae:.0f}")
        print(f"   {model_name} - Train R²: {train_r2:.3f}, Test R²: {test_r2:.3f}")
        
        models[model_name] = {
            'model': model,
            'feature_columns': list(features_df.columns),
            'train_mae': train_mae,
            'test_mae': test_mae,
            'train_r2': train_r2,
            'test_r2': test_r2
        }
    
    return models

def save_models(models):
    """Save trained models and metadata"""
    
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    model_dir = "models"
    os.makedirs(model_dir, exist_ok=True)
    
    for model_name, model_data in models.items():
        # Save model
        model_path = f"{model_dir}/xgboost_envelope_{model_name}_{timestamp}.pkl"
        with open(model_path, 'wb') as f:
            pickle.dump(model_data['model'], f)
        
        # Save metadata
        metadata = {
            'model_id': f"xgboost_envelope_{model_name}_{timestamp}",
            'created_at': timestamp,
            'model_type': 'xgboost_performance_envelope',
            'target': model_name,
            'features': model_data['feature_columns'],
            'performance': {
                'train_mae': model_data['train_mae'],
                'test_mae': model_data['test_mae'],
                'train_r2': model_data['train_r2'],
                'test_r2': model_data['test_r2']
            },
            'training_data_size': len(models[list(models.keys())[0]]['feature_columns']),
            'description': f"Performance envelope {model_name} trained on 698K+ view snapshots"
        }
        
        metadata_path = f"{model_dir}/xgboost_envelope_{model_name}_{timestamp}_metadata.json"
        with open(metadata_path, 'w') as f:
            json.dump(metadata, f, indent=2)
        
        print(f"💾 Saved {model_name}: {model_path}")

def main():
    """Main training pipeline"""
    
    print("🚀 Performance Envelope ML Training Pipeline")
    print("=" * 50)
    
    # Step 1: Fetch training data
    df = fetch_training_data(limit=1000)  # Start with 1K records for testing
    if df is None:
        return
    
    # Step 2: Prepare features
    df_enhanced = prepare_features(df)
    
    # Step 3: Create envelope targets
    envelope_targets = create_performance_envelope_targets(df_enhanced)
    
    # Step 4: Train models
    models = train_envelope_model(df_enhanced, envelope_targets)
    
    # Step 5: Save models
    save_models(models)
    
    print("\n✅ Performance envelope ML training complete!")
    print("🎯 Models can now predict p10, p50, p90 performance envelopes")
    print("📊 Ready for testing against current global curve approach")

if __name__ == "__main__":
    main()