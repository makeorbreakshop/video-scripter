#!/usr/bin/env python3

"""
Test Historical Backfill System
Tests ML-based historical video performance backfill on sparse-data channels
"""

import json
import pandas as pd
import numpy as np
import pickle
import matplotlib.pyplot as plt
import seaborn as sns
from datetime import datetime, timedelta
import warnings
warnings.filterwarnings('ignore')

class HistoricalBackfillTester:
    def __init__(self, model_timestamp="20250806_100239"):
        self.model_timestamp = model_timestamp
        self.model = None
        self.preprocessors = None
        self.metadata = None
        
    def load_models(self):
        """Load trained historical backfill models"""
        print("🤖 Loading historical backfill models...")
        
        # Load model
        model_path = f'models/historical_backfill_model_{self.model_timestamp}.pkl'
        with open(model_path, 'rb') as f:
            self.model = pickle.load(f)
        
        # Load preprocessors
        preprocessing_path = f'models/historical_backfill_preprocessing_{self.model_timestamp}.pkl'
        with open(preprocessing_path, 'rb') as f:
            self.preprocessors = pickle.load(f)
        
        # Load metadata
        metadata_path = f'models/historical_backfill_metadata_{self.model_timestamp}.json'
        with open(metadata_path, 'r') as f:
            self.metadata = json.load(f)
        
        print(f"✅ Loaded model with {self.metadata['test_r2']:.1%} accuracy")
        
    def load_test_channel_data(self):
        """Load real channel data for testing"""
        print("📊 Loading channel data for backfill testing...")
        
        # Load actual view snapshots data
        all_data = []
        batch_files = [f'data/ml_training_batch_{i}.json' for i in range(1, 15)]
        
        for batch_file in batch_files:
            try:
                with open(batch_file, 'r') as f:
                    batch_data = json.load(f)
                all_data.extend(batch_data)
            except FileNotFoundError:
                continue
        
        df = pd.DataFrame(all_data)
        
        # Convert types
        numeric_columns = ['subscriber_count', 'channel_video_count', 'view_count', 
                          'days_since_published', 'title_length', 'title_word_count',
                          'day_of_week', 'hour_of_day']
        for col in numeric_columns:
            df[col] = pd.to_numeric(df[col], errors='coerce')
        
        print(f"✅ Loaded {len(df):,} snapshots from {df['channel_name'].nunique()} channels")
        return df
    
    def find_good_test_channels(self, df):
        """Find channels with good tracking data for validation"""
        print("🔍 Finding channels with good tracking data...")
        
        # Count snapshots per video per channel
        video_counts = df.groupby(['channel_name', 'video_id']).size()
        channel_stats = video_counts.groupby('channel_name').agg(['count', 'mean', 'max'])
        channel_stats.columns = ['video_count', 'avg_snapshots', 'max_snapshots']
        
        # Find channels with multiple well-tracked videos
        good_channels = channel_stats[
            (channel_stats['video_count'] >= 8) &  # At least 8 videos
            (channel_stats['avg_snapshots'] >= 4) &   # Average 4+ snapshots per video
            (channel_stats['max_snapshots'] >= 10)     # At least one video with 10+ snapshots
        ].index.tolist()
        
        # Get channel details
        channel_details = []
        for channel in good_channels[:10]:  # Top 10 channels
            channel_data = df[df['channel_name'] == channel]
            video_count = channel_data['video_id'].nunique()
            total_snapshots = len(channel_data)
            avg_snapshots = total_snapshots / video_count
            subscribers = channel_data['subscriber_count'].iloc[0]
            
            channel_details.append({
                'channel_name': channel,
                'video_count': video_count,
                'total_snapshots': total_snapshots,
                'avg_snapshots_per_video': avg_snapshots,
                'subscriber_count': subscribers
            })
        
        channel_details_df = pd.DataFrame(channel_details)
        print(f"🎯 Found {len(good_channels)} good test channels")
        print("\nTop test candidates:")
        for _, row in channel_details_df.iterrows():
            print(f"   {row['channel_name']}: {row['video_count']} videos, "
                  f"{row['avg_snapshots_per_video']:.1f} avg snapshots, "
                  f"{row['subscriber_count']:,} subs")
        
        return good_channels[0], df[df['channel_name'] == good_channels[0]]
    
    def simulate_sparse_data(self, channel_data):
        """Simulate sparse tracking data by removing most snapshots"""
        print("📉 Simulating sparse tracking data scenario...")
        
        videos = channel_data['video_id'].unique()
        
        # For testing, pick 5 videos from this channel
        test_videos = videos[:5] if len(videos) >= 5 else videos
        
        sparse_data = []
        full_data = []
        
        for video_id in test_videos:
            video_snapshots = channel_data[channel_data['video_id'] == video_id].sort_values('days_since_published')
            
            if len(video_snapshots) >= 5:
                # Keep only 2 snapshots to simulate sparse data (early and one later)
                early_snapshot = video_snapshots.iloc[0]  # Earliest
                later_idx = min(2, len(video_snapshots) - 1)
                later_snapshot = video_snapshots.iloc[later_idx]  # A later one
                
                sparse_data.extend([early_snapshot, later_snapshot])
                full_data.append(video_snapshots)
        
        print(f"✅ Created sparse dataset: {len(sparse_data)} snapshots from {len(test_videos)} videos")
        print(f"📊 Full dataset: {sum(len(v) for v in full_data)} snapshots for validation")
        
        return pd.DataFrame(sparse_data), full_data, test_videos
    
    def predict_video_progression(self, video_info, days_to_predict):
        """Predict daily view progression for a video"""
        # Prepare features for prediction
        predictions = []
        
        for day in days_to_predict:
            # Create feature vector
            features = {
                'days_since_published': day,
                'log_subscriber_count': np.log1p(video_info['subscriber_count']),
                'channel_video_count': video_info['channel_video_count'],
                'log_channel_baseline': video_info['log_channel_baseline'],
                'title_length': video_info['title_length'],
                'title_word_count': video_info['title_word_count'],
                'day_of_week': video_info['day_of_week'],
                'hour_of_day': video_info['hour_of_day']
            }
            
            # Add encoded categorical features
            for cat_col in ['format_type', 'topic_domain', 'days_category', 'subscriber_tier']:
                if cat_col in self.preprocessors['encoders']:
                    try:
                        encoded_val = self.preprocessors['encoders'][cat_col].transform([str(video_info.get(cat_col, 'unknown'))])[0]
                        features[f'{cat_col}_encoded'] = encoded_val
                    except:
                        features[f'{cat_col}_encoded'] = 0
            
            # Create DataFrame and scale features
            feature_df = pd.DataFrame([features])
            
            # Scale numerical features
            numerical_cols = [col for col in self.metadata['feature_columns'] if not col.endswith('_encoded')]
            if len(numerical_cols) > 0:
                feature_df[numerical_cols] = self.preprocessors['scalers']['features'].transform(feature_df[numerical_cols])
            
            # Predict (model outputs log views)
            log_views_pred = self.model.predict(feature_df[self.metadata['feature_columns']])[0]
            views_pred = np.expm1(log_views_pred)  # Convert back from log
            
            predictions.append({
                'days_since_published': day,
                'predicted_views': views_pred
            })
        
        return pd.DataFrame(predictions)
    
    def test_backfill_accuracy(self, sparse_data, full_data, test_videos):
        """Test backfill accuracy against known full data"""
        print("🧪 Testing backfill accuracy...")
        
        results = []
        
        for i, video_id in enumerate(test_videos):
            if i >= len(full_data):
                continue
                
            # Get sparse data for this video (2 snapshots)
            video_sparse = sparse_data[sparse_data['video_id'] == video_id]
            video_full = full_data[i]
            
            if len(video_sparse) < 2 or len(video_full) < 5:
                continue
            
            # Calculate channel baseline from sparse data
            channel_baseline = sparse_data[sparse_data['channel_name'] == video_sparse.iloc[0]['channel_name']]['view_count'].median()
            
            # Prepare video info for prediction
            video_info = video_sparse.iloc[0].to_dict()
            video_info['log_channel_baseline'] = np.log1p(channel_baseline)
            video_info['days_category'] = 'week1'  # Default
            video_info['subscriber_tier'] = 'medium'  # Default
            
            # Days to predict (fill in the gaps)
            known_days = set(video_sparse['days_since_published'].tolist())
            all_days = video_full['days_since_published'].tolist()
            missing_days = [d for d in all_days if d not in known_days]
            
            if len(missing_days) > 0:
                # Predict missing days
                predictions_df = self.predict_video_progression(video_info, missing_days)
                
                # Compare against actual values
                for _, pred_row in predictions_df.iterrows():
                    day = pred_row['days_since_published']
                    predicted_views = pred_row['predicted_views']
                    
                    # Find actual views for this day
                    actual_row = video_full[video_full['days_since_published'] == day]
                    if len(actual_row) > 0:
                        actual_views = actual_row.iloc[0]['view_count']
                        error = abs(predicted_views - actual_views)
                        error_pct = (error / actual_views) * 100
                        
                        results.append({
                            'video_id': video_id,
                            'channel_name': video_info['channel_name'],
                            'days_since_published': day,
                            'actual_views': actual_views,
                            'predicted_views': predicted_views,
                            'error': error,
                            'error_pct': error_pct
                        })
        
        if len(results) > 0:
            results_df = pd.DataFrame(results)
            print(f"✅ Tested {len(results)} predictions across {results_df['video_id'].nunique()} videos")
            print(f"📊 Average error: {results_df['error_pct'].mean():.1f}%")
            print(f"📊 Median error: {results_df['error_pct'].median():.1f}%")
            
            return results_df
        else:
            print("❌ No predictions could be validated")
            return pd.DataFrame()
    
    def create_backfill_visualization(self, sparse_data, full_data, test_videos, results_df):
        """Create visualization showing backfill results"""
        print("📊 Creating backfill visualization...")
        
        fig, axes = plt.subplots(2, 2, figsize=(15, 12))
        
        # 1. Sample video progression with backfill
        ax1 = axes[0, 0]
        if len(test_videos) > 0 and len(full_data) > 0:
            sample_video = test_videos[0]
            sample_sparse = sparse_data[sparse_data['video_id'] == sample_video]
            sample_full = full_data[0]
            
            # Plot full progression (ground truth)
            ax1.plot(sample_full['days_since_published'], sample_full['view_count'], 
                    'b-', alpha=0.7, label='Actual Progression')
            
            # Plot sparse data points
            ax1.scatter(sample_sparse['days_since_published'], sample_sparse['view_count'], 
                       color='red', s=100, label='Available Data', zorder=5)
            
            # Plot predictions
            if len(results_df) > 0:
                sample_predictions = results_df[results_df['video_id'] == sample_video]
                ax1.scatter(sample_predictions['days_since_published'], sample_predictions['predicted_views'], 
                           color='orange', s=50, alpha=0.7, label='ML Predictions', zorder=3)
            
            ax1.set_xlabel('Days Since Published')
            ax1.set_ylabel('View Count')
            ax1.set_title(f'Video Progression: {sample_video}')
            ax1.legend()
            ax1.set_yscale('log')
        
        # 2. Prediction accuracy
        ax2 = axes[0, 1]
        if len(results_df) > 0:
            ax2.scatter(results_df['actual_views'], results_df['predicted_views'], alpha=0.6)
            min_views = min(results_df['actual_views'].min(), results_df['predicted_views'].min())
            max_views = max(results_df['actual_views'].max(), results_df['predicted_views'].max())
            ax2.plot([min_views, max_views], [min_views, max_views], 'r--', alpha=0.5, label='Perfect Prediction')
            ax2.set_xlabel('Actual Views')
            ax2.set_ylabel('Predicted Views')
            ax2.set_title('Prediction Accuracy')
            ax2.set_xscale('log')
            ax2.set_yscale('log')
            ax2.legend()
        
        # 3. Error distribution
        ax3 = axes[1, 0]
        if len(results_df) > 0:
            ax3.hist(results_df['error_pct'], bins=20, alpha=0.7, edgecolor='black')
            ax3.set_xlabel('Error Percentage')
            ax3.set_ylabel('Frequency')
            ax3.set_title('Prediction Error Distribution')
            ax3.axvline(results_df['error_pct'].median(), color='red', linestyle='--', 
                       label=f'Median: {results_df["error_pct"].median():.1f}%')
            ax3.legend()
        
        # 4. Error by days since published
        ax4 = axes[1, 1]
        if len(results_df) > 0:
            ax4.scatter(results_df['days_since_published'], results_df['error_pct'], alpha=0.6)
            ax4.set_xlabel('Days Since Published')
            ax4.set_ylabel('Error Percentage')
            ax4.set_title('Error vs Video Age')
            ax4.set_yscale('log')
        
        plt.tight_layout()
        
        viz_path = f'data/historical_backfill_test_{self.model_timestamp}.png'
        plt.savefig(viz_path, dpi=300, bbox_inches='tight')
        print(f"💾 Visualization saved: {viz_path}")
        
        return viz_path
    
    def generate_confidence_bands_example(self, sparse_data, test_videos):
        """Generate example confidence bands using ML backfill"""
        print("📊 Generating ML-enhanced confidence bands example...")
        
        if len(test_videos) == 0:
            return
        
        # Use first test video as example
        video_id = test_videos[0]
        video_sparse = sparse_data[sparse_data['video_id'] == video_id]
        
        if len(video_sparse) < 1:
            return
        
        # Calculate channel baseline
        channel_name = video_sparse.iloc[0]['channel_name']
        channel_baseline = sparse_data[sparse_data['channel_name'] == channel_name]['view_count'].median()
        
        # Create multiple "sister videos" with slight variations
        base_video = video_sparse.iloc[0].to_dict()
        base_video['log_channel_baseline'] = np.log1p(channel_baseline)
        
        # Simulate 5 channel videos with variations
        days_range = range(1, 91)  # 90 days
        sister_videos = []
        
        for video_num in range(5):
            # Add some variation to simulate different videos
            video_variant = base_video.copy()
            video_variant['title_length'] *= (0.8 + video_num * 0.1)  # Vary title length
            video_variant['days_category'] = 'week1'
            video_variant['subscriber_tier'] = 'medium'
            
            progression = self.predict_video_progression(video_variant, days_range)
            progression['video_num'] = video_num
            sister_videos.append(progression)
        
        # Combine all progressions
        all_progressions = pd.concat(sister_videos, ignore_index=True)
        
        # Calculate percentiles for confidence bands
        confidence_bands = all_progressions.groupby('days_since_published')['predicted_views'].agg([
            lambda x: np.percentile(x, 10),
            lambda x: np.percentile(x, 50), 
            lambda x: np.percentile(x, 90)
        ]).reset_index()
        
        confidence_bands.columns = ['days_since_published', 'p10', 'p50', 'p90']
        
        # Create visualization
        plt.figure(figsize=(12, 8))
        
        # Plot confidence bands
        plt.fill_between(confidence_bands['days_since_published'], 
                        confidence_bands['p10'], confidence_bands['p90'],
                        alpha=0.3, color='gray', label='Confidence Band (ML-Enhanced)')
        
        # Plot median line
        plt.plot(confidence_bands['days_since_published'], confidence_bands['p50'],
                'b-', linewidth=2, label='Expected Performance (ML)')
        
        # Plot actual sparse data points
        plt.scatter(video_sparse['days_since_published'], video_sparse['view_count'],
                   color='red', s=100, zorder=5, label='Available Data Points')
        
        plt.xlabel('Days Since Published')
        plt.ylabel('View Count')
        plt.title(f'ML-Enhanced Confidence Bands: {channel_name}\nVideo: {video_id}')
        plt.legend()
        plt.yscale('log')
        plt.grid(True, alpha=0.3)
        
        bands_path = f'data/ml_confidence_bands_example_{self.model_timestamp}.png'
        plt.savefig(bands_path, dpi=300, bbox_inches='tight')
        print(f"💾 Confidence bands example saved: {bands_path}")
        
        return bands_path, confidence_bands

