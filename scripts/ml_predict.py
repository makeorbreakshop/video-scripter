#!/usr/bin/env python3
"""
ML Performance Prediction - Standalone Prediction Script
Called by the Next.js API to make actual XGBoost predictions
"""

import json
import sys
import pickle
import pandas as pd
import numpy as np
import os
from datetime import datetime

def load_latest_model():
    """Load the latest trained XGBoost model"""
    
    model_dir = "models"
    if not os.path.exists(model_dir):
        raise FileNotFoundError("Models directory not found")
    
    # Find latest model files
    model_files = [f for f in os.listdir(model_dir) if f.endswith('.pkl') and 'xgboost_performance_predictor' in f]
    metadata_files = [f for f in os.listdir(model_dir) if f.endswith('_metadata.json')]
    
    if not model_files or not metadata_files:
        raise FileNotFoundError("No trained model found")
    
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

def prepare_features(request_data, metadata):
    """Prepare features for the XGBoost model"""
    
    # Extract basic information
    title = request_data.get('title', '')
    topic_cluster_id = request_data.get('topic_cluster_id', 0)
    format_type = request_data.get('format_type', 'tutorial')
    planned_publish_time = request_data.get('planned_publish_time')
    
    # Parse publish time
    if planned_publish_time:
        try:
            publish_dt = pd.to_datetime(planned_publish_time)
        except:
            publish_dt = pd.Timestamp.now()
    else:
        publish_dt = pd.Timestamp.now()
    
    # Calculate basic features
    features = {
        'topic_cluster_id': int(topic_cluster_id),
        'day_of_week': publish_dt.dayofweek,
        'hour_of_day': publish_dt.hour,
        'title_word_count': len(str(title).split()),
        'day_1_log_multiplier': request_data.get('day_1_log_multiplier', 0.0),
        'day_7_log_multiplier': request_data.get('day_7_log_multiplier', 0.0),
        'view_velocity_3_7': request_data.get('view_velocity_3_7', 0.0)
    }
    
    # One-hot encode format type
    all_formats = [
        'case_study', 'compilation', 'explainer', 'listicle', 'live_stream',
        'news_analysis', 'personal_story', 'product_focus', 'shorts', 
        'tutorial', 'update', 'vlog'
    ]
    
    for fmt in all_formats:
        features[f'format_{fmt}'] = 1 if format_type == fmt else 0
    
    # Create DataFrame with correct column order
    feature_names = metadata['features']
    feature_data = {}
    
    for feature_name in feature_names:
        if feature_name in features:
            feature_data[feature_name] = features[feature_name]
        else:
            # Default values for missing features
            feature_data[feature_name] = 0
    
    df = pd.DataFrame([feature_data])
    
    return df[feature_names]  # Ensure correct column order

def make_prediction(model, features_df, metadata):
    """Make prediction using the XGBoost model"""
    
    try:
        # Make prediction
        prediction = model.predict(features_df)[0]
        
        # Calculate confidence interval using model's standard deviation
        # Use the training performance as a proxy for uncertainty
        train_rmse = metadata['performance'].get('train_rmse', 0.2)
        std_dev = train_rmse
        
        confidence_interval = [
            prediction - std_dev,
            prediction + std_dev
        ]
        
        # Convert log multipliers to actual multipliers
        predicted_multiplier = np.exp(prediction)
        confidence_multipliers = [np.exp(ci) for ci in confidence_interval]
        
        # Get feature importance (from metadata)
        feature_importance = metadata.get('feature_importance', [])
        
        # Find top contributing factors for this prediction
        feature_values = features_df.iloc[0].to_dict()
        top_factors = []
        
        for feat_info in feature_importance[:5]:  # Top 5 features
            feature_name = feat_info['feature']
            importance = feat_info['importance']
            value = feature_values.get(feature_name, 0)
            
            # Create human-readable factor descriptions
            if 'log_multiplier' in feature_name:
                if value != 0:
                    factor_value = f"{np.exp(value):.2f}x baseline"
                else:
                    factor_value = "No early data"
            elif 'format_' in feature_name and value == 1:
                factor_value = feature_name.replace('format_', '').replace('_', ' ').title()
            elif feature_name == 'title_word_count':
                factor_value = f"{int(value)} words"
            elif feature_name == 'day_of_week':
                days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
                factor_value = days[int(value)]
            elif feature_name == 'hour_of_day':
                factor_value = f"{int(value):02d}:00"
            else:
                factor_value = str(value)
            
            # Only include factors that are actually contributing
            if (importance > 0.01 and 
                ((feature_name.startswith('format_') and value == 1) or 
                 not feature_name.startswith('format_') and value != 0)):
                
                top_factors.append({
                    'feature': feature_name.replace('_', ' ').title(),
                    'importance': float(importance),
                    'value': factor_value
                })
        
        # Ensure we have at least some factors
        if not top_factors:
            top_factors = [
                {'feature': 'Topic Cluster', 'importance': 0.1, 'value': str(int(feature_values.get('topic_cluster_id', 0)))},
                {'feature': 'Title Length', 'importance': 0.05, 'value': f"{int(feature_values.get('title_word_count', 0))} words"}
            ]
        
        result = {
            'predicted_multiplier': float(predicted_multiplier),
            'log_multiplier': float(prediction),
            'confidence_interval': [float(ci) for ci in confidence_multipliers],
            'factors': top_factors[:3],  # Top 3 factors
            'model_version': metadata['model_id']
        }
        
        return result
    
    except Exception as e:
        raise Exception(f"Prediction failed: {str(e)}")

def main():
    """Main prediction function - called from Node.js API"""
    
    try:
        # Read input from stdin (passed from Node.js)
        input_data = sys.stdin.read()
        if not input_data.strip():
            raise ValueError("No input data received")
        
        request_data = json.loads(input_data)
        
        # Load model
        model, metadata = load_latest_model()
        
        # Prepare features
        features_df = prepare_features(request_data, metadata)
        
        # Make prediction
        result = make_prediction(model, features_df, metadata)
        
        # Return result as JSON
        print(json.dumps(result))
        
    except Exception as e:
        # Return error as JSON
        error_result = {
            'error': str(e),
            'predicted_multiplier': 1.0,  # Fallback to baseline
            'log_multiplier': 0.0,
            'confidence_interval': [0.8, 1.2],
            'factors': [
                {'feature': 'Error', 'importance': 1.0, 'value': 'Using fallback prediction'}
            ],
            'model_version': 'fallback'
        }
        print(json.dumps(error_result))
        sys.exit(1)

if __name__ == "__main__":
    main()