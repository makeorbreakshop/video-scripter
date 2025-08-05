#!/usr/bin/env python3
"""
ML Performance Prediction - Model Training Script
Train XGBoost model to predict Day 30 performance using early signals
"""

import pandas as pd
import numpy as np
import json
import pickle
from datetime import datetime
import xgboost as xgb
from sklearn.model_selection import train_test_split, cross_val_score
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
import shap
import os

def load_training_data(file_path="data/ml_training_dataset.csv"):
    """Load the prepared training dataset"""
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"Training dataset not found at {file_path}")
    
    df = pd.read_csv(file_path)
    print(f"📊 Loaded {len(df)} training examples")
    return df

def prepare_features_and_target(df):
    """Prepare feature matrix and target variable"""
    
    # Feature columns (using early signals to predict day 30)
    feature_cols = [
        'topic_cluster_id', 'format_type', 'day_of_week', 'hour_of_day', 
        'title_word_count', 'day_1_log_multiplier', 'day_3_log_multiplier', 
        'day_7_log_multiplier', 'view_velocity_3_7'
    ]
    
    # Target: Day 30 log multiplier
    target_col = 'day_30_log_multiplier'
    
    # Filter to rows with all required features
    valid_mask = df[feature_cols + [target_col]].notna().all(axis=1)
    df_clean = df[valid_mask].copy()
    
    print(f"🧹 Using {len(df_clean)} examples with complete features")
    
    # One-hot encode categorical features
    df_encoded = pd.get_dummies(df_clean, columns=['format_type'], prefix='format')
    
    # Update feature columns to include encoded categories
    feature_cols_encoded = [col for col in df_encoded.columns if col.startswith('format_') or col in [
        'topic_cluster_id', 'day_of_week', 'hour_of_day', 'title_word_count', 
        'day_1_log_multiplier', 'day_3_log_multiplier', 'day_7_log_multiplier', 'view_velocity_3_7'
    ]]
    
    X = df_encoded[feature_cols_encoded]
    y = df_encoded[target_col]
    
    print(f"🎯 Features: {len(feature_cols_encoded)} columns")
    print(f"📈 Target range: {y.min():.3f} to {y.max():.3f} log multipliers")
    
    return X, y, feature_cols_encoded

def train_xgboost_model(X, y):
    """Train XGBoost model with cross-validation"""
    
    # Split data temporally (older videos for training, newer for validation)
    # Since we have limited data, use 80/20 split
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42
    )
    
    print(f"📊 Training on {len(X_train)} examples, testing on {len(X_test)}")
    
    # XGBoost parameters optimized for small dataset
    params = {
        'objective': 'reg:squarederror',
        'max_depth': 3,  # Shallow trees to avoid overfitting
        'learning_rate': 0.1,
        'n_estimators': 100,
        'subsample': 0.8,
        'colsample_bytree': 0.8,
        'random_state': 42,
        'early_stopping_rounds': 20
    }
    
    # Train model
    model = xgb.XGBRegressor(**params)
    model.fit(
        X_train, y_train,
        eval_set=[(X_test, y_test)],
        verbose=False
    )
    
    # Predictions
    y_pred_train = model.predict(X_train)
    y_pred_test = model.predict(X_test)
    
    # Metrics
    train_mae = mean_absolute_error(y_train, y_pred_train)
    test_mae = mean_absolute_error(y_test, y_pred_test)
    train_rmse = np.sqrt(mean_squared_error(y_train, y_pred_train))
    test_rmse = np.sqrt(mean_squared_error(y_test, y_pred_test))
    train_r2 = r2_score(y_train, y_pred_train)
    test_r2 = r2_score(y_test, y_pred_test)
    
    # Baseline (always predict 0.0 = 1x multiplier)
    baseline_mae = mean_absolute_error(y_test, np.zeros_like(y_test))
    baseline_rmse = np.sqrt(mean_squared_error(y_test, np.zeros_like(y_test)))
    
    # Performance summary
    results = {
        'train_mae': train_mae,
        'test_mae': test_mae,
        'train_rmse': train_rmse,
        'test_rmse': test_rmse,
        'train_r2': train_r2,
        'test_r2': test_r2,
        'baseline_mae': baseline_mae,
        'baseline_rmse': baseline_rmse,
        'improvement_mae': (baseline_mae - test_mae) / baseline_mae * 100,
        'improvement_rmse': (baseline_rmse - test_rmse) / baseline_rmse * 100
    }
    
    print("🎯 Model Performance:")
    print(f"   Train MAE: {train_mae:.3f} | Test MAE: {test_mae:.3f}")
    print(f"   Train RMSE: {train_rmse:.3f} | Test RMSE: {test_rmse:.3f}")
    print(f"   Train R²: {train_r2:.3f} | Test R²: {test_r2:.3f}")
    print(f"   Baseline MAE: {baseline_mae:.3f} | Improvement: {results['improvement_mae']:.1f}%")
    print(f"   Baseline RMSE: {baseline_rmse:.3f} | Improvement: {results['improvement_rmse']:.1f}%")
    
    return model, results, (X_train, X_test, y_train, y_test)