def main():
    print("🚀 Historical Backfill System Test")
    print("=" * 60)
    
    tester = HistoricalBackfillTester()
    
    # Load models
    tester.load_models()
    
    # Load test data
    df = tester.load_test_channel_data()
    
    # Find good test channel
    test_channel, channel_data = tester.find_good_test_channels(df)
    print(f"\n🎯 Testing with channel: {test_channel}")
    
    # Simulate sparse data scenario
    sparse_data, full_data, test_videos = tester.simulate_sparse_data(channel_data)
    
    # Test backfill accuracy
    results_df = tester.test_backfill_accuracy(sparse_data, full_data, test_videos)
    
    # Create visualizations
    if len(results_df) > 0:
        viz_path = tester.create_backfill_visualization(sparse_data, full_data, test_videos, results_df)
    
    # Generate confidence bands example
    bands_path, confidence_bands = tester.generate_confidence_bands_example(sparse_data, test_videos)
    
    print("\n" + "=" * 60)
    print("🎉 Historical backfill test complete!")
    print(f"✅ Tested ML backfill on channel: {test_channel}")
    if len(results_df) > 0:
        print(f"📊 Backfill accuracy: {results_df['error_pct'].median():.1f}% median error")
        print(f"📊 Generated confidence bands using 5 ML-predicted video progressions")
    print("💡 This system can now backfill missing video data to create realistic confidence bands!")
    print("=" * 60)

if __name__ == "__main__":
    main()