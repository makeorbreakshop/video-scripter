#!/usr/bin/env python3
"""
ML Performance Prediction - Pattern Extraction Script
Generate actionable insights from trained XGBoost model using SHAP analysis
"""

import pandas as pd
import numpy as np
import json
import pickle
from datetime import datetime
import xgboost as xgb
import shap
import os
from collections import defaultdict

def load_model_and_data():
    """Load the trained model and training dataset"""
    
    # Find the latest model
    model_dir = "models"
    model_files = [f for f in os.listdir(model_dir) if f.endswith('.pkl') and 'xgboost_performance_predictor' in f]
    if not model_files:
        raise FileNotFoundError("No trained XGBoost model found")
    
    latest_model = sorted(model_files)[-1]
    model_path = f"{model_dir}/{latest_model}"
    
    print(f"📦 Loading model: {latest_model}")
    
    # Load model
    with open(model_path, 'rb') as f:
        model = pickle.load(f)
    
    # Load metadata
    metadata_path = model_path.replace('.pkl', '_metadata.json')
    with open(metadata_path, 'r') as f:
        metadata = json.load(f)
    
    # Load training data
    df = pd.read_csv("data/ml_training_dataset_fixed.csv")
    
    print(f"📊 Loaded model with {len(metadata['features'])} features")
    print(f"📊 Training data: {len(df)} examples")
    
    return model, metadata, df

def prepare_shap_analysis(model, df, metadata):
    """Prepare data for SHAP analysis"""
    
    # Prepare features exactly as in training
    feature_cols = [
        'topic_cluster_id', 'format_type', 'day_of_week', 'hour_of_day', 
        'title_word_count', 'day_1_log_multiplier', 'day_7_log_multiplier', 
        'view_velocity_3_7'
    ]
    
    # Filter to rows with all required features
    valid_mask = df[feature_cols + ['day_30_log_multiplier']].notna().all(axis=1)
    df_clean = df[valid_mask].copy()
    
    # One-hot encode categorical features
    df_encoded = pd.get_dummies(df_clean, columns=['format_type'], prefix='format')
    
    # Get feature columns that match trained model
    feature_cols_encoded = [col for col in metadata['features'] if col in df_encoded.columns]
    
    X = df_encoded[feature_cols_encoded]
    y = df_encoded['day_30_log_multiplier']
    
    print(f"🧹 SHAP analysis on {len(X)} examples with {len(feature_cols_encoded)} features")
    
    return X, y, df_clean

def generate_topic_cluster_patterns(model, X, df_clean, max_examples_per_cluster=50):
    """Generate SHAP patterns for each topic cluster"""
    
    print("🔍 Generating SHAP patterns by topic cluster...")
    
    # Create SHAP explainer
    explainer = shap.TreeExplainer(model)
    
    # Group by topic cluster
    cluster_patterns = {}
    topic_clusters = df_clean['topic_cluster_id'].unique()
    
    print(f"📈 Analyzing {len(topic_clusters)} topic clusters")
    
    for cluster_id in sorted(topic_clusters):
        if pd.isna(cluster_id):
            continue
            
        cluster_mask = df_clean['topic_cluster_id'] == cluster_id
        cluster_X = X[cluster_mask]
        cluster_df = df_clean[cluster_mask]
        
        if len(cluster_X) == 0:
            continue
            
        # Limit examples per cluster for performance
        if len(cluster_X) > max_examples_per_cluster:
            sample_indices = np.random.choice(len(cluster_X), max_examples_per_cluster, replace=False)
            cluster_X_sample = cluster_X.iloc[sample_indices]
            cluster_df_sample = cluster_df.iloc[sample_indices]
        else:
            cluster_X_sample = cluster_X
            cluster_df_sample = cluster_df
        
        # Generate SHAP values for this cluster
        shap_values = explainer.shap_values(cluster_X_sample)
        
        # Calculate feature importance for this cluster
        feature_importance = pd.DataFrame({
            'feature': cluster_X_sample.columns,
            'importance': np.abs(shap_values).mean(axis=0)
        }).sort_values('importance', ascending=False)
        
        # Get top performing videos in this cluster
        top_performers = cluster_df_sample.nlargest(3, 'day_30_log_multiplier')
        avg_performance = cluster_df_sample['day_30_log_multiplier'].mean()
        
        # Store pattern
        cluster_patterns[int(cluster_id)] = {
            'cluster_id': int(cluster_id),
            'video_count': len(cluster_df),
            'avg_log_multiplier': float(avg_performance),
            'avg_multiplier': float(np.exp(avg_performance)),
            'top_features': feature_importance.head(5).to_dict('records'),
            'example_videos': [
                {
                    'video_id': row['video_id'],
                    'log_multiplier': float(row['day_30_log_multiplier']),
                    'multiplier': float(np.exp(row['day_30_log_multiplier'])),
                    'title': row.get('title', 'Unknown')
                }
                for _, row in top_performers.iterrows()
            ]
        }
        
        if len(cluster_patterns) % 20 == 0:
            print(f"   Processed {len(cluster_patterns)} clusters...")
    
    print(f"✅ Generated patterns for {len(cluster_patterns)} topic clusters")
    return cluster_patterns

