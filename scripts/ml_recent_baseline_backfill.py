#!/usr/bin/env python3
"""
ML Recent Baseline Backfill
Use ML model to generate synthetic recent baselines for channels with sparse data
"""

import json
import sys
import pickle
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
import os

def load_ml_model():
    """Load the trained XGBoost baseline model"""
    
    model_dir = "models"
    if not os.path.exists(model_dir):
        raise FileNotFoundError("Models directory not found")
    
    # Find latest BASELINE model files (not performance predictor)
    model_files = [f for f in os.listdir(model_dir) if f.endswith('.pkl') and 'xgboost_baseline_predictor' in f]
    metadata_files = [f for f in os.listdir(model_dir) if f.endswith('_metadata.json') and 'baseline_predictor' in f]
    
    if not model_files or not metadata_files:
        raise FileNotFoundError("No trained baseline model found - run ml_baseline_model_training.py first")
    
    latest_model_file = sorted(model_files)[-1]
    latest_metadata_file = sorted(metadata_files)[-1]
    
    # Load model
    model_path = os.path.join(model_dir, latest_model_file)
    with open(model_path, 'rb') as f:
        model = pickle.load(f)
    
    # Load metadata
    metadata_path = os.path.join(model_dir, latest_metadata_file)
    with open(metadata_path, 'r') as f:
        metadata = json.load(f)
    
    return model, metadata

def get_channel_characteristics(channel_data):
    """Extract channel characteristics for ML prediction"""
    
    # Extract basic channel info
    subscriber_count = channel_data.get('subscriber_count', 10000)
    
    # Determine channel tier
    if subscriber_count < 1000:
        channel_tier = 'micro'
    elif subscriber_count < 10000:
        channel_tier = 'small'
    elif subscriber_count < 100000:
        channel_tier = 'medium'
    elif subscriber_count < 1000000:
        channel_tier = 'large'
    else:
        channel_tier = 'mega'
    
    # Get dominant content characteristics
    dominant_format = channel_data.get('dominant_format', 'tutorial')
    dominant_topic = channel_data.get('dominant_topic_cluster', 50)
    avg_title_length = channel_data.get('avg_title_length', 8)
    
    return {
        'subscriber_count': subscriber_count,
        'channel_tier': channel_tier,
        'dominant_format': dominant_format,
        'dominant_topic': dominant_topic,
        'avg_title_length': avg_title_length
    }

def create_baseline_video_features(channel_chars, video_index, metadata):
    """Create features for baseline prediction (not early performance prediction)"""
    
    # Core baseline features from channel characteristics
    features = {
        'subscriber_count': float(channel_chars['subscriber_count']),
        'channel_tier': get_channel_tier_numeric(channel_chars['subscriber_count']),
        'topic_cluster_id': int(channel_chars['dominant_topic']),
        'title_word_count': max(3, int(channel_chars['avg_title_length'] + np.random.normal(0, 1))),
        'day_of_week': np.random.randint(0, 7),
        'hour_of_day': np.random.choice([10, 12, 14, 16, 18, 20])
    }
    
    # One-hot encode format type for baseline model
    baseline_formats = [
        'case_study', 'explainer', 'listicle', 'personal_story', 
        'product_focus', 'shorts', 'tutorial', 'vlog'
    ]
    
    for fmt in baseline_formats:
        features[f'format_{fmt}'] = 1 if channel_chars['dominant_format'] == fmt else 0
    
    # Create DataFrame with correct column order
    feature_names = metadata['features']
    feature_data = {}
    
    for feature_name in feature_names:
        if feature_name in features:
            feature_data[feature_name] = features[feature_name]
        else:
            feature_data[feature_name] = 0
    
    return pd.DataFrame([feature_data])

def get_channel_tier_numeric(subscriber_count):
    """Convert subscriber count to numeric channel tier"""
    if subscriber_count < 1000:
        return 0  # micro
    elif subscriber_count < 10000:
        return 1  # small
    elif subscriber_count < 100000:
        return 2  # medium
    elif subscriber_count < 1000000:
        return 3  # large
    else:
        return 4  # mega

