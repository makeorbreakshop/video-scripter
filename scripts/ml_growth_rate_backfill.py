#!/usr/bin/env python3

"""
ML Growth Rate Backfill System
Instead of predicting absolute views, predict daily growth rates for smooth curves
"""

import json
import pandas as pd
import numpy as np
import pickle
import matplotlib.pyplot as plt
from datetime import datetime
from sklearn.ensemble import RandomForestRegressor
from sklearn.preprocessing import StandardScaler, LabelEncoder
from sklearn.model_selection import train_test_split
from sklearn.metrics import r2_score, mean_absolute_error
import warnings
warnings.filterwarnings('ignore')

class GrowthRateMLBackfiller:
    def __init__(self):
        self.growth_model = None
        self.preprocessors = {}
        self.metadata = {}
        
    def load_training_data(self):
        """Load training data and calculate growth rates"""
        print("📊 Loading training data for growth rate modeling...")
        
        # Load all batches
        all_data = []
        for i in range(1, 15):
            try:
                with open(f'data/ml_training_batch_{i}.json', 'r') as f:
                    batch_data = json.load(f)
                    all_data.extend(batch_data)
            except FileNotFoundError:
                continue
        
        df = pd.DataFrame(all_data)
        
        # Convert types
        numeric_columns = ['subscriber_count', 'channel_video_count', 'view_count', 
                          'days_since_published', 'title_length', 'title_word_count']
        for col in numeric_columns:
            df[col] = pd.to_numeric(df[col], errors='coerce')
        
        # Remove invalid data
        df = df.dropna(subset=['view_count', 'days_since_published', 'video_id'])
        df = df[df['view_count'] > 0]
        
        print(f"✅ Loaded {len(df):,} snapshots from {df['channel_name'].nunique()} channels")
        
        return df
    
    def prepare_growth_rate_dataset(self, df):
        """Convert view snapshots to growth rate training data"""
        print("🔄 Preparing growth rate training dataset...")
        
        growth_data = []
        
        # Process each video
        for video_id in df['video_id'].unique():
            video_data = df[df['video_id'] == video_id].sort_values('days_since_published')
            
            if len(video_data) < 2:  # Need at least 2 points for growth rate
                continue
            
            # Get video metadata
            video_info = video_data.iloc[0].to_dict()
            
            # Calculate growth rates between consecutive snapshots
            for i in range(len(video_data) - 1):
                current_row = video_data.iloc[i]
                next_row = video_data.iloc[i + 1]
                
                current_day = current_row['days_since_published']
                next_day = next_row['days_since_published']
                current_views = current_row['view_count']
                next_views = next_row['view_count']
                
                # Skip if days are the same or views decreased (data errors)
                if next_day <= current_day or next_views <= current_views:
                    continue
                
                # Calculate daily growth rate
                days_diff = next_day - current_day
                growth_ratio = next_views / current_views
                daily_growth_rate = growth_ratio ** (1.0 / days_diff) - 1.0  # Daily percentage growth
                
                # Skip extreme outliers
                if daily_growth_rate < -0.5 or daily_growth_rate > 2.0:  # -50% to +200% daily growth
                    continue
                
                # Create training sample
                growth_sample = {
                    'video_id': video_id,
                    'channel_name': video_info['channel_name'],
                    'current_day': current_day,
                    'current_views': current_views,
                    'days_since_start': current_day,
                    'log_current_views': np.log1p(current_views),
                    'subscriber_count': video_info['subscriber_count'],
                    'channel_video_count': video_info.get('channel_video_count', 500),
                    'title_length': video_info['title_length'],
                    'title_word_count': video_info['title_word_count'],
                    'format_type': video_info.get('format_type', 'unknown'),
                    'topic_domain': video_info.get('topic_domain', 'unknown'),
                    'day_of_week': video_info['day_of_week'],
                    'hour_of_day': video_info['hour_of_day'],
                    'daily_growth_rate': daily_growth_rate
                }
                
                growth_data.append(growth_sample)
        
        growth_df = pd.DataFrame(growth_data)
        
        print(f"✅ Created {len(growth_df):,} growth rate samples from {growth_df['video_id'].nunique():,} videos")
        print(f"   Growth rate range: {growth_df['daily_growth_rate'].min():.1%} to {growth_df['daily_growth_rate'].max():.1%}")
        print(f"   Median daily growth: {growth_df['daily_growth_rate'].median():.2%}")
        
        return growth_df
    
    def train_growth_rate_model(self, growth_df):
        """Train ML model to predict daily growth rates"""
        print("🤖 Training growth rate prediction model...")
        
        # Prepare features
        feature_columns = [
            'current_day', 'log_current_views', 'subscriber_count', 'channel_video_count',
            'title_length', 'title_word_count', 'day_of_week', 'hour_of_day'
        ]
        
        # Handle categorical features
        categorical_features = ['format_type', 'topic_domain']
        encoders = {}
        
        for cat_col in categorical_features:
            if cat_col in growth_df.columns:
                encoder = LabelEncoder()
                growth_df[f'{cat_col}_encoded'] = encoder.fit_transform(growth_df[cat_col].astype(str).fillna('unknown'))
                encoders[cat_col] = encoder
                feature_columns.append(f'{cat_col}_encoded')
        
        # Create feature matrix
        X = growth_df[feature_columns].fillna(0)
        y = growth_df['daily_growth_rate']
        
        # Scale features
        scaler = StandardScaler()
        X_scaled = scaler.fit_transform(X)
        X_scaled_df = pd.DataFrame(X_scaled, columns=feature_columns)
        
        # Train/test split
        X_train, X_test, y_train, y_test = train_test_split(X_scaled_df, y, test_size=0.2, random_state=42)
        
        # Train model
        model = RandomForestRegressor(
            n_estimators=100,
            max_depth=12,
            min_samples_split=20,
            min_samples_leaf=10,
            random_state=42,
            n_jobs=-1
        )
        
        model.fit(X_train, y_train)
        
        # Evaluate
        y_pred = model.predict(X_test)
        r2 = r2_score(y_test, y_pred)
        mae = mean_absolute_error(y_test, y_pred)
        
        print(f"✅ Growth rate model trained:")
        print(f"   R² Score: {r2:.1%}")
        print(f"   Mean Absolute Error: {mae:.3%} daily growth rate")
        
        # Save model and preprocessors
        self.growth_model = model
        self.preprocessors = {
            'scaler': scaler,
            'encoders': encoders
        }
        self.metadata = {
            'feature_columns': feature_columns,
            'r2_score': r2,
            'mae': mae,
            'training_samples': len(growth_df)
        }
        
        return model
    
    def predict_growth_rate(self, current_day, current_views, video_info):
        """Predict daily growth rate for given conditions"""
        if not self.growth_model:
            return 0.01  # Default 1% daily growth
        
        try:
            # Create feature vector
            features = {
                'current_day': current_day,
                'log_current_views': np.log1p(current_views),
                'subscriber_count': video_info.get('subscriber_count', 1000000),
                'channel_video_count': video_info.get('channel_video_count', 500),
                'title_length': video_info.get('title_length', 50),
                'title_word_count': video_info.get('title_word_count', 8),
                'day_of_week': video_info.get('day_of_week', 4),
                'hour_of_day': video_info.get('hour_of_day', 15)
            }
            
            # Add encoded categorical features
            for cat_col, encoder in self.preprocessors['encoders'].items():
                try:
                    value = str(video_info.get(cat_col, 'unknown'))
                    encoded = encoder.transform([value])[0]
                    features[f'{cat_col}_encoded'] = encoded
                except:
                    features[f'{cat_col}_encoded'] = 0
            
            # Create and scale feature vector
            feature_df = pd.DataFrame([features])
            feature_scaled = self.preprocessors['scaler'].transform(feature_df)
            feature_scaled_df = pd.DataFrame(feature_scaled, columns=self.metadata['feature_columns'])
            
            # Predict growth rate
            growth_rate = self.growth_model.predict(feature_scaled_df)[0]
            
            # Clamp to reasonable range
            growth_rate = max(min(growth_rate, 0.5), -0.3)  # -30% to +50% daily growth
            
            return growth_rate
            
        except Exception as e:
            print(f"   ⚠️ Growth prediction failed: {e}")
            return 0.01  # Fallback to 1% growth
    
    def growth_rate_backfill_video(self, video_data, video_info):
        """Create smooth progression using growth rate predictions"""
        if len(video_data) < 2:
            return pd.DataFrame()
        
        # Sort actual data points
        actual_data = video_data.sort_values('days_since_published')
        actual_days = actual_data['days_since_published'].values
        actual_views = actual_data['view_count'].values
        
        print(f"   📈 Growth Rate Backfill: {video_info['title'][:40]}...")
        print(f"      Actual points: {list(zip(actual_days.astype(int), actual_views.astype(int)))}")
        
        # Create smooth progression
        progression = []
        
        for day in range(1, 91):
            if day in actual_days:
                # Use exact actual data
                idx = np.where(actual_days == day)[0][0]
                views = actual_views[idx]
                data_type = 'actual'
            else:
                # Use growth rate prediction
                views = self.growth_rate_estimate(day, actual_days, actual_views, video_info)
                data_type = 'predicted'
            
            progression.append({
                'video_id': video_info['video_id'],
                'title': video_info['title'],
                'days_since_published': day,
                'views': max(views, 100),  # Minimum 100 views
                'data_type': data_type
            })
        
        df_progression = pd.DataFrame(progression)
        
        # Ensure monotonic growth (no view decreases)
        views = df_progression['views'].values
        for i in range(1, len(views)):
            views[i] = max(views[i], views[i-1])
        df_progression['views'] = views
        
        # Show sample predictions
        sample_days = [7, 14, 30, 60]
        print(f"      Growth samples: ", end="")
        for day in sample_days:
            pred_views = df_progression[df_progression['days_since_published'] == day]['views'].iloc[0]
            print(f"Day{day}:{int(pred_views):,} ", end="")
        print()
        
        return df_progression
    
    def growth_rate_estimate(self, target_day, actual_days, actual_views, video_info):
        """Estimate views using ML-predicted growth rates"""
        
        # Find closest actual point before target day
        before_days = actual_days[actual_days < target_day]
        
        if len(before_days) == 0:
            # Extrapolate backwards from first point
            start_day = actual_days[0]
            start_views = actual_views[0]
            
            # Use ML to predict growth rate for early days
            growth_rate = self.predict_growth_rate(1, start_views, video_info)
            days_back = start_day - target_day
            
            return start_views / ((1 + growth_rate) ** days_back)
        
        # Start from closest actual point
        start_idx = np.where(actual_days == before_days[-1])[0][0]
        start_day = actual_days[start_idx]
        start_views = actual_views[start_idx]
        
        # Apply growth rates day by day
        current_views = start_views
        current_day = start_day
        
        while current_day < target_day:
            # Get ML-predicted growth rate
            growth_rate = self.predict_growth_rate(current_day, current_views, video_info)
            
            # Apply growth rate
            current_views *= (1 + growth_rate)
            current_day += 1
            
            # Check if we hit an actual point to reset
            if current_day in actual_days and current_day < target_day:
                actual_idx = np.where(actual_days == current_day)[0][0]
                current_views = actual_views[actual_idx]  # Reset to actual data
        
        return current_views
    
    def run_growth_rate_demo(self, channel_name="I Like To Make Stuff"):
        """Run complete growth rate ML demo"""
        print("🚀 GROWTH RATE ML BACKFILL SYSTEM")
        print("=" * 60)
        print("🎯 Predicting growth rates instead of absolute views")
        
        # Load and train
        df = self.load_training_data()
        growth_df = self.prepare_growth_rate_dataset(df)
        self.train_growth_rate_model(growth_df)
        
        # Test on channel
        print(f"\n📊 Testing on {channel_name} recent videos...")
        
        # Get recent videos
        channel_data = df[df['channel_name'] == channel_name]
        recent_videos = channel_data[channel_data['days_since_published'] <= 90]
        
        # Get videos with good data
        good_videos = []
        for video_id in recent_videos['video_id'].unique():
            video_data = recent_videos[recent_videos['video_id'] == video_id]
            if len(video_data) >= 3:
                good_videos.append({
                    'video_id': video_id,
                    'title': video_data['title'].iloc[0],
                    'data': video_data.sort_values('days_since_published'),
                    'max_views': video_data['view_count'].max(),
                    'info': video_data.iloc[0].to_dict()
                })
        
        good_videos.sort(key=lambda x: x['max_views'], reverse=True)
        videos_to_use = good_videos[:min(10, len(good_videos))]
        
        print(f"🎯 Using {len(videos_to_use)} recent videos for growth rate backfill:")
        for i, video in enumerate(videos_to_use):
            print(f"   {i+1}. {video['title'][:50]}... ({video['max_views']:,} max views)")
        
        # Create progressions using growth rates
        print(f"\n🔄 Creating growth rate progressions...")
        all_progressions = []
        
        for video in videos_to_use:
            progression = self.growth_rate_backfill_video(video['data'], video['info'])
            if len(progression) > 0:
                all_progressions.append(progression)
        
        print(f"✅ Created {len(all_progressions)} smooth growth rate progressions")
        
        # Create envelope
        envelope_data = []
        if all_progressions:
            all_data = pd.concat(all_progressions, ignore_index=True)
            
            for day in range(1, 91):
                day_views = all_data[all_data['days_since_published'] == day]['views']
                if len(day_views) >= 3:
                    envelope_data.append({
                        'day': day,
                        'p10': np.percentile(day_views, 10),
                        'p50': np.percentile(day_views, 50),
                        'p90': np.percentile(day_views, 90)
                    })
        
        envelope_df = pd.DataFrame(envelope_data)
        
        # Create visualization
        viz_path = self.create_growth_rate_visualization(videos_to_use, all_progressions, envelope_df)
        
        print(f"\n🎉 GROWTH RATE ML DEMO COMPLETE!")
        print(f"✅ Model R²: {self.metadata['r2_score']:.1%}")
        print(f"✅ Growth rate MAE: {self.metadata['mae']:.2%}")
        print(f"✅ Smooth, realistic curves from ML growth predictions")
        print(f"💾 Visualization: {viz_path}")
        
        return viz_path
    
    def create_growth_rate_visualization(self, videos, all_progressions, envelope_df):
        """Create growth rate visualization"""
        print("🎨 Creating growth rate ML visualization...")
        
        fig, axes = plt.subplots(2, 2, figsize=(16, 12))
        
        # Top left: Single video
        ax1 = axes[0, 0]
        if all_progressions:
            target_prog = all_progressions[0]
            actual = target_prog[target_prog['data_type'] == 'actual']
            
            ax1.plot(target_prog['days_since_published'], target_prog['views'], 
                    'b-', linewidth=2, label='Growth Rate ML Curve')
            ax1.scatter(actual['days_since_published'], actual['views'], 
                       color='red', s=100, zorder=5, label='Actual Data')
            
            ax1.set_title(f'Growth Rate ML Example\n{videos[0]["title"][:40]}...')
            ax1.set_xlabel('Days Since Published')
            ax1.set_ylabel('View Count')
            ax1.legend()
            ax1.grid(True, alpha=0.3)
            ax1.set_yscale('log')
        
        # Top right: All videos
        ax2 = axes[0, 1]
        if all_progressions:
            colors = plt.cm.tab10(np.linspace(0, 1, len(all_progressions)))
            
            for i, progression in enumerate(all_progressions):
                ax2.plot(progression['days_since_published'], progression['views'], 
                        color=colors[i], linewidth=2, alpha=0.8,
                        label=f'Video {i+1}' if i < 3 else "")
            
            ax2.set_title(f'All {len(all_progressions)} Videos: Growth Rate ML')
            ax2.set_xlabel('Days Since Published')
            ax2.set_ylabel('View Count')
            ax2.grid(True, alpha=0.3)
            ax2.set_yscale('log')
            if len(all_progressions) <= 3:
                ax2.legend()
        
        # Bottom left: Envelope
        ax3 = axes[1, 0]
        if len(envelope_df) > 0:
            ax3.fill_between(envelope_df['day'], envelope_df['p10'], envelope_df['p90'],
                            alpha=0.4, color='gray', label='Growth Rate ML Envelope')
            ax3.plot(envelope_df['day'], envelope_df['p50'], 'g-', linewidth=3,
                    label='Expected Performance')
            
            ax3.set_title('Channel Envelope from Growth Rate ML')
            ax3.set_xlabel('Days Since Published')
            ax3.set_ylabel('View Count')
            ax3.legend()
            ax3.grid(True, alpha=0.3)
            ax3.set_yscale('log')
        
        # Bottom right: Assessment
        ax4 = axes[1, 1]
        if len(envelope_df) > 0 and all_progressions:
            ax4.fill_between(envelope_df['day'], envelope_df['p10'], envelope_df['p90'],
                            alpha=0.4, color='gray', label='Channel Envelope')
            ax4.plot(envelope_df['day'], envelope_df['p50'], 'g-', linewidth=2,
                    alpha=0.8, label='Expected Performance')
            
            target_prog = all_progressions[0]
            actual = target_prog[target_prog['data_type'] == 'actual']
            
            ax4.plot(target_prog['days_since_published'], target_prog['views'], 
                    'b-', linewidth=2, alpha=0.8, label='Target Video')
            ax4.scatter(actual['days_since_published'], actual['views'], 
                       color='red', s=100, zorder=5, label='Actual Points')
            
            ax4.set_title('Growth Rate ML Assessment')
            ax4.set_xlabel('Days Since Published')
            ax4.set_ylabel('View Count')
            ax4.legend()
            ax4.grid(True, alpha=0.3)
            ax4.set_yscale('log')
        
        plt.suptitle(f'GROWTH RATE ML: Smooth Curves from ML Growth Predictions (R²: {self.metadata.get("r2_score", 0):.1%})', 
                    fontsize=14, fontweight='bold')
        plt.tight_layout()
        
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        viz_path = f'data/growth_rate_ml_{timestamp}.png'
        plt.savefig(viz_path, dpi=300, bbox_inches='tight')
        print(f"💾 Growth rate ML visualization: {viz_path}")
        
        return viz_path

def main():
    backfiller = GrowthRateMLBackfiller()
    backfiller.run_growth_rate_demo()

if __name__ == "__main__":
    main()