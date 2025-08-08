#!/usr/bin/env python3

"""
Full Growth Rate ML Training System
Train on complete 671K dataset for production-ready growth rate prediction
"""

import json
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
from datetime import datetime
from sklearn.ensemble import RandomForestRegressor
from sklearn.preprocessing import StandardScaler, LabelEncoder
from sklearn.model_selection import train_test_split
from sklearn.metrics import r2_score, mean_absolute_error
import joblib
import warnings
warnings.filterwarnings('ignore')

class FullGrowthRateTrainer:
    def __init__(self):
        self.growth_model = None
        self.scaler = None
        self.label_encoders = {}
        self.training_stats = {}
        
    def load_complete_dataset(self):
        """Load all 14 batches - complete 671K dataset"""
        print("🚀 FULL GROWTH RATE ML TRAINING SYSTEM")
        print("=" * 60)
        print("📊 Loading complete 671K dataset...")
        
        all_data = []
        successful_batches = []
        
        for batch_num in range(1, 15):  # Batches 1-14
            try:
                batch_file = f'data/ml_training_batch_{batch_num}.json'
                with open(batch_file, 'r') as f:
                    batch_data = json.load(f)
                    all_data.extend(batch_data)
                    successful_batches.append(batch_num)
                    print(f"   ✅ Batch {batch_num}: {len(batch_data):,} records")
            except FileNotFoundError:
                print(f"   ❌ Batch {batch_num}: File not found")
                continue
            except Exception as e:
                print(f"   ❌ Batch {batch_num}: Error - {e}")
                continue
        
        print(f"\n✅ Successfully loaded {len(successful_batches)} batches")
        print(f"📊 Total records: {len(all_data):,}")
        
        # Convert to DataFrame
        df = pd.DataFrame(all_data)
        
        # Data type conversion
        print("🔄 Processing data types...")
        numeric_cols = ['view_count', 'days_since_published', 'subscriber_count', 'title_length']
        
        for col in numeric_cols:
            df[col] = pd.to_numeric(df[col], errors='coerce')
        
        # Clean data
        initial_count = len(df)
        df = df.dropna(subset=['view_count', 'days_since_published', 'video_id'])
        df = df[df['view_count'] > 0]
        df = df[df['days_since_published'] >= 0]
        
        print(f"✅ Cleaned dataset: {len(df):,} records ({initial_count - len(df):,} removed)")
        
        # Dataset statistics
        print(f"\n📈 DATASET STATISTICS:")
        print(f"   Videos: {df['video_id'].nunique():,}")
        print(f"   Channels: {df['channel_name'].nunique():,}")
        print(f"   View range: {df['view_count'].min():,} to {df['view_count'].max():,}")
        print(f"   Days range: {df['days_since_published'].min()} to {df['days_since_published'].max()}")
        print(f"   Subscriber range: {df['subscriber_count'].min():,} to {df['subscriber_count'].max():,}")
        
        self.training_stats['total_records'] = len(df)
        self.training_stats['unique_videos'] = df['video_id'].nunique()
        self.training_stats['unique_channels'] = df['channel_name'].nunique()
        
        return df
    
    def create_growth_rate_dataset(self, df):
        """Create comprehensive growth rate training samples"""
        print(f"\n🔄 Creating growth rate training dataset...")
        print("   Processing all videos with multiple snapshots...")
        
        growth_samples = []
        video_ids = df['video_id'].unique()
        
        print(f"   Processing {len(video_ids):,} unique videos...")
        
        processed_videos = 0
        valid_growth_samples = 0
        
        for i, video_id in enumerate(video_ids):
            if i % 25000 == 0:
                print(f"   Progress: {i:,}/{len(video_ids):,} videos ({i/len(video_ids)*100:.1f}%)")
            
            video_data = df[df['video_id'] == video_id].sort_values('days_since_published')
            
            if len(video_data) < 2:
                continue
            
            processed_videos += 1
            
            # Create growth samples between consecutive snapshots
            for j in range(len(video_data) - 1):
                current_row = video_data.iloc[j]
                next_row = video_data.iloc[j + 1]
                
                # Calculate time difference
                days_diff = next_row['days_since_published'] - current_row['days_since_published']
                if days_diff <= 0:
                    continue
                
                # Calculate growth ratio
                if current_row['view_count'] <= 0 or next_row['view_count'] <= 0:
                    continue
                
                view_ratio = next_row['view_count'] / current_row['view_count']
                
                # Calculate daily growth rate
                if view_ratio <= 0:
                    daily_growth_rate = -0.01  # Small decline
                else:
                    daily_growth_rate = view_ratio ** (1.0 / days_diff) - 1.0
                
                # Filter extreme outliers (but keep more data than before)
                if daily_growth_rate < -0.5 or daily_growth_rate > 1.0:  # -50% to +100% daily
                    continue
                
                # Create training sample
                sample = {
                    'video_id': video_id,
                    'channel_name': current_row['channel_name'],
                    'current_day': current_row['days_since_published'],
                    'current_log_views': np.log1p(current_row['view_count']),
                    'log_subscribers': np.log1p(current_row['subscriber_count']) if pd.notna(current_row['subscriber_count']) else 10.0,
                    'title_length': current_row['title_length'] if pd.notna(current_row['title_length']) else 50,
                    'days_to_next': days_diff,
                    'view_ratio': view_ratio,
                    'daily_growth_rate': daily_growth_rate
                }
                
                growth_samples.append(sample)
                valid_growth_samples += 1
        
        growth_df = pd.DataFrame(growth_samples)
        
        print(f"✅ Growth rate dataset created:")
        print(f"   Videos processed: {processed_videos:,}")
        print(f"   Growth samples: {len(growth_df):,}")
        print(f"   Growth rate range: {growth_df['daily_growth_rate'].min():.1%} to {growth_df['daily_growth_rate'].max():.1%}")
        print(f"   Mean growth rate: {growth_df['daily_growth_rate'].mean():.2%}")
        print(f"   Median growth rate: {growth_df['daily_growth_rate'].median():.2%}")
        
        self.training_stats['growth_samples'] = len(growth_df)
        self.training_stats['processed_videos'] = processed_videos
        
        return growth_df
    
    def train_growth_model(self, growth_df):
        """Train comprehensive growth rate model"""
        print(f"\n🤖 Training growth rate model on {len(growth_df):,} samples...")
        
        # Prepare features
        feature_cols = ['current_day', 'current_log_views', 'log_subscribers', 'title_length', 'days_to_next']
        
        X = growth_df[feature_cols].fillna(0)
        y = growth_df['daily_growth_rate']
        
        # Add channel encoding for better predictions
        print("   Encoding channel names...")
        self.label_encoders['channel'] = LabelEncoder()
        channel_encoded = self.label_encoders['channel'].fit_transform(growth_df['channel_name'].astype(str))
        
        # Add channel encoding to features
        X = X.copy()
        X['channel_encoded'] = channel_encoded
        
        print("   Scaling features...")
        self.scaler = StandardScaler()
        X_scaled = self.scaler.fit_transform(X)
        
        # Split for validation
        X_train, X_test, y_train, y_test = train_test_split(
            X_scaled, y, test_size=0.15, random_state=42, stratify=None
        )
        
        print(f"   Training set: {len(X_train):,} samples")
        print(f"   Test set: {len(X_test):,} samples")
        
        # Train comprehensive model
        print("   Training RandomForest model...")
        self.growth_model = RandomForestRegressor(
            n_estimators=200,  # More trees for better performance
            max_depth=15,      # Deeper trees for complex patterns
            min_samples_split=50,
            min_samples_leaf=20,
            max_features='sqrt',
            random_state=42,
            n_jobs=-1,
            verbose=0
        )
        
        self.growth_model.fit(X_train, y_train)
        
        # Evaluate model
        print("   Evaluating model performance...")
        
        train_pred = self.growth_model.predict(X_train)
        test_pred = self.growth_model.predict(X_test)
        
        train_r2 = r2_score(y_train, train_pred)
        test_r2 = r2_score(y_test, test_pred)
        train_mae = mean_absolute_error(y_train, train_pred)
        test_mae = mean_absolute_error(y_test, test_pred)
        
        print(f"\n✅ MODEL PERFORMANCE:")
        print(f"   Training R²: {train_r2:.1%}")
        print(f"   Test R²: {test_r2:.1%}")
        print(f"   Training MAE: {train_mae:.3f}")
        print(f"   Test MAE: {test_mae:.3f}")
        
        # Feature importance
        feature_names = feature_cols + ['channel_encoded']
        importances = self.growth_model.feature_importances_
        
        print(f"\n📊 FEATURE IMPORTANCE:")
        for name, importance in sorted(zip(feature_names, importances), key=lambda x: x[1], reverse=True):
            print(f"   {name}: {importance:.1%}")
        
        self.training_stats['train_r2'] = train_r2
        self.training_stats['test_r2'] = test_r2
        self.training_stats['train_mae'] = train_mae
        self.training_stats['test_mae'] = test_mae
        
        return test_r2
    
    def save_model(self):
        """Save trained model and components"""
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        
        model_files = {
            'model': f'models/full_growth_rate_model_{timestamp}.joblib',
            'scaler': f'models/full_growth_rate_scaler_{timestamp}.joblib',
            'encoders': f'models/full_growth_rate_encoders_{timestamp}.joblib',
            'stats': f'models/full_growth_rate_stats_{timestamp}.json'
        }
        
        print(f"\n💾 Saving model components...")
        
        try:
            joblib.dump(self.growth_model, model_files['model'])
            joblib.dump(self.scaler, model_files['scaler'])
            joblib.dump(self.label_encoders, model_files['encoders'])
            
            with open(model_files['stats'], 'w') as f:
                json.dump(self.training_stats, f, indent=2)
            
            print(f"✅ Model saved:")
            for component, path in model_files.items():
                print(f"   {component}: {path}")
                
        except Exception as e:
            print(f"❌ Error saving model: {e}")
        
        return model_files
    
    def test_on_iltms(self, df):
        """Test the full model on ILTMS data"""
        print(f"\n🎬 Testing on I Like To Make Stuff channel...")
        
        iltms_data = df[df['channel_name'] == 'I Like To Make Stuff']
        recent_iltms = iltms_data[iltms_data['days_since_published'] <= 90]
        
        print(f"   ILTMS records: {len(iltms_data):,}")
        print(f"   Recent ILTMS (≤90 days): {len(recent_iltms):,}")
        
        if len(recent_iltms) == 0:
            print("   ❌ No recent ILTMS data for testing")
            return None
        
        # Find best video for testing
        video_groups = []
        for video_id in recent_iltms['video_id'].unique():
            video_data = recent_iltms[recent_iltms['video_id'] == video_id]
            if len(video_data) >= 3:
                video_groups.append({
                    'video_id': video_id,
                    'title': video_data['title'].iloc[0],
                    'data': video_data.sort_values('days_since_published'),
                    'max_views': video_data['view_count'].max()
                })
        
        if len(video_groups) == 0:
            print("   ❌ No ILTMS videos with sufficient data points")
            return None
        
        # Test on highest-performing video
        video_groups.sort(key=lambda x: x['max_views'], reverse=True)
        test_video = video_groups[0]
        
        print(f"   Testing: {test_video['title']}")
        print(f"   Data points: {len(test_video['data'])}")
        
        # Generate growth rate progression
        video_data = test_video['data']
        actual_days = video_data['days_since_published'].values
        actual_views = video_data['view_count'].values
        
        progression = self.generate_progression(test_video, 90)
        
        # Create visualization
        plt.figure(figsize=(14, 8))
        
        # Main progression plot
        plt.subplot(2, 1, 1)
        
        prog_days = [p['day'] for p in progression]
        prog_views = [p['views'] for p in progression]
        prog_types = [p['type'] for p in progression]
        
        plt.plot(prog_days, prog_views, 'b-', linewidth=2, label='Full Growth Rate ML')
        
        # Mark actual points
        actual_mask = [t == 'actual' for t in prog_types]
        actual_prog_days = [prog_days[i] for i in range(len(actual_mask)) if actual_mask[i]]
        actual_prog_views = [prog_views[i] for i in range(len(actual_mask)) if actual_mask[i]]
        
        plt.scatter(actual_prog_days, actual_prog_views, color='red', s=100, zorder=5, label='Actual Data')
        
        plt.title(f'Full Growth Rate ML Test: {test_video["title"][:50]}...')
        plt.xlabel('Days Since Published')
        plt.ylabel('View Count')
        plt.yscale('log')
        plt.legend()
        plt.grid(True, alpha=0.3)
        
        # Growth rates over time
        plt.subplot(2, 1, 2)
        
        growth_rates = []
        growth_days = []
        
        for i, p in enumerate(progression[1:], 1):
            if p['type'] == 'predicted':
                growth_rate = (p['views'] / progression[i-1]['views']) - 1
                growth_rates.append(growth_rate * 100)  # Convert to percentage
                growth_days.append(p['day'])
        
        plt.plot(growth_days, growth_rates, 'g-', linewidth=1, alpha=0.7)
        plt.title('Predicted Daily Growth Rates')
        plt.xlabel('Days Since Published')
        plt.ylabel('Daily Growth Rate (%)')
        plt.grid(True, alpha=0.3)
        plt.axhline(y=0, color='black', linestyle='--', alpha=0.5)
        
        plt.tight_layout()
        
        # Save
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        viz_path = f'data/full_growth_rate_test_{timestamp}.png'
        plt.savefig(viz_path, dpi=300, bbox_inches='tight')
        plt.close()
        
        print(f"   ✅ Test visualization: {viz_path}")
        
        return viz_path
    
    def generate_progression(self, test_video, max_days=90):
        """Generate smooth video progression using full growth rate model"""
        video_data = test_video['data']
        actual_days = video_data['days_since_published'].values
        actual_views = video_data['view_count'].values
        
        progression = []
        current_views = actual_views[0]
        
        # Get video metadata for predictions
        video_info = video_data.iloc[0]
        
        # Encode channel name
        try:
            channel_encoded = self.label_encoders['channel'].transform([video_info['channel_name']])[0]
        except:
            channel_encoded = 0  # Fallback for unknown channels
        
        for day in range(1, max_days + 1):
            if day in actual_days:
                # Use actual data
                idx = np.where(actual_days == day)[0][0]
                current_views = actual_views[idx]
                data_type = 'actual'
            else:
                # Predict growth rate
                growth_rate = self.predict_growth_rate(
                    day, current_views, video_info, channel_encoded
                )
                current_views = current_views * (1 + growth_rate)
                data_type = 'predicted'
            
            progression.append({
                'day': day,
                'views': current_views,
                'type': data_type
            })
        
        return progression
    
    def predict_growth_rate(self, day, current_views, video_info, channel_encoded):
        """Predict growth rate using full model"""
        if not self.growth_model or not self.scaler:
            return 0.01  # Fallback
        
        try:
            features = [
                day,
                np.log1p(current_views),
                np.log1p(video_info['subscriber_count']) if pd.notna(video_info['subscriber_count']) else 10.0,
                video_info['title_length'] if pd.notna(video_info['title_length']) else 50,
                1,  # days_to_next = 1 for daily prediction
                channel_encoded
            ]
            
            features_scaled = self.scaler.transform([features])
            growth_rate = self.growth_model.predict(features_scaled)[0]
            
            # Clamp to reasonable range
            return max(min(growth_rate, 0.15), -0.1)  # -10% to +15% daily
            
        except Exception as e:
            return 0.01  # Fallback minimal growth
    
    def run_full_training(self):
        """Execute complete training pipeline"""
        print(f"🚀 STARTING FULL GROWTH RATE ML TRAINING...")
        start_time = datetime.now()
        
        # Load complete dataset
        df = self.load_complete_dataset()
        
        # Create growth rate training data
        growth_df = self.create_growth_rate_dataset(df)
        
        # Train model
        test_r2 = self.train_growth_model(growth_df)
        
        # Save model
        model_files = self.save_model()
        
        # Test on ILTMS
        viz_path = self.test_on_iltms(df)
        
        # Final summary
        end_time = datetime.now()
        duration = end_time - start_time
        
        print(f"\n🎉 FULL GROWTH RATE TRAINING COMPLETE!")
        print(f"=" * 60)
        print(f"⏱️  Total time: {duration}")
        print(f"📊 Dataset: {self.training_stats['total_records']:,} records")
        print(f"🎬 Videos: {self.training_stats['unique_videos']:,}")
        print(f"📺 Channels: {self.training_stats['unique_channels']:,}")
        print(f"🔄 Growth samples: {self.training_stats['growth_samples']:,}")
        print(f"🎯 Model accuracy: R² = {test_r2:.1%}")
        print(f"💾 Model saved: {model_files['model']}")
        if viz_path:
            print(f"🎨 Test visualization: {viz_path}")
        
        return {
            'model_files': model_files,
            'test_r2': test_r2,
            'training_stats': self.training_stats,
            'viz_path': viz_path
        }

def main():
    trainer = FullGrowthRateTrainer()
    results = trainer.run_full_training()
    return results

if __name__ == "__main__":
    main()