#!/usr/bin/env python3

"""
Debug ML Backfill - Find out why ML is giving crazy predictions
"""

import json
import pandas as pd
import numpy as np
import pickle
import matplotlib.pyplot as plt

def debug_ml_prediction():
    print("🔍 DEBUGGING ML PREDICTIONS...")
    
    # Load ML model
    with open('models/historical_backfill_model_20250806_100239.pkl', 'rb') as f:
        model = pickle.load(f)
    
    with open('models/historical_backfill_preprocessing_20250806_100239.pkl', 'rb') as f:
        preprocessors = pickle.load(f)
    
    with open('models/historical_backfill_metadata_20250806_100239.json', 'r') as f:
        metadata = json.load(f)
    
    print(f"✅ Model loaded: {metadata['test_r2']:.1%} accuracy")
    
    # Load ILTMS data
    all_data = []
    for i in range(1, 15):
        try:
            with open(f'data/ml_training_batch_{i}.json', 'r') as f:
                batch_data = json.load(f)
                all_data.extend(batch_data)
        except FileNotFoundError:
            continue
    
    df = pd.DataFrame(all_data)
    iltms_data = df[df['channel_name'] == 'I Like To Make Stuff'].copy()
    
    # Convert numeric columns
    numeric_columns = ['subscriber_count', 'channel_video_count', 'view_count', 
                      'days_since_published', 'title_length', 'title_word_count']
    for col in numeric_columns:
        iltms_data[col] = pd.to_numeric(iltms_data[col], errors='coerce')
    
    # Get one video for debugging
    video_groups = []
    for video_id in iltms_data['video_id'].unique():
        video_data = iltms_data[iltms_data['video_id'] == video_id]
        if len(video_data) >= 3:  # Get video with good data
            video_groups.append({
                'video_id': video_id,
                'title': video_data['title'].iloc[0],
                'data': video_data.sort_values('days_since_published')
            })
    
    if not video_groups:
        print("❌ No suitable video found")
        return
    
    # Use first good video
    test_video = video_groups[0]
    video_data = test_video['data']
    
    print(f"\n🎬 Testing video: {test_video['title']}")
    print(f"   Actual data points: {len(video_data)}")
    
    # Calculate channel baseline
    channel_baseline = iltms_data['view_count'].median()
    print(f"   Channel baseline: {channel_baseline:,.0f} views")
    
    # Get video info for prediction
    video_info = video_data.iloc[0].to_dict()
    video_info['log_channel_baseline'] = np.log1p(channel_baseline)
    
    # Set categories
    video_info['days_category'] = 'month1'
    subs = video_info['subscriber_count']
    if subs >= 1000000:
        video_info['subscriber_tier'] = 'large'
    else:
        video_info['subscriber_tier'] = 'medium'
    
    print(f"\n📊 Video features:")
    print(f"   Subscribers: {subs:,}")
    print(f"   Channel videos: {video_info['channel_video_count']}")
    print(f"   Title length: {video_info['title_length']}")
    print(f"   Format: {video_info.get('format_type', 'unknown')}")
    print(f"   Topic: {video_info.get('topic_domain', 'unknown')}")
    
    # Test predictions for different days
    print(f"\n🤖 ML PREDICTIONS TEST:")
    
    actual_points = video_data[['days_since_published', 'view_count']].values
    print(f"\nActual data points:")
    for day, views in actual_points:
        print(f"   Day {int(day):2d}: {views:8,.0f} views")
    
    print(f"\nML predictions:")
    
    for test_day in [1, 7, 14, 30, 60, 90]:
        predicted_views = predict_views_debug(model, preprocessors, metadata, video_info, test_day)
        
        # Find closest actual point
        actual_day_diff = np.abs(actual_points[:, 0] - test_day)
        closest_idx = np.argmin(actual_day_diff)
        closest_day = int(actual_points[closest_idx, 0])
        closest_views = actual_points[closest_idx, 1]
        
        ratio = predicted_views / closest_views if closest_views > 0 else 0
        
        print(f"   Day {test_day:2d}: {predicted_views:8,.0f} views (vs day {closest_day}: {closest_views:8,.0f}, ratio: {ratio:.2f}x)")
    
    # Test progression for the problematic video
    print(f"\n📈 FULL PROGRESSION TEST:")
    
    progression_data = []
    for day in range(1, 91):
        predicted_views = predict_views_debug(model, preprocessors, metadata, video_info, day)
        progression_data.append({
            'day': day,
            'predicted_views': predicted_views
        })
    
    df_progression = pd.DataFrame(progression_data)
    
    # Check for crazy jumps
    df_progression['daily_change'] = df_progression['predicted_views'].diff()
    df_progression['pct_change'] = df_progression['predicted_views'].pct_change() * 100
    
    crazy_changes = df_progression[abs(df_progression['pct_change']) > 100]  # >100% change
    
    if len(crazy_changes) > 0:
        print(f"⚠️ Found {len(crazy_changes)} days with >100% change:")
        for _, row in crazy_changes.head(10).iterrows():
            print(f"   Day {row['day']:2d}: {row['predicted_views']:8,.0f} views ({row['pct_change']:+.1f}% change)")
    else:
        print(f"✅ No crazy day-to-day changes found")
    
    # Plot the progression
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(15, 6))
    
    # Left: Full progression
    ax1.plot(df_progression['day'], df_progression['predicted_views'], 'b-', linewidth=2, label='ML Prediction')
    ax1.scatter(actual_points[:, 0], actual_points[:, 1], color='red', s=100, zorder=5, label='Actual Data')
    ax1.set_title(f'ML Predictions vs Actual\n{test_video["title"][:40]}...')
    ax1.set_xlabel('Days Since Published')
    ax1.set_ylabel('View Count')
    ax1.legend()
    ax1.grid(True, alpha=0.3)
    ax1.set_yscale('log')
    
    # Right: Daily changes
    ax2.plot(df_progression['day'][1:], df_progression['pct_change'][1:], 'r-', linewidth=1, alpha=0.7)
    ax2.axhline(y=0, color='black', linestyle='--', alpha=0.5)
    ax2.axhline(y=100, color='red', linestyle='--', alpha=0.5, label='>100% change')
    ax2.axhline(y=-50, color='red', linestyle='--', alpha=0.5)
    ax2.set_title('Daily Percentage Changes in Predictions')
    ax2.set_xlabel('Days Since Published')
    ax2.set_ylabel('% Change from Previous Day')
    ax2.legend()
    ax2.grid(True, alpha=0.3)
    
    plt.tight_layout()
    
    debug_path = 'data/ml_debug_predictions.png'
    plt.savefig(debug_path, dpi=300, bbox_inches='tight')
    print(f"\n💾 Debug visualization: {debug_path}")
    
    return debug_path

