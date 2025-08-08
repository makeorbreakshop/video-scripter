#!/usr/bin/env python3

"""
Backfill Specific ILTMS Videos
Shows actual video data points + ML backfill for "When You're Stuck... Try THIS" 
and last 10 ILTMS videos to demonstrate gray envelope creation process
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

class ILTMSVideoBackfiller:
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
        
    def find_iltms_videos(self):
        """Find I Like To Make Stuff videos including the target video"""
        print("🔍 Finding I Like To Make Stuff videos...")
        
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
        
        # Filter to I Like To Make Stuff
        iltms_data = df[df['channel_name'] == 'I Like To Make Stuff'].copy()
        
        print(f"📊 Found {len(iltms_data)} snapshots from {iltms_data['video_id'].nunique()} ILTMS videos")
        
        # Look for the specific video "When You're Stuck... Try THIS"
        target_video = None
        target_video_data = None
        
        # Search for similar titles
        stuck_videos = iltms_data[iltms_data['title'].str.contains('Stuck', case=False, na=False)]
        if len(stuck_videos) > 0:
            target_video = stuck_videos['video_id'].iloc[0]
            target_video_data = stuck_videos[stuck_videos['video_id'] == target_video]
            print(f"🎯 Found target video: '{stuck_videos['title'].iloc[0]}'")
        else:
            # Fallback to most recent video with good data
            video_counts = iltms_data['video_id'].value_counts()
            recent_videos = video_counts[video_counts >= 2].index[:5]  # Videos with at least 2 snapshots
            target_video = recent_videos[0]
            target_video_data = iltms_data[iltms_data['video_id'] == target_video]
            print(f"🎯 Using recent video as target: '{target_video_data['title'].iloc[0]}'")
        
        # Get last 10 videos (by unique video_id)
        unique_videos = iltms_data['video_id'].unique()
        last_10_videos = unique_videos[-11:]  # Get 11 to ensure we have 10 + target
        
        # Remove target video from last 10 if present
        last_10_videos = [v for v in last_10_videos if v != target_video][:10]
        
        last_10_data = iltms_data[iltms_data['video_id'].isin(last_10_videos)]
        
        print(f"📊 Target video has {len(target_video_data)} data points")
        print(f"📊 Last 10 videos: {len(last_10_data)} total data points")
        
        return target_video_data, last_10_data, iltms_data
    
    def predict_video_progression(self, video_info, days_to_predict):
        """Predict daily view progression for a video"""
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
                'predicted_views': max(views_pred, 100)  # Ensure minimum reasonable views
            })
        
        return pd.DataFrame(predictions)
    
    def backfill_video_data(self, video_data, iltms_baseline):
        """Backfill missing data points for a specific video"""
        video_info = video_data.iloc[0].to_dict()
        video_info['log_channel_baseline'] = np.log1p(iltms_baseline)
        video_info['days_category'] = 'month1'
        
        # Determine subscriber tier
        subs = video_info['subscriber_count']
        if subs < 10000:
            video_info['subscriber_tier'] = 'small'
        elif subs < 100000:
            video_info['subscriber_tier'] = 'small'
        elif subs < 1000000:
            video_info['subscriber_tier'] = 'medium'
        elif subs < 10000000:
            video_info['subscriber_tier'] = 'large'
        else:
            video_info['subscriber_tier'] = 'mega'
        
        # Get existing data points
        existing_days = set(video_data['days_since_published'].tolist())
        max_day = max(existing_days)
        
        # Create full range of days to fill
        all_days = list(range(1, max(91, max_day + 30)))  # At least 90 days or 30 days past max
        missing_days = [d for d in all_days if d not in existing_days]
        
        # Predict missing days
        if len(missing_days) > 0:
            predictions = self.predict_video_progression(video_info, missing_days)
            
            # Combine actual and predicted data
            actual_data = video_data[['days_since_published', 'view_count']].copy()
            actual_data['data_type'] = 'actual'
            actual_data = actual_data.rename(columns={'view_count': 'views'})
            
            predicted_data = predictions[['days_since_published', 'predicted_views']].copy()
            predicted_data['data_type'] = 'predicted'
            predicted_data = predicted_data.rename(columns={'predicted_views': 'views'})
            
            combined_data = pd.concat([actual_data, predicted_data]).sort_values('days_since_published')
            combined_data['video_id'] = video_info['video_id']
            combined_data['title'] = video_info['title']
            
            return combined_data
        else:
            # If no missing days, return actual data only
            actual_data = video_data[['days_since_published', 'view_count']].copy()
            actual_data['data_type'] = 'actual'
            actual_data = actual_data.rename(columns={'view_count': 'views'})
            actual_data['video_id'] = video_info['video_id']
            actual_data['title'] = video_info['title']
            return actual_data
    
    def create_backfill_visualization(self, target_video_data, last_10_data, iltms_data):
        """Create visualization showing actual + backfilled data for target video and last 10 videos"""
        print("📊 Creating backfill visualization...")
        
        # Calculate ILTMS baseline
        iltms_baseline = iltms_data['view_count'].median()
        
        # Backfill target video
        target_backfilled = self.backfill_video_data(target_video_data, iltms_baseline)
        target_title = target_backfilled['title'].iloc[0]
        
        print(f"🎯 Target video: '{target_title}' - {len(target_video_data)} actual points")
        
        # Backfill last 10 videos
        backfilled_videos = []
        for video_id in last_10_data['video_id'].unique():
            video_data = last_10_data[last_10_data['video_id'] == video_id]
            backfilled = self.backfill_video_data(video_data, iltms_baseline)
            backfilled_videos.append(backfilled)
            print(f"📊 Video '{video_data['title'].iloc[0][:50]}...': {len(video_data)} actual points")
        
        # Create visualization
        fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(16, 12))
        
        # Top plot: Target video with actual + backfilled data
        target_actual = target_backfilled[target_backfilled['data_type'] == 'actual']
        target_predicted = target_backfilled[target_backfilled['data_type'] == 'predicted']
        
        if len(target_predicted) > 0:
            ax1.plot(target_predicted['days_since_published'], target_predicted['views'], 
                    'b--', alpha=0.7, linewidth=2, label='ML Backfilled Points')
        
        ax1.scatter(target_actual['days_since_published'], target_actual['views'], 
                   color='red', s=100, zorder=5, label='Actual Data Points')
        
        ax1.set_xlabel('Days Since Published')
        ax1.set_ylabel('View Count')
        ax1.set_title(f'Target Video: {target_title}\nActual Data Points + ML Backfill')
        ax1.legend()
        ax1.grid(True, alpha=0.3)
        ax1.set_yscale('log')
        
        # Bottom plot: All 10 videos with backfilled data
        colors = plt.cm.tab10(np.linspace(0, 1, len(backfilled_videos)))
        
        for i, backfilled in enumerate(backfilled_videos):
            actual = backfilled[backfilled['data_type'] == 'actual']
            predicted = backfilled[backfilled['data_type'] == 'predicted']
            
            # Plot backfilled curve
            if len(predicted) > 0:
                ax2.plot(predicted['days_since_published'], predicted['views'], 
                        '--', color=colors[i], alpha=0.6, linewidth=1)
            
            # Plot actual points
            ax2.scatter(actual['days_since_published'], actual['views'], 
                       color=colors[i], alpha=0.8, s=30, zorder=5)
        
        ax2.set_xlabel('Days Since Published')
        ax2.set_ylabel('View Count')
        ax2.set_title('Last 10 ILTMS Videos: Actual Points + ML Backfill\n(These curves will be used to create the gray confidence envelope)')
        ax2.grid(True, alpha=0.3)
        ax2.set_yscale('log')
        
        plt.tight_layout()
        
        viz_path = f'data/iltms_specific_backfill_{self.model_timestamp}.png'
        plt.savefig(viz_path, dpi=300, bbox_inches='tight')
        print(f"💾 Visualization saved: {viz_path}")
        
        return viz_path, target_backfilled, backfilled_videos
    
    def calculate_envelope_from_backfilled_videos(self, backfilled_videos):
        """Calculate p10/p50/p90 envelope from the backfilled video data"""
        print("📊 Calculating confidence envelope from backfilled videos...")
        
        # Combine all backfilled video data
        all_data = []
        for backfilled in backfilled_videos:
            all_data.append(backfilled[['days_since_published', 'views']])
        
        combined = pd.concat(all_data, ignore_index=True)
        
        # Calculate percentiles for each day
        envelope_data = combined.groupby('days_since_published')['views'].agg([
            lambda x: np.percentile(x, 10),
            lambda x: np.percentile(x, 50), 
            lambda x: np.percentile(x, 90),
            'count'
        ]).reset_index()
        
        envelope_data.columns = ['days_since_published', 'p10', 'p50', 'p90', 'video_count']
        
        # Only include days where we have data from multiple videos
        envelope_data = envelope_data[envelope_data['video_count'] >= 3]
        
        print(f"✅ Calculated envelope for {len(envelope_data)} days using {len(backfilled_videos)} videos")
        
        return envelope_data
    
    def create_final_envelope_visualization(self, target_backfilled, envelope_data):
        """Create final visualization showing target video with ML-generated confidence envelope"""
        print("🎨 Creating final envelope visualization...")
        
        fig, ax = plt.subplots(1, 1, figsize=(14, 8))
        
        # Plot confidence envelope
        ax.fill_between(envelope_data['days_since_published'], 
                       envelope_data['p10'], envelope_data['p90'],
                       alpha=0.3, color='gray', label='ML-Enhanced Confidence Band')
        
        # Plot median performance line
        ax.plot(envelope_data['days_since_published'], envelope_data['p50'],
               'g-', linewidth=2, alpha=0.8, label='Expected Performance (ML)')
        
        # Plot target video data
        target_actual = target_backfilled[target_backfilled['data_type'] == 'actual']
        target_predicted = target_backfilled[target_backfilled['data_type'] == 'predicted']
        
        if len(target_predicted) > 0:
            ax.plot(target_predicted['days_since_published'], target_predicted['views'], 
                   'b--', alpha=0.7, linewidth=2, label='Target Video (ML Backfilled)')
        
        ax.scatter(target_actual['days_since_published'], target_actual['views'], 
                  color='red', s=100, zorder=5, label='Target Video (Actual Data)')
        
        # Calculate performance assessment
        target_title = target_backfilled['title'].iloc[0]
        actual_views = target_actual['views'].iloc[-1] if len(target_actual) > 0 else 0
        
        # Find corresponding envelope values
        latest_day = target_actual['days_since_published'].max()
        envelope_at_day = envelope_data[envelope_data['days_since_published'] <= latest_day]
        
        performance_status = "Unknown"
        if len(envelope_at_day) > 0:
            latest_envelope = envelope_at_day.iloc[-1]
            if actual_views > latest_envelope['p90']:
                performance_status = "Overperforming (Above 90th percentile)"
            elif actual_views < latest_envelope['p10']:
                performance_status = "Underperforming (Below 10th percentile)"
            else:
                performance_status = "Meeting Expectations"
        
        ax.set_xlabel('Days Since Published')
        ax.set_ylabel('View Count')
        ax.set_title(f'ML-Enhanced Performance Analysis: {target_title}\n'
                    f'Status: {performance_status}')
        ax.legend()
        ax.grid(True, alpha=0.3)
        ax.set_yscale('log')
        
        plt.tight_layout()
        
        final_path = f'data/iltms_final_ml_envelope_{self.model_timestamp}.png'
        plt.savefig(final_path, dpi=300, bbox_inches='tight')
        print(f"💾 Final envelope visualization saved: {final_path}")
        
        return final_path

def main():
    print("🚀 ILTMS Specific Video Backfill Analysis")
    print("=" * 60)
    
    backfiller = ILTMSVideoBackfiller()
    
    # Load models
    backfiller.load_models()
    
    # Find ILTMS videos
    target_video_data, last_10_data, iltms_data = backfiller.find_iltms_videos()
    
    # Create backfill visualization
    viz_path, target_backfilled, backfilled_videos = backfiller.create_backfill_visualization(
        target_video_data, last_10_data, iltms_data)
    
    # Calculate envelope from backfilled videos
    envelope_data = backfiller.calculate_envelope_from_backfilled_videos(backfilled_videos)
    
    # Create final envelope visualization
    final_path = backfiller.create_final_envelope_visualization(target_backfilled, envelope_data)
    
    print("\n" + "=" * 60)
    print("🎉 ILTMS Video Backfill Analysis Complete!")
    print(f"✅ Backfilled missing data points for target video + 10 recent videos")
    print(f"✅ Generated ML-enhanced confidence envelope from backfilled video curves")
    print(f"📊 Visualization: {viz_path}")
    print(f"📊 Final envelope: {final_path}")
    print("\n🎯 This demonstrates exactly how ML backfill creates the gray confidence area!")
    print("=" * 60)

if __name__ == "__main__":
    main()