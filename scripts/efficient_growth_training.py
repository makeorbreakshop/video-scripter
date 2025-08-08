#!/usr/bin/env python3

"""
Efficient Growth Rate Training - Optimized for large dataset processing
"""

import json
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
from datetime import datetime
from sklearn.ensemble import RandomForestRegressor
from sklearn.preprocessing import StandardScaler
from sklearn.model_selection import train_test_split
from sklearn.metrics import r2_score
import joblib
import warnings
warnings.filterwarnings('ignore')

def efficient_growth_training():
    print("🚀 EFFICIENT GROWTH RATE ML TRAINING")
    print("=" * 50)
    
    # Load data efficiently - just key batches first
    print("📊 Loading strategic data subset...")
    target_batches = [1, 2, 3, 5, 6, 9, 10, 12, 13]  # Batches with good ILTMS data
    
    all_data = []
    for batch_num in target_batches:
        try:
            with open(f'data/ml_training_batch_{batch_num}.json', 'r') as f:
                batch_data = json.load(f)
                # Take a strategic sample from each batch for speed
                sample_size = min(15000, len(batch_data))
                batch_sample = np.random.choice(len(batch_data), sample_size, replace=False)
                sampled_data = [batch_data[i] for i in batch_sample]
                all_data.extend(sampled_data)
                print(f"   ✅ Batch {batch_num}: {len(sampled_data):,} records")
        except FileNotFoundError:
            continue
    
    df = pd.DataFrame(all_data)
    
    # Quick data processing
    numeric_cols = ['view_count', 'days_since_published', 'subscriber_count', 'title_length']
    for col in numeric_cols:
        df[col] = pd.to_numeric(df[col], errors='coerce')
    
    df = df.dropna(subset=['view_count', 'days_since_published', 'video_id'])
    df = df[df['view_count'] > 0]
    
    print(f"✅ Processing {len(df):,} records from {df['video_id'].nunique():,} videos")
    
    # Efficient growth rate creation
    print("🔄 Creating growth rate samples (efficient)...")
    growth_samples = []
    
    # Process videos in chunks
    video_ids = df['video_id'].unique()
    chunk_size = 5000
    
    for i in range(0, len(video_ids), chunk_size):
        chunk_ids = video_ids[i:i+chunk_size]
        chunk_data = df[df['video_id'].isin(chunk_ids)]
        
        # Process each video
        for video_id in chunk_ids:
            video_data = chunk_data[chunk_data['video_id'] == video_id].sort_values('days_since_published')
            
            if len(video_data) < 2:
                continue
            
            # Use just first and last points for efficiency
            first_row = video_data.iloc[0]
            last_row = video_data.iloc[-1]
            
            days_diff = last_row['days_since_published'] - first_row['days_since_published']
            if days_diff <= 0 or last_row['view_count'] <= first_row['view_count']:
                continue
            
            # Calculate growth rate
            growth_ratio = last_row['view_count'] / first_row['view_count']
            daily_growth_rate = growth_ratio ** (1.0 / days_diff) - 1.0
            
            # Filter extremes
            if daily_growth_rate < -0.2 or daily_growth_rate > 0.3:
                continue
            
            growth_samples.append({
                'day': first_row['days_since_published'],
                'log_views': np.log1p(first_row['view_count']),
                'log_subscribers': np.log1p(first_row['subscriber_count']),
                'title_length': first_row['title_length'],
                'channel_name': first_row['channel_name'],
                'growth_rate': daily_growth_rate
            })
        
        if i % (chunk_size * 4) == 0:
            progress = min(100, (i / len(video_ids)) * 100)
            print(f"   Progress: {progress:.1f}% ({len(growth_samples):,} samples)")
    
    growth_df = pd.DataFrame(growth_samples)
    print(f"✅ Created {len(growth_df):,} growth samples")
    print(f"   Growth range: {growth_df['growth_rate'].min():.1%} to {growth_df['growth_rate'].max():.1%}")
    
    if len(growth_df) < 1000:
        print("❌ Insufficient training data")
        return
    
    # Train efficient model
    print("🤖 Training efficient growth model...")
    
    # Simple features for efficiency
    feature_cols = ['day', 'log_views', 'log_subscribers', 'title_length']
    X = growth_df[feature_cols].fillna(0)
    y = growth_df['growth_rate']
    
    # Scale and train
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)
    
    X_train, X_test, y_train, y_test = train_test_split(X_scaled, y, test_size=0.2, random_state=42)
    
    # Efficient model
    model = RandomForestRegressor(
        n_estimators=100,  # Balanced for speed vs accuracy
        max_depth=12,
        min_samples_split=20,
        random_state=42,
        n_jobs=-1
    )
    
    model.fit(X_train, y_train)
    
    # Evaluate
    test_pred = model.predict(X_test)
    r2 = r2_score(y_test, test_pred)
    
    print(f"✅ Model trained: R² = {r2:.1%}")
    
    # Test on ILTMS
    print("\n🎬 Testing on I Like To Make Stuff...")
    
    iltms_data = df[df['channel_name'] == 'I Like To Make Stuff']
    recent_iltms = iltms_data[iltms_data['days_since_published'] <= 90]
    
    if len(recent_iltms) == 0:
        print("❌ No recent ILTMS data")
        return
    
    # Get best video
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
        print("❌ No suitable ILTMS videos")
        return
    
    test_video = max(video_groups, key=lambda x: x['max_views'])
    video_data = test_video['data']
    
    print(f"Testing: {test_video['title']}")
    
    # Create progression
    actual_days = video_data['days_since_published'].values
    actual_views = video_data['view_count'].values
    
    progression_days = []
    progression_views = []
    progression_types = []
    
    current_views = actual_views[0]
    video_info = video_data.iloc[0]
    
    for day in range(1, 91):
        if day in actual_days:
            idx = np.where(actual_days == day)[0][0]
            current_views = actual_views[idx]
            data_type = 'actual'
        else:
            # Predict growth rate
            try:
                features = [
                    day,
                    np.log1p(current_views),
                    np.log1p(video_info['subscriber_count']),
                    video_info['title_length']
                ]
                
                features_scaled = scaler.transform([features])
                growth_rate = model.predict(features_scaled)[0]
                growth_rate = max(min(growth_rate, 0.1), -0.05)  # Clamp
                
                current_views *= (1 + growth_rate)
                data_type = 'predicted'
                
            except:
                current_views *= 1.01
                data_type = 'predicted'
        
        progression_days.append(day)
        progression_views.append(current_views)
        progression_types.append(data_type)
    
    # Visualize
    plt.figure(figsize=(12, 6))
    
    plt.plot(progression_days, progression_views, 'b-', linewidth=2, label='Efficient Growth Rate ML')
    
    actual_mask = [t == 'actual' for t in progression_types]
    actual_prog_days = [progression_days[i] for i in range(len(actual_mask)) if actual_mask[i]]
    actual_prog_views = [progression_views[i] for i in range(len(actual_mask)) if actual_mask[i]]
    
    plt.scatter(actual_prog_days, actual_prog_views, color='red', s=100, zorder=5, label='Actual Data')
    
    plt.title(f'Efficient Growth Rate ML: {test_video["title"][:40]}...')
    plt.xlabel('Days Since Published')
    plt.ylabel('View Count')
    plt.yscale('log')
    plt.legend()
    plt.grid(True, alpha=0.3)
    
    # Save
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    viz_path = f'data/efficient_growth_training_{timestamp}.png'
    plt.savefig(viz_path, dpi=300, bbox_inches='tight')
    plt.close()
    
    # Save model
    model_path = f'models/efficient_growth_model_{timestamp}.joblib'
    scaler_path = f'models/efficient_growth_scaler_{timestamp}.joblib'
    
    joblib.dump(model, model_path)
    joblib.dump(scaler, scaler_path)
    
    print(f"\n✅ EFFICIENT TRAINING COMPLETE!")
    print(f"📊 Growth samples: {len(growth_df):,}")
    print(f"🎯 Model accuracy: R² = {r2:.1%}")
    print(f"💾 Model: {model_path}")
    print(f"🎨 Visualization: {viz_path}")
    
    return {
        'r2': r2,
        'growth_samples': len(growth_df),
        'model_path': model_path,
        'viz_path': viz_path
    }

if __name__ == "__main__":
    efficient_growth_training()