def predict_views_debug(model, preprocessors, metadata, video_info, day):
    """Debug version of ML prediction with detailed logging"""
    
    try:
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
            if cat_col in preprocessors['encoders']:
                try:
                    value_to_encode = str(video_info.get(cat_col, 'unknown'))
                    encoded_val = preprocessors['encoders'][cat_col].transform([value_to_encode])[0]
                    features[f'{cat_col}_encoded'] = encoded_val
                except:
                    # If encoding fails, use 0 as default
                    features[f'{cat_col}_encoded'] = 0
        
        # Create DataFrame
        feature_df = pd.DataFrame([features])
        
        # Scale numerical features
        numerical_cols = [col for col in metadata['feature_columns'] if not col.endswith('_encoded')]
        if len(numerical_cols) > 0:
            feature_df[numerical_cols] = preprocessors['scalers']['features'].transform(feature_df[numerical_cols])
        
        # Make prediction (model outputs log views)
        log_views_pred = model.predict(feature_df[metadata['feature_columns']])[0]
        views_pred = np.expm1(log_views_pred)  # Convert from log space
        
        return max(views_pred, 100)  # Minimum 100 views
        
    except Exception as e:
        print(f"❌ Prediction failed for day {day}: {e}")
        return video_info.get('log_channel_baseline', 10000)

if __name__ == "__main__":
    debug_ml_prediction()