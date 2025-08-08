#!/usr/bin/env python3

"""
Focused Growth Rate Test - Target ILTMS data specifically
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
import warnings
warnings.filterwarnings('ignore')

def focused_growth_rate_test():
    print("🚀 FOCUSED GROWTH RATE ML TEST")
    print("🎯 Targeting ILTMS data specifically")
    print("=" * 50)
    
    # Load batches with ILTMS data
    iltms_batches = [1, 2, 3, 5, 6, 9, 10, 12, 13]  # Batches with recent ILTMS
    
    print(f"📊 Loading ILTMS-focused batches: {iltms_batches}")
    all_data = []
    
    for batch_num in iltms_batches:
        try:
            with open(f'data/ml_training_batch_{batch_num}.json', 'r') as f:
                batch_data = json.load(f)
                all_data.extend(batch_data)
        except FileNotFoundError:
            continue
    
    df = pd.DataFrame(all_data)
    
    # Convert types
    numeric_cols = ['view_count', 'days_since_published', 'subscriber_count', 'title_length']
    for col in numeric_cols:
        df[col] = pd.to_numeric(df[col], errors='coerce')
    
    df = df.dropna(subset=['view_count', 'days_since_published', 'video_id'])
    df = df[df['view_count'] > 0]
    
    print(f"✅ Loaded {len(df):,} snapshots from targeted batches")
    
    # Quick growth rate training on subset
    print("🔄 Creating growth rate training data...")
    
    growth_samples = []
    video_ids = df['video_id'].unique()
    
    # Sample 10K videos for speed
    sample_videos = np.random.choice(video_ids, min(10000, len(video_ids)), replace=False)
    
    for video_id in sample_videos:
        video_data = df[df['video_id'] == video_id].sort_values('days_since_published')
        
        if len(video_data) < 2:
            continue
        
        # Calculate growth rates between consecutive points
        for i in range(len(video_data) - 1):
            current = video_data.iloc[i]
            next_point = video_data.iloc[i + 1]
            
            day_diff = next_point['days_since_published'] - current['days_since_published']
            if day_diff <= 0:
                continue
            
            view_ratio = next_point['view_count'] / current['view_count']
            if view_ratio <= 1:  # No growth or negative
                daily_growth = 0.001  # Minimal growth
            else:
                daily_growth = view_ratio ** (1.0 / day_diff) - 1.0
            
            # Filter extremes
            if daily_growth < 0 or daily_growth > 0.5:
                continue
            
            growth_samples.append({
                'day': current['days_since_published'],
                'log_views': np.log1p(current['view_count']),
                'log_subscribers': np.log1p(current['subscriber_count']),
                'title_length': current['title_length'],
                'growth_rate': daily_growth
            })
    
    growth_df = pd.DataFrame(growth_samples)
    print(f"✅ Created {len(growth_df):,} growth samples")
    print(f"   Growth range: {growth_df['growth_rate'].min():.1%} to {growth_df['growth_rate'].max():.1%}")
    
    if len(growth_df) < 500:
        print("❌ Insufficient training data")
        return
    
    # Train growth model
    print("🤖 Training growth rate model...")
    
    feature_cols = ['day', 'log_views', 'log_subscribers', 'title_length']
    X = growth_df[feature_cols].fillna(0)
    y = growth_df['growth_rate']
    
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)
    
    X_train, X_test, y_train, y_test = train_test_split(X_scaled, y, test_size=0.2, random_state=42)
    
    model = RandomForestRegressor(n_estimators=100, max_depth=10, random_state=42, n_jobs=-1)
    model.fit(X_train, y_train)
    
    y_pred = model.predict(X_test)
    r2 = r2_score(y_test, y_pred)
    
    print(f"✅ Growth rate model: R² = {r2:.1%}")
    
    # Test on ILTMS recent videos
    print(f"\n📊 Testing on I Like To Make Stuff recent videos...")
    
    iltms_data = df[df['channel_name'] == 'I Like To Make Stuff']
    recent_iltms = iltms_data[iltms_data['days_since_published'] <= 90]
    
    print(f"✅ Found {len(recent_iltms)} recent ILTMS snapshots")
    
    # Get videos with multiple points
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
    
    video_groups.sort(key=lambda x: x['max_views'], reverse=True)
    print(f"🎯 Found {len(video_groups)} recent ILTMS videos with good data:")
    
    for i, video in enumerate(video_groups[:5]):
        print(f"   {i+1}. {video['title'][:50]}... ({video['max_views']:,} max)")
    
    if len(video_groups) == 0:
        print("❌ No suitable ILTMS videos found")
        return
    
    # Test growth rate backfill on best video
    test_video = video_groups[0]
    video_data = test_video['data']
    
    print(f"\n🎬 Testing: {test_video['title']}")
    print(f"   Actual data points: {len(video_data)}")
    
    actual_days = video_data['days_since_published'].values
    actual_views = video_data['view_count'].values
    
    print(f"   Points: {list(zip(actual_days.astype(int), actual_views.astype(int)))}")
    
    # Create growth rate progression
    progression_days = []
    progression_views = []
    progression_types = []
    
    # Start from first actual point
    current_views = actual_views[0]
    video_info = video_data.iloc[0]
    
    for day in range(1, 91):
        if day in actual_days:
            # Use actual data point
            idx = np.where(actual_days == day)[0][0]
            current_views = actual_views[idx]
            data_type = 'actual'
        else:
            # Predict growth rate and apply
            try:
                features = [
                    day,
                    np.log1p(current_views),
                    np.log1p(video_info['subscriber_count']),
                    video_info['title_length']
                ]
                
                features_scaled = scaler.transform([features])
                growth_rate = model.predict(features_scaled)[0]
                
                # Clamp growth rate
                growth_rate = max(min(growth_rate, 0.1), 0.001)  # 0.1% to 10% daily
                
                # Apply growth
                current_views = current_views * (1 + growth_rate)
                data_type = 'predicted'
                
            except Exception as e:
                # Fallback minimal growth
                current_views = current_views * 1.002  # 0.2% daily
                data_type = 'predicted'
        
        progression_days.append(day)
        progression_views.append(current_views)
        progression_types.append(data_type)
    
    # Create visualization
    print("🎨 Creating growth rate visualization...")
    
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(15, 6))
    
    # Left: Full progression
    ax1.plot(progression_days, progression_views, 'b-', linewidth=2, label='Growth Rate ML Curve')
    
    # Mark actual points
    actual_indices = [i for i, t in enumerate(progression_types) if t == 'actual']
    actual_prog_days = [progression_days[i] for i in actual_indices]
    actual_prog_views = [progression_views[i] for i in actual_indices]
    
    ax1.scatter(actual_prog_days, actual_prog_views, color='red', s=100, zorder=5, label='Actual Data Points')
    
    ax1.set_title(f'Growth Rate ML Backfill\n{test_video["title"][:40]}...')
    ax1.set_xlabel('Days Since Published')
    ax1.set_ylabel('View Count')
    ax1.set_yscale('log')
    ax1.legend()
    ax1.grid(True, alpha=0.3)
    
    # Right: Growth rates over time
    daily_growth_rates = []
    for i in range(1, len(progression_views)):
        if progression_types[i] == 'predicted':
            daily_growth = (progression_views[i] / progression_views[i-1]) - 1
            daily_growth_rates.append(daily_growth)
        else:
            daily_growth_rates.append(0)  # Actual points have no predicted growth
    
    ax2.plot(progression_days[1:], [r * 100 for r in daily_growth_rates], 'g-', linewidth=1, alpha=0.7)
    ax2.set_title('Predicted Daily Growth Rates')
    ax2.set_xlabel('Days Since Published')
    ax2.set_ylabel('Daily Growth Rate (%)')
    ax2.grid(True, alpha=0.3)
    ax2.axhline(y=0, color='black', linestyle='--', alpha=0.5)
    
    plt.suptitle(f'Growth Rate ML Test (Model R²: {r2:.1%})', fontsize=14, fontweight='bold')
    plt.tight_layout()
    
    # Save
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    viz_path = f'data/focused_growth_rate_test_{timestamp}.png'
    plt.savefig(viz_path, dpi=300, bbox_inches='tight')
    plt.close()
    
    print(f"✅ Growth rate test complete!")
    print(f"✅ Model creates smooth progression from ML-predicted growth rates")
    print(f"✅ R² Score: {r2:.1%}")
    print(f"💾 Visualization: {viz_path}")
    
    return viz_path

if __name__ == "__main__":
    focused_growth_rate_test()