def generate_ml_baseline(channel_data, model, metadata, num_videos=10):
    """Generate ML-based recent baseline for a channel"""
    
    channel_chars = get_channel_characteristics(channel_data)
    
    # Generate predictions for synthetic recent videos
    predictions = []
    
    for i in range(num_videos):
        try:
            # Create baseline prediction features
            features_df = create_baseline_video_features(channel_chars, i, metadata)
            
            # Get ML prediction (log multiplier)
            log_prediction = model.predict(features_df)[0]
            
            # Convert to actual multiplier
            multiplier = np.exp(log_prediction)
            
            # Clamp to reasonable bounds
            multiplier = max(0.1, min(10.0, multiplier))
            
            predictions.append({
                'video_index': i,
                'log_multiplier': float(log_prediction),
                'performance_multiplier': float(multiplier),
                'synthetic': True
            })
            
        except Exception as e:
            # Don't print errors in API mode to avoid breaking JSON output
            # Fallback to baseline
            predictions.append({
                'video_index': i,
                'log_multiplier': 0.0,
                'performance_multiplier': 1.0,
                'synthetic': True
            })
    
    # Calculate baseline statistics
    multipliers = [p['performance_multiplier'] for p in predictions]
    
    baseline_stats = {
        'channel_id': channel_data.get('channel_id'),
        'channel_name': channel_data.get('channel_name', 'Unknown'),
        'method': 'ml_backfill',
        'num_synthetic_videos': num_videos,
        'avg_multiplier': float(np.mean(multipliers)),
        'median_multiplier': float(np.median(multipliers)),
        'std_multiplier': float(np.std(multipliers)),
        'min_multiplier': float(np.min(multipliers)),
        'max_multiplier': float(np.max(multipliers)),
        'predictions': predictions,
        'channel_characteristics': channel_chars,
        'generated_at': datetime.now().isoformat()
    }
    
    return baseline_stats

def process_channel_baselines(channels_data, model, metadata, api_mode=False):
    """Process multiple channels to generate ML baselines"""
    
    results = []
    
    for i, channel_data in enumerate(channels_data):
        try:
            if not api_mode:
                print(f"Processing channel {i+1}/{len(channels_data)}: {channel_data.get('channel_name', 'Unknown')}")
            
            baseline = generate_ml_baseline(channel_data, model, metadata)
            results.append(baseline)
            
        except Exception as e:
            if not api_mode:
                print(f"Error processing channel {channel_data.get('channel_id', 'unknown')}: {e}")
            continue
    
    return results

def main():
    """Main function - can be called from API or run standalone"""
    
    # Check if called from API (with JSON input)
    if len(sys.argv) > 1 and sys.argv[1] == '--api':
        # Read input from stdin (called from Node.js API)
        try:
            input_data = sys.stdin.read()
            if not input_data.strip():
                raise ValueError("No input data received")
            
            request_data = json.loads(input_data)
            
            # Load model
            model, metadata = load_ml_model()
            
            # Process single channel or multiple channels
            if 'channels' in request_data:
                channels_data = request_data['channels']
            else:
                channels_data = [request_data]  # Single channel
            
            # Generate baselines (API mode - no debug prints)
            results = process_channel_baselines(channels_data, model, metadata, api_mode=True)
            
            # Return results as JSON
            output = {
                'success': True,
                'baselines': results,
                'model_version': metadata['model_id']
            }
            
            print(json.dumps(output))
            
        except Exception as e:
            # Return error as JSON
            error_output = {
                'success': False,
                'error': str(e),
                'baselines': []
            }
            print(json.dumps(error_output))
            sys.exit(1)
    
    else:
        # Standalone mode - test with sample data
        print("🚀 Testing ML Recent Baseline Backfill...")
        
        # Load model
        print("📦 Loading ML model...")
        model, metadata = load_ml_model()
        
        # Sample channel data for testing
        sample_channels = [
            {
                'channel_id': 'UCgwaPlarb9k0PS2BQphCLNQ',
                'channel_name': 'Steve Ramsey - WWMM',
                'subscriber_count': 119000,
                'dominant_format': 'tutorial',
                'dominant_topic_cluster': 166,
                'avg_title_length': 9
            },
            {
                'channel_id': 'UCEjIjshJ8bvvCkGNk0pkYcA',
                'channel_name': 'Athlean-X',
                'subscriber_count': 7170000,
                'dominant_format': 'case_study',
                'dominant_topic_cluster': 23,
                'avg_title_length': 11
            },
            {
                'channel_id': 'UCbRP3c757lWg9M-U7TyEkXA',
                'channel_name': 'Veritasium',
                'subscriber_count': 460000,
                'dominant_format': 'explainer',
                'dominant_topic_cluster': 17,
                'avg_title_length': 7
            }
        ]
        
        # Generate baselines
        print("🎯 Generating ML-based recent baselines...")
        results = process_channel_baselines(sample_channels, model, metadata)
        
        # Save results
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        output_path = f"data/ml_recent_baselines_{timestamp}.json"
        
        output_data = {
            'generated_at': timestamp,
            'model_version': metadata['model_id'],
            'total_channels': len(results),
            'baselines': results
        }
        
        with open(output_path, 'w') as f:
            json.dump(output_data, f, indent=2)
        
        print(f"💾 Saved results: {output_path}")
        
        # Print summary
        print("\n📊 Summary:")
        for baseline in results:
            print(f"  {baseline['channel_name']}:")
            print(f"    Avg multiplier: {baseline['avg_multiplier']:.2f}x")
            print(f"    Range: {baseline['min_multiplier']:.2f}x - {baseline['max_multiplier']:.2f}x")
            print(f"    Channel tier: {baseline['channel_characteristics']['channel_tier']}")
        
        print("\n✅ ML baseline backfill complete!")

if __name__ == "__main__":
    main()