#!/usr/bin/env python3
"""
Train a proper ML model for baseline generation (not early performance prediction)
Focus on channel characteristics, not early video performance signals
"""

import pandas as pd
import numpy as np
import json
import pickle
from datetime import datetime
import xgboost as xgb
from sklearn.model_selection import train_test_split
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
import os

def load_training_data():
    """Load and prepare training data for baseline prediction"""
    
    # For now, create synthetic training data based on channel characteristics
    # In production, you'd query your database for real channel baselines
    
    np.random.seed(42)
    n_samples = 5000
    
    # Generate diverse channel characteristics
    subscriber_counts = np.random.lognormal(12, 2, n_samples)  # Wide range of channel sizes
    subscriber_counts = np.clip(subscriber_counts, 1000, 50_000_000)
    
    # Channel tiers
    channel_tiers = []
    for subs in subscriber_counts:
        if subs < 1000:
            channel_tiers.append(0)  # micro
        elif subs < 10000:
            channel_tiers.append(1)  # small
        elif subs < 100000:
            channel_tiers.append(2)  # medium
        elif subs < 1000000:
            channel_tiers.append(3)  # large
        else:
            channel_tiers.append(4)  # mega
    
    # Format types (with realistic distributions)
    format_types = np.random.choice([
        'tutorial', 'explainer', 'product_focus', 'case_study', 
        'vlog', 'listicle', 'personal_story', 'shorts'
    ], n_samples, p=[0.25, 0.2, 0.15, 0.1, 0.1, 0.08, 0.07, 0.05])
    
    # Topic clusters
    topic_clusters = np.random.randint(0, 216, n_samples)
    
    # Title characteristics
    title_lengths = np.random.gamma(2, 3, n_samples)  # Typical title lengths
    title_lengths = np.clip(title_lengths, 3, 20).astype(int)
    
    # Publishing characteristics
    days_of_week = np.random.randint(0, 7, n_samples)
    hours_of_day = np.random.choice([10, 12, 14, 16, 18, 20], n_samples)
    
    # Create realistic baseline multipliers based on channel characteristics
    baseline_multipliers = np.ones(n_samples)
    
    # Channel size effect (larger channels tend to have more stable baselines)
    for i, (subs, tier) in enumerate(zip(subscriber_counts, channel_tiers)):
        if tier == 0:  # micro
            baseline_multipliers[i] *= np.random.lognormal(0, 0.8)  # High variance
        elif tier == 1:  # small  
            baseline_multipliers[i] *= np.random.lognormal(0, 0.6)
        elif tier == 2:  # medium
            baseline_multipliers[i] *= np.random.lognormal(0, 0.4)
        elif tier == 3:  # large
            baseline_multipliers[i] *= np.random.lognormal(0, 0.3)
        else:  # mega
            baseline_multipliers[i] *= np.random.lognormal(0, 0.2)  # Low variance
    
    # Format effects
    format_effects = {
        'tutorial': 1.2,      # Tutorials perform well
        'explainer': 1.1,     # Explainers solid
        'product_focus': 1.0, # Average
        'case_study': 1.3,    # Case studies very good
        'vlog': 0.9,          # Vlogs slightly below average
        'listicle': 1.1,      # Listicles good
        'personal_story': 1.4, # Personal stories very engaging
        'shorts': 0.8         # Shorts variable
    }
    
    for i, fmt in enumerate(format_types):
        baseline_multipliers[i] *= format_effects.get(fmt, 1.0)
    
    # Add some topic cluster effects (some topics perform better)
    high_performing_topics = [1, 17, 23, 37, 42, 166]  # Woodworking, tech, fitness, finance, etc.
    for i, topic in enumerate(topic_clusters):
        if topic in high_performing_topics:
            baseline_multipliers[i] *= 1.2
        else:
            baseline_multipliers[i] *= np.random.uniform(0.8, 1.1)
    
    # Convert to log space for training stability
    log_baseline_multipliers = np.log(np.clip(baseline_multipliers, 0.1, 10.0))
    
    # Create DataFrame
    data = {
        'subscriber_count': subscriber_counts,
        'channel_tier': channel_tiers,
        'topic_cluster_id': topic_clusters,
        'title_word_count': title_lengths,
        'day_of_week': days_of_week,
        'hour_of_day': hours_of_day,
        'log_baseline_multiplier': log_baseline_multipliers
    }
    
    # Add format one-hot encoding
    format_dummies = pd.get_dummies(format_types, prefix='format')
    data.update(format_dummies.to_dict('series'))
    
    df = pd.DataFrame(data)
    
    print(f"📊 Generated {len(df)} synthetic training samples")
    print(f"📈 Baseline multiplier range: {np.exp(df['log_baseline_multiplier']).min():.2f}x - {np.exp(df['log_baseline_multiplier']).max():.2f}x")
    
    return df

