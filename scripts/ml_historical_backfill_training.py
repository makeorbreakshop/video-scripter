#!/usr/bin/env python3

"""
Historical Video Performance Backfill ML System
Trains ML models to predict daily view progression for videos with missing tracking data
"""

import json
import pandas as pd
import numpy as np
from sklearn.ensemble import RandomForestRegressor
from sklearn.preprocessing import LabelEncoder, StandardScaler
from sklearn.model_selection import train_test_split
from sklearn.metrics import mean_absolute_error, r2_score
import pickle
import matplotlib.pyplot as plt
import seaborn as sns
from datetime import datetime
import warnings
warnings.filterwarnings('ignore')

class HistoricalBackfillTrainer:
    def __init__(self):
        self.model = None
        self.scalers = {}
        self.encoders = {}
        self.metadata = {}
        
    def load_data(self):
        """Load the 671K view snapshots dataset"""
        print("📊 Loading 671K view snapshots dataset...")
        
        # Load all batch files
        all_data = []
        batch_files = [
            'data/ml_training_batch_1.json',
            'data/ml_training_batch_2.json', 
            'data/ml_training_batch_3.json',
            'data/ml_training_batch_4.json',
            'data/ml_training_batch_5.json',
            'data/ml_training_batch_6.json',
            'data/ml_training_batch_7.json',
            'data/ml_training_batch_8.json',
            'data/ml_training_batch_9.json',
            'data/ml_training_batch_10.json',
            'data/ml_training_batch_11.json',
            'data/ml_training_batch_12.json',
            'data/ml_training_batch_13.json',
            'data/ml_training_batch_14.json'
        ]
        
        for batch_file in batch_files:
            try:
                print(f"   Loading {batch_file}...")
                with open(batch_file, 'r') as f:
                    batch_data = json.load(f)
                all_data.extend(batch_data)
            except FileNotFoundError:
                print(f"   ⚠️ Batch file not found: {batch_file}")
                continue
        
        print(f"✅ Loaded {len(all_data):,} view snapshot records")
        
        # Convert to DataFrame
        df = pd.DataFrame(all_data)
        
        # Convert numeric columns
        numeric_columns = [
            'subscriber_count', 'channel_video_count', 'view_count', 
            'days_since_published', 'title_length', 'title_word_count',
            'day_of_week', 'hour_of_day'
        ]
        
        for col in numeric_columns:
            df[col] = pd.to_numeric(df[col], errors='coerce')
        
        # Remove invalid records
        df = df.dropna(subset=['view_count', 'days_since_published', 'video_id'])
        df = df[df['view_count'] > 0]
        df = df[df['days_since_published'] >= 0]
        
        print(f"📊 Data after cleaning: {len(df):,} records")
        print(f"📊 Videos: {df['video_id'].nunique():,}")
        print(f"📊 Channels: {df['channel_name'].nunique():,}")
        print(f"📊 Days range: {df['days_since_published'].min()}-{df['days_since_published'].max()}")
        
        return df
    
    def prepare_training_data(self, df):
        """Prepare data for training daily view progression model"""
        print("🔧 Preparing training data for daily progression model...")
        
        # Filter to videos with multiple snapshots for progression learning
        video_counts = df['video_id'].value_counts()
        multi_snapshot_videos = video_counts[video_counts >= 3].index
        training_df = df[df['video_id'].isin(multi_snapshot_videos)].copy()
        
        print(f"📊 Training on {len(training_df):,} snapshots from {len(multi_snapshot_videos):,} videos")
        
        # Sort by video and days for progression analysis
        training_df = training_df.sort_values(['video_id', 'days_since_published'])
        
        # Calculate video-level statistics for each video
        video_stats = training_df.groupby('video_id').agg({
            'view_count': ['min', 'max', 'count'],
            'days_since_published': ['min', 'max'],
            'subscriber_count': 'first',
            'channel_video_count': 'first',
            'channel_name': 'first',
            'title_length': 'first',
            'title_word_count': 'first',
            'format_type': 'first',
            'topic_domain': 'first',
            'day_of_week': 'first',
            'hour_of_day': 'first'
        }).reset_index()
        
        # Flatten column names
        video_stats.columns = [
            'video_id', 'min_views', 'max_views', 'snapshot_count',
            'min_days', 'max_days', 'subscriber_count', 'channel_video_count',
            'channel_name', 'title_length', 'title_word_count', 
            'format_type', 'topic_domain', 'day_of_week', 'hour_of_day'
        ]
        
        # Calculate channel baselines (median performance)
        channel_baselines = training_df.groupby('channel_name')['view_count'].median().to_dict()
        
        # Merge back with main data
        training_df = training_df.merge(video_stats[['video_id', 'min_views', 'max_views', 'snapshot_count']], on='video_id')
        training_df['channel_baseline'] = training_df['channel_name'].map(channel_baselines)
        
        # Create features for progression modeling
        training_df['log_subscriber_count'] = np.log1p(training_df['subscriber_count'])
        training_df['log_channel_baseline'] = np.log1p(training_df['channel_baseline'])
        training_df['days_category'] = pd.cut(training_df['days_since_published'], 
                                            bins=[0, 7, 30, 90, 365, float('inf')], 
                                            labels=['week1', 'month1', 'month3', 'year1', 'long_term'])
        
        # Subscriber tier
        training_df['subscriber_tier'] = pd.cut(training_df['subscriber_count'],
                                              bins=[0, 1000, 10000, 100000, 1000000, float('inf')],
                                              labels=['micro', 'small', 'medium', 'large', 'mega'])
        
        # Target variable: log views for better distribution
        training_df['log_view_count'] = np.log1p(training_df['view_count'])
        
        print(f"✅ Prepared {len(training_df):,} training samples")
        
        return training_df
    
    def train_progression_model(self, training_df):
        """Train Random Forest model to predict daily view progression"""
        print("🤖 Training daily view progression model...")
        
        # Feature columns
        feature_columns = [
            'days_since_published',
            'log_subscriber_count',
            'channel_video_count', 
            'log_channel_baseline',
            'title_length',
            'title_word_count',
            'day_of_week',
            'hour_of_day'
        ]
        
        categorical_columns = ['format_type', 'topic_domain', 'days_category', 'subscriber_tier']
        
        # Encode categorical variables
        df_encoded = training_df.copy()
        
        for col in categorical_columns:
            if col in df_encoded.columns:
                encoder = LabelEncoder()
                # Handle missing values - convert to string first
                df_encoded[col] = df_encoded[col].astype(str).fillna('unknown')
                df_encoded[f'{col}_encoded'] = encoder.fit_transform(df_encoded[col])
                self.encoders[col] = encoder
                feature_columns.append(f'{col}_encoded')
        
        # Prepare features and target
        X = df_encoded[feature_columns].fillna(0)
        y = df_encoded['log_view_count']
        
        # Scale numerical features
        scaler = StandardScaler()
        numerical_cols = [col for col in feature_columns if not col.endswith('_encoded')]
        X_scaled = X.copy()
        X_scaled[numerical_cols] = scaler.fit_transform(X[numerical_cols])
        self.scalers['features'] = scaler
        
        # Split data
        X_train, X_test, y_train, y_test = train_test_split(
            X_scaled, y, test_size=0.2, random_state=42
        )
        
        print(f"📊 Training set: {len(X_train):,} samples")
        print(f"📊 Test set: {len(X_test):,} samples")
        print(f"📊 Features: {len(feature_columns)}")
        
        # Train Random Forest model
        self.model = RandomForestRegressor(
            n_estimators=100,
            max_depth=15,
            min_samples_split=20,
            min_samples_leaf=10,
            random_state=42,
            n_jobs=-1
        )
        
        self.model.fit(X_train, y_train)
        
        # Evaluate model
        y_pred_train = self.model.predict(X_train)
        y_pred_test = self.model.predict(X_test)
        
        train_mae = mean_absolute_error(y_train, y_pred_train)
        test_mae = mean_absolute_error(y_test, y_pred_test)
        train_r2 = r2_score(y_train, y_pred_train)
        test_r2 = r2_score(y_test, y_pred_test)
        
        print(f"📊 Training MAE: {train_mae:.3f}")
        print(f"📊 Test MAE: {test_mae:.3f}")
        print(f"📊 Training R²: {train_r2:.3f}")
        print(f"📊 Test R²: {test_r2:.3f}")
        
        # Feature importance
        feature_importance = pd.DataFrame({
            'feature': feature_columns,
            'importance': self.model.feature_importances_
        }).sort_values('importance', ascending=False)
        
        print(f"\n🔍 Top 10 Most Important Features:")
        for idx, row in feature_importance.head(10).iterrows():
            print(f"   {row['feature']}: {row['importance']:.3f}")
        
        # Store metadata
        self.metadata = {
            'model_type': 'RandomForestRegressor',
            'feature_columns': feature_columns,
            'training_samples': len(X_train),
            'test_samples': len(X_test),
            'train_mae': train_mae,
            'test_mae': test_mae,
            'train_r2': train_r2,
            'test_r2': test_r2,
            'feature_importance': feature_importance.to_dict('records'),
            'training_date': datetime.now().isoformat()
        }
        
        return feature_importance
    
    def save_models(self):
        """Save trained model and preprocessing objects"""
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        
        # Save model
        model_path = f'models/historical_backfill_model_{timestamp}.pkl'
        with open(model_path, 'wb') as f:
            pickle.dump(self.model, f)
        
        # Save scalers and encoders
        preprocessing_path = f'models/historical_backfill_preprocessing_{timestamp}.pkl'
        with open(preprocessing_path, 'wb') as f:
            pickle.dump({
                'scalers': self.scalers,
                'encoders': self.encoders
            }, f)
        
        # Save metadata
        metadata_path = f'models/historical_backfill_metadata_{timestamp}.json'
        with open(metadata_path, 'w') as f:
            json.dump(self.metadata, f, indent=2)
        
        print(f"💾 Model saved: {model_path}")
        print(f"💾 Preprocessing saved: {preprocessing_path}")
        print(f"💾 Metadata saved: {metadata_path}")
        
        return timestamp
    
    def create_visualizations(self, training_df, feature_importance):
        """Create visualizations for model analysis"""
        print("📊 Creating training visualizations...")
        
        fig, axes = plt.subplots(2, 2, figsize=(15, 12))
        
        # 1. Feature importance
        ax1 = axes[0, 0]
        top_features = feature_importance.head(10)
        ax1.barh(top_features['feature'], top_features['importance'])
        ax1.set_title('Top 10 Feature Importance')
        ax1.set_xlabel('Importance')
        
        # 2. View progression over days
        ax2 = axes[0, 1]
        sample_videos = training_df['video_id'].unique()[:20]
        for video_id in sample_videos:
            video_data = training_df[training_df['video_id'] == video_id].sort_values('days_since_published')
            if len(video_data) >= 3:
                ax2.plot(video_data['days_since_published'], video_data['view_count'], 
                        alpha=0.6, linewidth=1)
        ax2.set_xlabel('Days Since Published')
        ax2.set_ylabel('View Count')
        ax2.set_title('Sample Video Progression Curves')
        ax2.set_yscale('log')
        
        # 3. Distribution of tracking periods
        ax3 = axes[1, 0]
        video_stats = training_df.groupby('video_id')['days_since_published'].agg(['min', 'max', 'count'])
        video_stats['tracking_period'] = video_stats['max'] - video_stats['min']
        ax3.hist(video_stats['tracking_period'], bins=50, alpha=0.7)
        ax3.set_xlabel('Tracking Period (Days)')
        ax3.set_ylabel('Number of Videos')
        ax3.set_title('Distribution of Video Tracking Periods')
        
        # 4. Channel baseline vs subscriber count
        ax4 = axes[1, 1]
        channel_data = training_df.groupby('channel_name').agg({
            'subscriber_count': 'first',
            'channel_baseline': 'first'
        }).reset_index()
        ax4.scatter(channel_data['subscriber_count'], channel_data['channel_baseline'], alpha=0.6)
        ax4.set_xlabel('Subscriber Count')
        ax4.set_ylabel('Channel Baseline Views')
        ax4.set_title('Channel Baseline vs Subscriber Count')
        ax4.set_xscale('log')
        ax4.set_yscale('log')
        
        plt.tight_layout()
        
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        viz_path = f'data/historical_backfill_training_{timestamp}.png'
        plt.savefig(viz_path, dpi=300, bbox_inches='tight')
        print(f"💾 Training visualization saved: {viz_path}")
        
        return viz_path

def main():
    print("🚀 Historical Video Performance Backfill Training")
    print("=" * 60)
    
    trainer = HistoricalBackfillTrainer()
    
    # Load data
    df = trainer.load_data()
    
    # Prepare training data
    training_df = trainer.prepare_training_data(df)
    
    # Train model
    feature_importance = trainer.train_progression_model(training_df)
    
    # Save models
    timestamp = trainer.save_models()
    
    # Create visualizations
    viz_path = trainer.create_visualizations(training_df, feature_importance)
    
    print("\n" + "=" * 60)
    print("🎉 Historical backfill training complete!")
    print(f"✅ Model can predict daily view progression based on:")
    print(f"   - Video characteristics (title, format, topic)")
    print(f"   - Channel characteristics (subscribers, baseline performance)")
    print(f"   - Temporal factors (days since publish, publish timing)")
    print(f"✅ Model accuracy: {trainer.metadata['test_r2']:.1%} R² score")
    print(f"💾 Model saved with timestamp: {timestamp}")
    print("=" * 60)

if __name__ == "__main__":
    main()