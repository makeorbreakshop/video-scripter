#!/usr/bin/env python3

"""
Train ML performance envelope models on real 671K dataset
Creates p10, p50, p90 envelope prediction models
"""

import json
import pandas as pd
import numpy as np
from sklearn.model_selection import train_test_split
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import mean_absolute_error, r2_score
from sklearn.preprocessing import LabelEncoder
import xgboost as xgb
import glob
import pickle
from datetime import datetime
import warnings
warnings.filterwarnings('ignore')

class MLEnvelopeTrainer:
    def __init__(self):
        self.models = {}
        self.feature_encoders = {}
        self.training_metadata = {}
        
    def load_real_dataset(self):
        """Load the real 671K dataset from batch files"""
        print("🔄 Loading real ML training dataset...")
        
        # Load all batch files
        batch_files = sorted(glob.glob('data/ml_training_batch_*.json'))
        all_records = []
        
        for i, batch_file in enumerate(batch_files, 1):
            print(f"📂 Loading batch {i}/{len(batch_files)}: {batch_file}")
            with open(batch_file, 'r') as f:
                batch_data = json.load(f)
                all_records.extend(batch_data)
        
        print(f"📊 Loaded {len(all_records):,} total records")
        
        # Convert to DataFrame
        df = pd.DataFrame(all_records)
        
        # Data cleaning and feature engineering
        print("🛠️ Cleaning and engineering features...")
        
        # Convert numeric columns to proper types
        numeric_columns = ['subscriber_count', 'channel_video_count', 'view_count', 
                          'days_since_published', 'title_length', 'title_word_count',
                          'day_of_week', 'hour_of_day']
        
        for col in numeric_columns:
            df[col] = pd.to_numeric(df[col], errors='coerce')
        
        # Handle missing values
        df = df.dropna(subset=['subscriber_count', 'view_count', 'days_since_published'])
        
        # Feature engineering
        df['log_subscriber_count'] = np.log1p(df['subscriber_count'])
        df['log_view_count'] = np.log1p(df['view_count'])
        df['title_word_density'] = df['title_length'] / (df['title_word_count'] + 1)
        df['days_category'] = pd.cut(df['days_since_published'], 
                                   bins=[0, 30, 90, 365, 730, float('inf')], 
                                   labels=['0-30', '31-90', '91-365', '366-730', '730+'])
        df['subscriber_tier'] = pd.cut(df['subscriber_count'], 
                                     bins=[0, 1000, 10000, 100000, 1000000, float('inf')],
                                     labels=['micro', 'small', 'medium', 'large', 'mega'])
        
        print(f"✅ Cleaned dataset: {len(df):,} records")
        print(f"📈 Date range: {df['days_since_published'].min()}-{df['days_since_published'].max()} days")
        print(f"👥 Channels: {df['channel_name'].nunique():,}")
        print(f"🎥 Videos: {df['video_id'].nunique():,}")
        
        return df
    
    def create_envelope_training_data(self, df):
        """Create training data for envelope prediction (p10, p50, p90)"""
        print("📊 Creating envelope training data...")
        
        # Group by video and calculate performance envelopes across time
        envelope_data = []
        
        videos_processed = 0
        for video_id, video_data in df.groupby('video_id'):
            videos_processed += 1
            if videos_processed % 10000 == 0:
                print(f"  Processed {videos_processed:,}/{df['video_id'].nunique():,} videos")
            
            # Need at least 5 data points for envelope calculation
            if len(video_data) < 5:
                continue
            
            # Sort by days since published
            video_data = video_data.sort_values('days_since_published')
            
            # Get video characteristics (use first record as they're the same for all snapshots)
            first_record = video_data.iloc[0]
            
            # Calculate view count percentiles across the video's lifetime
            view_counts = video_data['view_count'].values
            p10 = np.percentile(view_counts, 10)
            p50 = np.percentile(view_counts, 50) 
            p90 = np.percentile(view_counts, 90)
            
            # Create training record
            record = {
                'video_id': video_id,
                'channel_name': first_record['channel_name'],
                'format_type': first_record['format_type'],
                'topic_cluster_id': first_record['topic_cluster_id'],
                'topic_domain': first_record['topic_domain'],
                'subscriber_count': first_record['subscriber_count'],
                'log_subscriber_count': first_record['log_subscriber_count'],
                'channel_video_count': first_record['channel_video_count'],
                'title_length': first_record['title_length'],
                'title_word_count': first_record['title_word_count'],
                'title_word_density': first_record['title_word_density'],
                'day_of_week': first_record['day_of_week'],
                'hour_of_day': first_record['hour_of_day'],
                'days_category': first_record['days_category'],
                'subscriber_tier': first_record['subscriber_tier'],
                'max_days_tracked': video_data['days_since_published'].max(),
                'num_snapshots': len(video_data),
                
                # Envelope targets
                'p10_views': p10,
                'p50_views': p50,
                'p90_views': p90,
                'log_p10_views': np.log1p(p10),
                'log_p50_views': np.log1p(p50),
                'log_p90_views': np.log1p(p90)
            }
            
            envelope_data.append(record)
        
        envelope_df = pd.DataFrame(envelope_data)
        print(f"✅ Created envelope dataset: {len(envelope_df):,} videos for training")
        
        return envelope_df
    
    def prepare_features(self, df):
        """Prepare features for ML training"""
        print("🛠️ Preparing features for training...")
        
        # Categorical features to encode
        categorical_features = ['format_type', 'topic_domain', 'days_category', 'subscriber_tier']
        
        # Encode categorical features
        for feature in categorical_features:
            if feature not in self.feature_encoders:
                self.feature_encoders[feature] = LabelEncoder()
                df[f'{feature}_encoded'] = self.feature_encoders[feature].fit_transform(df[feature].astype(str))
            else:
                df[f'{feature}_encoded'] = self.feature_encoders[feature].transform(df[feature].astype(str))
        
        # Select final feature set
        feature_columns = [
            'log_subscriber_count', 'channel_video_count',
            'title_length', 'title_word_count', 'title_word_density',
            'day_of_week', 'hour_of_day', 'max_days_tracked', 'num_snapshots',
            'format_type_encoded', 'topic_domain_encoded', 
            'days_category_encoded', 'subscriber_tier_encoded'
        ]
        
        # Handle any remaining missing values
        X = df[feature_columns].fillna(0)
        
        print(f"✅ Feature matrix: {X.shape[0]:,} samples × {X.shape[1]} features")
        print(f"📊 Feature columns: {feature_columns}")
        
        return X, feature_columns
    
    def train_envelope_models(self, envelope_df):
        """Train separate models for p10, p50, p90 predictions"""
        print("🤖 Training envelope prediction models...")
        
        # Prepare features
        X, feature_columns = self.prepare_features(envelope_df)
        
        # Train models for each percentile
        targets = ['log_p10_views', 'log_p50_views', 'log_p90_views']
        target_names = ['p10', 'p50', 'p90']
        
        for target, name in zip(targets, target_names):
            print(f"\n📈 Training {name} model...")
            
            y = envelope_df[target]
            
            # Train/test split
            X_train, X_test, y_train, y_test = train_test_split(
                X, y, test_size=0.2, random_state=42
            )
            
            # Train XGBoost model
            model = xgb.XGBRegressor(
                n_estimators=100,
                max_depth=8,
                learning_rate=0.1,
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
            
            print(f"  Training MAE: {train_mae:.3f}")
            print(f"  Testing MAE: {test_mae:.3f}")
            print(f"  Training R²: {train_r2:.3f}")
            print(f"  Testing R²: {test_r2:.3f}")
            
            # Store model and metrics
            self.models[name] = model
            self.training_metadata[name] = {
                'train_mae': train_mae,
                'test_mae': test_mae,
                'train_r2': train_r2,
                'test_r2': test_r2,
                'training_samples': len(X_train),
                'test_samples': len(X_test)
            }
        
        # Store feature columns
        self.training_metadata['feature_columns'] = feature_columns
        self.training_metadata['training_date'] = datetime.now().isoformat()
        
        print("\n✅ All envelope models trained successfully!")
        
    def save_models(self):
        """Save trained models and metadata"""
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        
        # Save models
        for name, model in self.models.items():
            model_path = f'models/envelope_model_{name}_{timestamp}.pkl'
            with open(model_path, 'wb') as f:
                pickle.dump(model, f)
            print(f"💾 Saved {name} model: {model_path}")
        
        # Save encoders
        encoders_path = f'models/envelope_encoders_{timestamp}.pkl'
        with open(encoders_path, 'wb') as f:
            pickle.dump(self.feature_encoders, f)
        print(f"💾 Saved encoders: {encoders_path}")
        
        # Save metadata
        metadata_path = f'models/envelope_training_metadata_{timestamp}.json'
        with open(metadata_path, 'w') as f:
            json.dump(self.training_metadata, f, indent=2)
        print(f"💾 Saved metadata: {metadata_path}")
        
        return timestamp
    
    def generate_test_predictions(self, envelope_df, timestamp):
        """Generate test predictions for validation"""
        print("🧪 Generating test predictions...")
        
        # Take a sample for testing
        test_sample = envelope_df.sample(n=min(1000, len(envelope_df)), random_state=42)
        X_test, _ = self.prepare_features(test_sample)
        
        predictions = {}
        for name, model in self.models.items():
            predictions[f'{name}_pred'] = np.expm1(model.predict(X_test))  # Convert back from log
        
        # Add actual values
        predictions['actual_p10'] = np.expm1(test_sample['log_p10_views'].values)
        predictions['actual_p50'] = np.expm1(test_sample['log_p50_views'].values)  
        predictions['actual_p90'] = np.expm1(test_sample['log_p90_views'].values)
        
        # Add video info
        predictions['video_id'] = test_sample['video_id'].values
        predictions['channel_name'] = test_sample['channel_name'].values
        
        # Save predictions
        pred_df = pd.DataFrame(predictions)
        pred_path = f'data/envelope_test_predictions_{timestamp}.csv'
        pred_df.to_csv(pred_path, index=False)
        print(f"💾 Saved test predictions: {pred_path}")
        
        # Show sample results
        print("\n📊 Sample predictions:")
        print(pred_df[['channel_name', 'actual_p50', 'p50_pred']].head())

def main():
    print("🚀 Starting ML Envelope Training on Real Dataset")
    print("="*60)
    
    trainer = MLEnvelopeTrainer()
    
    # Load real dataset
    df = trainer.load_real_dataset()
    
    # Create envelope training data
    envelope_df = trainer.create_envelope_training_data(df)
    
    # Train models
    trainer.train_envelope_models(envelope_df)
    
    # Save everything
    timestamp = trainer.save_models()
    
    # Generate test predictions
    trainer.generate_test_predictions(envelope_df, timestamp)
    
    print("\n" + "="*60)
    print("🎉 ML Envelope Training Complete!")
    print(f"📊 Dataset: {len(df):,} records → {len(envelope_df):,} videos")
    print(f"🤖 Models: p10, p50, p90 envelope predictors")
    print(f"💾 Saved with timestamp: {timestamp}")
    print("🧪 Ready for performance envelope comparison testing!")
    print("="*60)

if __name__ == "__main__":
    main()