def generate_shap_analysis(model, X, feature_names, max_examples=20):
    """Generate SHAP values for model interpretability"""
    
    print("🔍 Generating SHAP analysis...")
    
    # Use a subset for SHAP analysis (it's computationally expensive)
    X_sample = X.head(min(max_examples, len(X)))
    
    # Create SHAP explainer
    explainer = shap.TreeExplainer(model)
    shap_values = explainer.shap_values(X_sample)
    
    # Feature importance summary
    importance_df = pd.DataFrame({
        'feature': feature_names,
        'importance': np.abs(shap_values).mean(axis=0)
    }).sort_values('importance', ascending=False)
    
    print("📈 Top Feature Importance:")
    for _, row in importance_df.head(10).iterrows():
        print(f"   {row['feature']}: {row['importance']:.4f}")
    
    return shap_values, importance_df

def save_model_and_artifacts(model, results, feature_names, shap_importance, model_dir="models"):
    """Save trained model and analysis artifacts"""
    
    os.makedirs(model_dir, exist_ok=True)
    
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    model_id = f"xgboost_performance_predictor_{timestamp}"
    
    # Save model
    model_path = f"{model_dir}/{model_id}.pkl"
    with open(model_path, 'wb') as f:
        pickle.dump(model, f)
    
    # Save metadata
    metadata = {
        'model_id': model_id,
        'created_at': timestamp,
        'model_type': 'xgboost',
        'target': 'day_30_log_multiplier',
        'features': feature_names,
        'performance': results,
        'feature_importance': shap_importance.to_dict('records')
    }
    
    metadata_path = f"{model_dir}/{model_id}_metadata.json"
    with open(metadata_path, 'w') as f:
        json.dump(metadata, f, indent=2)
    
    print(f"💾 Saved model: {model_path}")
    print(f"📋 Saved metadata: {metadata_path}")
    
    return model_id, model_path, metadata_path

def test_predictions(model, X_test, y_test, feature_names):
    """Test model predictions on specific examples"""
    
    print("\n🧪 Testing predictions on sample videos:")
    
    predictions = model.predict(X_test)
    
    for i in range(min(5, len(X_test))):
        actual_log = y_test.iloc[i]
        predicted_log = predictions[i]
        
        # Convert back to multipliers
        actual_multiplier = np.exp(actual_log)
        predicted_multiplier = np.exp(predicted_log)
        
        print(f"   Video {i+1}:")
        print(f"     Actual: {actual_multiplier:.2f}x (log: {actual_log:.3f})")
        print(f"     Predicted: {predicted_multiplier:.2f}x (log: {predicted_log:.3f})")
        print(f"     Error: {abs(actual_log - predicted_log):.3f} log units")

def main():
    """Main training pipeline"""
    print("🚀 Starting ML model training...")
    
    # Load data
    print("📁 Loading training data...")
    df = load_training_data()
    
    # Prepare features
    print("⚙️ Preparing features and target...")
    X, y, feature_names = prepare_features_and_target(df)
    
    if len(X) < 10:
        print("⚠️ Not enough training examples for reliable model")
        return
    
    # Train model
    print("🎓 Training XGBoost model...")
    model, results, splits = train_xgboost_model(X, y)
    X_train, X_test, y_train, y_test = splits
    
    # SHAP analysis
    shap_values, importance_df = generate_shap_analysis(model, X_train, feature_names)
    
    # Save model
    print("💾 Saving model and artifacts...")
    model_id, model_path, metadata_path = save_model_and_artifacts(
        model, results, feature_names, importance_df
    )
    
    # Test predictions
    test_predictions(model, X_test, y_test, feature_names)
    
    print(f"✅ Model training complete! Model ID: {model_id}")
    
    # Success criteria check
    if results['improvement_mae'] > 30:
        print("🎉 SUCCESS: Model beats baseline by >30% on MAE!")
    else:
        print("⚠️ Model improvement below 30% threshold")

if __name__ == "__main__":
    main()