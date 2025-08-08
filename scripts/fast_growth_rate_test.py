#!/usr/bin/env python3

"""
Fast Growth Rate ML Test
Quick version to test the growth rate approach on a smaller dataset
"""

import json
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
from datetime import datetime
from sklearn.ensemble import RandomForestRegressor
from sklearn.preprocessing import StandardScaler, LabelEncoder
from sklearn.model_selection import train_test_split
from sklearn.metrics import r2_score
import warnings
warnings.filterwarnings('ignore')

class FastGrowthRateTest:
    def __init__(self):
        self.growth_model = None
        self.scaler = None
        
    def quick_growth_rate_demo(self):
        """Quick demo using limited data"""
        print("🚀 FAST GROWTH RATE ML TEST")
        print("=" * 50)
        
        # Load limited data for speed
        print("📊 Loading sample data...")
        all_data = []
        for i in [1, 2]:  # Just first 2 batches for speed
            try:
                with open(f'data/ml_training_batch_{i}.json', 'r') as f:
                    batch_data = json.load(f)
                    all_data.extend(batch_data[:10000])  # Limit to 10K records per batch
            except FileNotFoundError:
                continue
        
        df = pd.DataFrame(all_data)
        
        # Convert types
        numeric_cols = ['view_count', 'days_since_published', 'subscriber_count']
        for col in numeric_cols:
            df[col] = pd.to_numeric(df[col], errors='coerce')
        
        df = df.dropna(subset=['view_count', 'days_since_published', 'video_id'])
        df = df[df['view_count'] > 0]
        
        print(f"✅ Using {len(df):,} snapshots for quick test")
        
        # Create growth rate dataset quickly
        print("🔄 Creating growth rate samples...")
        growth_samples = []
        
        # Sample just 5000 videos for speed
        video_sample = df['video_id'].unique()[:5000]
        
        for video_id in video_sample:
            video_data = df[df['video_id'] == video_id].sort_values('days_since_published')
            
            if len(video_data) < 2:
                continue
            
            # Take first and last points for growth rate
            first_row = video_data.iloc[0]
            last_row = video_data.iloc[-1]
            
            if last_row['days_since_published'] <= first_row['days_since_published']:
                continue
            
            # Calculate overall growth rate
            days_diff = last_row['days_since_published'] - first_row['days_since_published']
            if days_diff <= 0 or last_row['view_count'] <= first_row['view_count']:
                continue
            
            growth_ratio = last_row['view_count'] / first_row['view_count']
            daily_growth_rate = growth_ratio ** (1.0 / days_diff) - 1.0
            
            # Skip extreme outliers
            if daily_growth_rate < -0.1 or daily_growth_rate > 0.2:
                continue
            
            growth_samples.append({
                'current_day': first_row['days_since_published'],
                'log_views': np.log1p(first_row['view_count']),
                'subscriber_count': first_row['subscriber_count'],
                'days_to_next': days_diff,
                'daily_growth_rate': daily_growth_rate
            })
        
        growth_df = pd.DataFrame(growth_samples)
        print(f"✅ Created {len(growth_df):,} growth rate samples")
        print(f"   Growth range: {growth_df['daily_growth_rate'].min():.1%} to {growth_df['daily_growth_rate'].max():.1%}")
        
        if len(growth_df) < 100:
            print("❌ Not enough growth samples for training")
            return
        
        # Train simple model
        print("🤖 Training growth rate model...")
        feature_cols = ['current_day', 'log_views', 'subscriber_count', 'days_to_next']
        
        X = growth_df[feature_cols].fillna(0)
        y = growth_df['daily_growth_rate']
        
        # Simple scaling and training
        self.scaler = StandardScaler()
        X_scaled = self.scaler.fit_transform(X)
        
        X_train, X_test, y_train, y_test = train_test_split(X_scaled, y, test_size=0.2, random_state=42)
        
        self.growth_model = RandomForestRegressor(n_estimators=50, max_depth=8, random_state=42, n_jobs=-1)
        self.growth_model.fit(X_train, y_train)
        
        y_pred = self.growth_model.predict(X_test)
        r2 = r2_score(y_test, y_pred)
        
        print(f"✅ Model trained: R² = {r2:.1%}")
        
        # Test on ILTMS
        print(f"\n📊 Testing on I Like To Make Stuff...")
        iltms_data = df[df['channel_name'] == 'I Like To Make Stuff']
        recent_iltms = iltms_data[iltms_data['days_since_published'] <= 90]
        
        if len(recent_iltms) == 0:
            print("❌ No recent ILTMS videos found")
            return
        
        # Get one video for demo
        video_ids = recent_iltms['video_id'].unique()
        if len(video_ids) == 0:
            print("❌ No ILTMS videos found")
            return
        
        test_video_id = video_ids[0]
        test_video_data = recent_iltms[recent_iltms['video_id'] == test_video_id].sort_values('days_since_published')
        
        print(f"🎬 Testing video: {test_video_data['title'].iloc[0][:50]}...")
        print(f"   Actual points: {len(test_video_data)}")
        
        # Create progression using growth rates
        actual_days = test_video_data['days_since_published'].values
        actual_views = test_video_data['view_count'].values
        
        progression_days = []
        progression_views = []
        progression_types = []
        
        # Start from first actual point
        start_day = int(actual_days[0])
        start_views = actual_views[0]
        
        current_views = start_views
        
        for day in range(1, 91):
            if day in actual_days:
                # Use actual data
                idx = np.where(actual_days == day)[0][0]
                current_views = actual_views[idx]
                data_type = 'actual'
            else:
                # Predict growth rate and apply
                growth_rate = self.predict_growth_rate(day, current_views, test_video_data.iloc[0])
                current_views = current_views * (1 + growth_rate)
                data_type = 'predicted'
            
            progression_days.append(day)
            progression_views.append(current_views)
            progression_types.append(data_type)
        
        # Create visualization
        plt.figure(figsize=(12, 8))
        
        # Plot progression
        plt.plot(progression_days, progression_views, 'b-', linewidth=2, label='Growth Rate ML Progression')
        
        # Mark actual points
        actual_mask = [t == 'actual' for t in progression_types]
        actual_prog_days = [progression_days[i] for i in range(len(actual_mask)) if actual_mask[i]]
        actual_prog_views = [progression_views[i] for i in range(len(actual_mask)) if actual_mask[i]]
        
        plt.scatter(actual_prog_days, actual_prog_views, color='red', s=100, zorder=5, label='Actual Data Points')
        
        plt.title(f'Growth Rate ML Test: {test_video_data["title"].iloc[0][:40]}...')
        plt.xlabel('Days Since Published')
        plt.ylabel('View Count')
        plt.yscale('log')
        plt.legend()
        plt.grid(True, alpha=0.3)
        
        # Save
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        viz_path = f'data/fast_growth_rate_test_{timestamp}.png'
        plt.savefig(viz_path, dpi=300, bbox_inches='tight')
        plt.close()
        
        print(f"✅ Test complete! Growth rate ML creates smooth progression")
        print(f"💾 Visualization: {viz_path}")
        
        return viz_path
    
    def predict_growth_rate(self, day, current_views, video_info):
        """Predict growth rate using trained model"""
        if not self.growth_model:
            return 0.01
        
        try:
            features = [
                day,
                np.log1p(current_views),
                video_info['subscriber_count'],
                1  # days_to_next = 1 for daily prediction
            ]
            
            features_scaled = self.scaler.transform([features])
            growth_rate = self.growth_model.predict(features_scaled)[0]
            
            # Clamp to reasonable range
            return max(min(growth_rate, 0.1), -0.05)  # -5% to +10% daily
            
        except Exception as e:
            return 0.01

def main():
    tester = FastGrowthRateTest()
    tester.quick_growth_rate_demo()

if __name__ == "__main__":
    main()