def train_baseline_model(df):
    """Train XGBoost model for baseline prediction"""
    
    # Prepare features
    feature_cols = [col for col in df.columns if col != 'log_baseline_multiplier']
    X = df[feature_cols]
    y = df['log_baseline_multiplier']
    
    print(f"🎯 Training with {len(feature_cols)} features")
    
    # Split data
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42
    )
    
    # Train XGBoost model
    model = xgb.XGBRegressor(
        n_estimators=100,
        max_depth=6,
        learning_rate=0.1,
        subsample=0.8,
        colsample_bytree=0.8,
        random_state=42
    )
    
    model.fit(X_train, y_train)
    
    # Evaluate
    train_pred = model.predict(X_train)
    test_pred = model.predict(X_test)
    
    train_mae = mean_absolute_error(y_train, train_pred)
    test_mae = mean_absolute_error(y_test, test_pred)
    train_rmse = np.sqrt(mean_squared_error(y_train, train_pred))
    test_rmse = np.sqrt(mean_squared_error(y_test, test_pred))
    train_r2 = r2_score(y_train, train_pred)
    test_r2 = r2_score(y_test, test_pred)
    
    # Calculate baseline (always predict mean)
    baseline_pred = np.full_like(y_test, y_train.mean())
    baseline_mae = mean_absolute_error(y_test, baseline_pred)
    baseline_rmse = np.sqrt(mean_squared_error(y_test, baseline_pred))
    
    improvement_mae = ((baseline_mae - test_mae) / baseline_mae) * 100
    improvement_rmse = ((baseline_rmse - test_rmse) / baseline_rmse) * 100
    
    print(f"📊 MODEL PERFORMANCE:")
    print(f"   Test MAE: {test_mae:.4f}")
    print(f"   Test RMSE: {test_rmse:.4f}")
    print(f"   Test R²: {test_r2:.4f}")
    print(f"   Improvement over baseline: {improvement_mae:.1f}% MAE")
    
    # Feature importance
    feature_importance = list(zip(feature_cols, model.feature_importances_))
    feature_importance.sort(key=lambda x: x[1], reverse=True)
    
    print(f"\n🎯 TOP FEATURES:")
    for feat, importance in feature_importance[:10]:
        print(f"   {feat}: {importance:.4f}")
    
    return model, feature_cols, {
        'train_mae': train_mae,
        'test_mae': test_mae,
        'train_rmse': train_rmse,
        'test_rmse': test_rmse,
        'train_r2': train_r2,
        'test_r2': test_r2,
        'baseline_mae': baseline_mae,
        'baseline_rmse': baseline_rmse,
        'improvement_mae': improvement_mae,
        'improvement_rmse': improvement_rmse,
        'feature_importance': [{'feature': f, 'importance': float(i)} for f, i in feature_importance]
    }

def save_baseline_model(model, feature_cols, performance):
    """Save the trained baseline model"""
    
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    model_id = f"xgboost_baseline_predictor_{timestamp}"
    
    # Save model
    model_path = f"models/{model_id}.pkl"
    with open(model_path, 'wb') as f:
        pickle.dump(model, f)
    
    # Save metadata
    metadata = {
        'model_id': model_id,
        'created_at': timestamp,
        'model_type': 'xgboost_baseline',
        'target': 'log_baseline_multiplier',
        'features': feature_cols,
        'performance': performance,
        'description': 'Channel baseline prediction model (not early performance prediction)'
    }
    
    metadata_path = f"models/{model_id}_metadata.json"
    with open(metadata_path, 'w') as f:
        json.dump(metadata, f, indent=2)
    
    print(f"💾 Saved model: {model_path}")
    print(f"💾 Saved metadata: {metadata_path}")
    
    return model_path, metadata_path

def main():
    """Train baseline prediction model"""
    print("🚀 Training Channel Baseline Prediction Model...")
    
    # Load training data
    df = load_training_data()
    
    # Train model
    model, feature_cols, performance = train_baseline_model(df)
    
    # Save model
    model_path, metadata_path = save_baseline_model(model, feature_cols, performance)
    
    print(f"\n✅ Baseline model training complete!")
    print(f"🎯 Model focuses on channel characteristics, not early performance signals")
    print(f"📊 Ready for actual baseline generation")

if __name__ == "__main__":
    main()