def extract_if_then_rules(cluster_patterns, min_performance_boost=0.2):
    """Convert SHAP patterns to actionable if-then rules"""
    
    print("📝 Extracting if-then rules...")
    
    rules = []
    
    for cluster_id, pattern in cluster_patterns.items():
        avg_multiplier = pattern['avg_multiplier']
        
        # Only create rules for clusters with above-average performance
        if avg_multiplier < 1.2:  # Less than 20% boost
            continue
            
        top_features = pattern['top_features'][:3]  # Top 3 features
        
        # Create rule conditions
        conditions = []
        for feature_data in top_features:
            feature = feature_data['feature']
            importance = feature_data['importance']
            
            # Skip low-importance features
            if importance < 0.01:
                continue
                
            if feature.startswith('format_'):
                format_name = feature.replace('format_', '').replace('_', ' ').title()
                conditions.append(f"format = '{format_name}'")
            elif feature == 'topic_cluster_id':
                conditions.append(f"topic_cluster = {cluster_id}")
            elif feature in ['day_1_log_multiplier', 'day_7_log_multiplier']:
                conditions.append(f"{feature} > 0.3")  # Above baseline performance
            elif feature == 'view_velocity_3_7':
                conditions.append(f"early_velocity > 0.5")
            elif feature == 'title_word_count':
                conditions.append(f"title_length < 8")  # Concise titles
        
        if conditions:
            rule = {
                'rule_id': len(rules) + 1,
                'cluster_id': cluster_id,
                'conditions': conditions,
                'performance_boost': f"{((avg_multiplier - 1) * 100):.1f}%",
                'avg_multiplier': avg_multiplier,
                'example_count': pattern['video_count'],
                'examples': pattern['example_videos'][:2],  # Top 2 examples
                'confidence': min(0.95, 0.5 + (avg_multiplier - 1) * 0.3)  # Heuristic confidence
            }
            rules.append(rule)
    
    # Sort by performance boost
    rules.sort(key=lambda x: x['avg_multiplier'], reverse=True)
    
    print(f"📋 Generated {len(rules)} actionable rules")
    return rules

def generate_pattern_categories(rules):
    """Categorize patterns by type"""
    
    categories = {
        'title_patterns': [],
        'timing_patterns': [],
        'format_topic_combos': [],
        'velocity_patterns': [],
        'channel_tier_patterns': []
    }
    
    for rule in rules:
        conditions = rule['conditions']
        
        # Categorize based on conditions
        if any('title_length' in cond for cond in conditions):
            categories['title_patterns'].append(rule)
        elif any('day_of_week' in cond or 'hour_of_day' in cond for cond in conditions):
            categories['timing_patterns'].append(rule)
        elif any('format' in cond for cond in conditions) and any('topic_cluster' in cond for cond in conditions):
            categories['format_topic_combos'].append(rule)
        elif any('velocity' in cond for cond in conditions):
            categories['velocity_patterns'].append(rule)
        else:
            categories['format_topic_combos'].append(rule)  # Default category
    
    return categories

def save_pattern_analysis(cluster_patterns, rules, categories):
    """Save pattern analysis results"""
    
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    
    # Save detailed cluster patterns
    cluster_path = f"data/ml_cluster_patterns_{timestamp}.json"
    with open(cluster_path, 'w') as f:
        json.dump(cluster_patterns, f, indent=2)
    
    # Save actionable rules
    rules_path = f"data/ml_actionable_rules_{timestamp}.json"
    rules_data = {
        'generated_at': timestamp,
        'total_rules': len(rules),
        'rules': rules,
        'categories': categories
    }
    
    with open(rules_path, 'w') as f:
        json.dump(rules_data, f, indent=2)
    
    print(f"💾 Saved cluster patterns: {cluster_path}")
    print(f"💾 Saved actionable rules: {rules_path}")
    
    return cluster_path, rules_path

def print_pattern_summary(rules, categories):
    """Print a summary of extracted patterns"""
    
    print("\n🎯 Pattern Extraction Summary:")
    print(f"   Total actionable rules: {len(rules)}")
    
    for category, category_rules in categories.items():
        if category_rules:
            print(f"\n📈 {category.replace('_', ' ').title()} ({len(category_rules)} rules):")
            for rule in category_rules[:3]:  # Top 3 per category
                conditions_str = " AND ".join(rule['conditions'][:2])  # First 2 conditions
                print(f"   • IF {conditions_str} → +{rule['performance_boost']} boost")
                if rule['examples']:
                    example = rule['examples'][0]
                    print(f"     Example: {example.get('title', 'Unknown')} ({example['multiplier']:.1f}x)")

def main():
    """Main pattern extraction pipeline"""
    print("🚀 Starting ML pattern extraction...")
    
    # Load model and data
    print("📁 Loading model and training data...")
    model, metadata, df = load_model_and_data()
    
    # Prepare for SHAP analysis
    print("⚙️ Preparing SHAP analysis...")
    X, y, df_clean = prepare_shap_analysis(model, df, metadata)
    
    if len(X) < 10:
        print("⚠️ Not enough data for pattern extraction")
        return
    
    # Generate cluster patterns
    cluster_patterns = generate_topic_cluster_patterns(model, X, df_clean)
    
    # Extract rules
    rules = extract_if_then_rules(cluster_patterns)
    
    # Categorize patterns
    categories = generate_pattern_categories(rules)
    
    # Save results
    cluster_path, rules_path = save_pattern_analysis(cluster_patterns, rules, categories)
    
    # Print summary
    print_pattern_summary(rules, categories)
    
    print(f"\n✅ Pattern extraction complete!")
    print(f"📋 Found {len(rules)} actionable patterns across {len(cluster_patterns)} topic clusters")
    
    # Success check
    if len(rules) >= 10:
        print("🎉 SUCCESS: Generated 10+ actionable rules from ML model!")
    else:
        print("⚠️ Generated fewer than 10 rules - may need more training data")

if __name__ == "__main__":
    main()