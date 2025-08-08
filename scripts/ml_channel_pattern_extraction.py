#!/usr/bin/env python3
"""
ML Performance Prediction - Channel-Level Pattern Extraction
Generate actionable creator insights based on channel size + content decisions (non-circular)
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
import psycopg2
from psycopg2.extras import RealDictCursor

def load_model_and_metadata():
    """Load the trained model and metadata"""
    
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
    
    print(f"📊 Loaded model with {len(metadata['features'])} features")
    
    return model, metadata

def extract_channel_data():
    """Extract rich channel and content data from videos table"""
    
    print("🗄️ Loading sample channel data for testing...")
    
    # Load sample data we extracted from the query
    with open('data/sample_channel_data.json', 'r') as f:
        sample_data = json.load(f)
    
    df = pd.DataFrame(sample_data)
    
    print(f"📊 Loaded {len(df)} sample videos for testing")
    
    return df

def extract_channel_features(df):
    """Extract actionable channel-level features (non-performance based)"""
    
    print("⚙️ Extracting channel-level features...")
    
    features_list = []
    
    for _, row in df.iterrows():
        try:
            metadata = row['metadata']
            if not isinstance(metadata, dict):
                continue
                
            channel_stats = metadata.get('channel_stats', {})
            if not channel_stats:
                continue
            
            # Channel size features (non-circular)
            subscriber_count = int(channel_stats.get('subscriber_count', 0))
            video_count = int(channel_stats.get('video_count', 0))
            
            # Channel tier (based on subscriber count)
            if subscriber_count < 1000:
                channel_tier = 'micro'  # <1K
            elif subscriber_count < 10000:
                channel_tier = 'small'  # 1K-10K
            elif subscriber_count < 100000:
                channel_tier = 'medium'  # 10K-100K
            elif subscriber_count < 1000000:
                channel_tier = 'large'  # 100K-1M
            else:
                channel_tier = 'mega'   # 1M+
            
            # Content features (actionable decisions)
            title_word_count = len(str(row['title']).split())
            title_has_question = '?' in str(row['title'])
            title_has_numbers = any(char.isdigit() for char in str(row['title']))
            title_has_caps = str(row['title']).isupper()
            
            # Timing features (actionable decisions)
            published_dt = pd.to_datetime(row['published_at'])
            day_of_week = published_dt.dayofweek  # 0=Monday
            hour_of_day = published_dt.hour
            is_weekend = day_of_week >= 5
            
            # Duration features
            duration_str = metadata.get('duration', 'PT0S')
            duration_seconds = parse_duration(duration_str)
            
            if duration_seconds < 300:  # 5 min
                duration_category = 'short'
            elif duration_seconds < 600:  # 10 min
                duration_category = 'medium'
            elif duration_seconds < 1200:  # 20 min
                duration_category = 'long'
            else:
                duration_category = 'very_long'
            
            # Tag features (actionable decisions)
            tags = metadata.get('tags', [])
            tag_count = len(tags)
            has_brand_tags = any('diy' in tag.lower() or 'tutorial' in tag.lower() 
                               or 'review' in tag.lower() for tag in tags)
            
            # Target variable (what we want to predict)
            performance_ratio = float(row['performance_ratio']) if row['performance_ratio'] else 1.0
            log_performance_ratio = np.log(max(0.1, performance_ratio))  # Avoid log(0)
            
            features = {
                'video_id': row['id'],
                'channel_id': row['channel_id'],
                'channel_name': row['channel_name'],
                
                # Channel features (non-circular)
                'subscriber_count': subscriber_count,
                'channel_video_count': video_count,
                'channel_tier': channel_tier,
                
                # Content features (actionable)
                'topic_cluster_id': int(row['topic_cluster_id']) if row['topic_cluster_id'] else -1,
                'topic_domain': str(row['topic_domain']) if row['topic_domain'] else 'unknown',
                'format_type': str(row['format_type']) if row['format_type'] else 'unknown',
                'title_word_count': title_word_count,
                'title_has_question': title_has_question,
                'title_has_numbers': title_has_numbers,
                'title_has_caps': title_has_caps,
                'duration_category': duration_category,
                'duration_seconds': duration_seconds,
                'tag_count': tag_count,
                'has_brand_tags': has_brand_tags,
                
                # Timing features (actionable)
                'day_of_week': day_of_week,
                'hour_of_day': hour_of_day,
                'is_weekend': is_weekend,
                
                # Target
                'performance_ratio': performance_ratio,
                'log_performance_ratio': log_performance_ratio
            }
            
            features_list.append(features)
            
        except Exception as e:
            print(f"⚠️ Error processing row: {e}")
            continue
    
    features_df = pd.DataFrame(features_list)
    print(f"✅ Extracted features for {len(features_df)} videos")
    
    return features_df

def parse_duration(duration_str):
    """Parse YouTube duration format PT4M13S to seconds"""
    try:
        if not duration_str or duration_str == 'PT0S':
            return 0
        
        # Remove PT prefix
        duration_str = duration_str.replace('PT', '')
        
        seconds = 0
        
        # Extract hours
        if 'H' in duration_str:
            hours = int(duration_str.split('H')[0])
            seconds += hours * 3600
            duration_str = duration_str.split('H')[1]
        
        # Extract minutes
        if 'M' in duration_str:
            minutes = int(duration_str.split('M')[0])
            seconds += minutes * 60
            duration_str = duration_str.split('M')[1]
        
        # Extract seconds
        if 'S' in duration_str:
            seconds += int(duration_str.replace('S', ''))
        
        return seconds
    
    except:
        return 0

def analyze_channel_tier_patterns(df):
    """Analyze patterns by channel tier"""
    
    print("📊 Analyzing channel tier patterns...")
    
    patterns = {}
    
    for tier in df['channel_tier'].unique():
        tier_df = df[df['channel_tier'] == tier].copy()
        
        if len(tier_df) < 10:  # Skip tiers with too few examples
            continue
        
        tier_patterns = {
            'tier': tier,
            'video_count': len(tier_df),
            'avg_performance': float(tier_df['performance_ratio'].mean()),
            'subscriber_range': {
                'min': int(tier_df['subscriber_count'].min()),
                'max': int(tier_df['subscriber_count'].max()),
                'median': int(tier_df['subscriber_count'].median())
            }
        }
        
        # Format analysis
        format_performance = tier_df.groupby('format_type').agg({
            'performance_ratio': ['mean', 'count']
        }).round(2)
        
        format_results = []
        for format_type in format_performance.index:
            if format_performance.loc[format_type, ('performance_ratio', 'count')] >= 5:
                avg_perf = format_performance.loc[format_type, ('performance_ratio', 'mean')]
                count = format_performance.loc[format_type, ('performance_ratio', 'count')]
                boost = ((avg_perf / tier_patterns['avg_performance']) - 1) * 100
                
                format_results.append({
                    'format': format_type,
                    'avg_performance': float(avg_perf),
                    'boost_vs_tier_avg': f"{boost:+.1f}%",
                    'video_count': int(count)
                })
        
        tier_patterns['format_analysis'] = sorted(format_results, 
                                                key=lambda x: x['avg_performance'], reverse=True)
        
        # Timing analysis
        timing_performance = tier_df.groupby(['day_of_week', 'hour_of_day']).agg({
            'performance_ratio': ['mean', 'count']
        })
        
        # Find best timing slots (minimum 3 videos)
        best_timings = []
        for (day, hour), perf_data in timing_performance.iterrows():
            if perf_data[('performance_ratio', 'count')] >= 3:
                avg_perf = perf_data[('performance_ratio', 'mean')]
                count = perf_data[('performance_ratio', 'count')]
                boost = ((avg_perf / tier_patterns['avg_performance']) - 1) * 100
                
                day_names = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
                
                best_timings.append({
                    'day': day_names[day],
                    'hour': hour,
                    'avg_performance': float(avg_perf),
                    'boost_vs_tier_avg': f"{boost:+.1f}%",
                    'video_count': int(count)
                })
        
        tier_patterns['timing_analysis'] = sorted(best_timings[:10], 
                                                key=lambda x: x['avg_performance'], reverse=True)
        
        # Title analysis
        title_patterns = []
        
        # Short vs long titles
        short_titles = tier_df[tier_df['title_word_count'] <= 6]
        long_titles = tier_df[tier_df['title_word_count'] > 6]
        
        if len(short_titles) >= 5 and len(long_titles) >= 5:
            short_perf = short_titles['performance_ratio'].mean()
            long_perf = long_titles['performance_ratio'].mean()
            
            title_patterns.append({
                'pattern': 'Short titles (≤6 words)',
                'avg_performance': float(short_perf),
                'boost_vs_tier_avg': f"{((short_perf / tier_patterns['avg_performance']) - 1) * 100:+.1f}%",
                'video_count': len(short_titles)
            })
            
            title_patterns.append({
                'pattern': 'Long titles (>6 words)',
                'avg_performance': float(long_perf),
                'boost_vs_tier_avg': f"{((long_perf / tier_patterns['avg_performance']) - 1) * 100:+.1f}%",
                'video_count': len(long_titles)
            })
        
        # Question titles
        question_titles = tier_df[tier_df['title_has_question'] == True]
        if len(question_titles) >= 5:
            q_perf = question_titles['performance_ratio'].mean()
            title_patterns.append({
                'pattern': 'Question titles (?)',
                'avg_performance': float(q_perf),
                'boost_vs_tier_avg': f"{((q_perf / tier_patterns['avg_performance']) - 1) * 100:+.1f}%",
                'video_count': len(question_titles)
            })
        
        tier_patterns['title_analysis'] = sorted(title_patterns, 
                                               key=lambda x: x['avg_performance'], reverse=True)
        
        patterns[tier] = tier_patterns
    
    return patterns

def generate_actionable_rules(patterns):
    """Generate actionable if-then rules from channel patterns"""
    
    print("📝 Generating actionable rules...")
    
    rules = []
    rule_id = 1
    
    for tier, tier_data in patterns.items():
        tier_avg = tier_data['avg_performance']
        subscriber_range = tier_data['subscriber_range']
        
        # Format rules
        for format_data in tier_data['format_analysis'][:3]:  # Top 3 formats
            if format_data['avg_performance'] > tier_avg * 1.2:  # 20% boost
                
                rule = {
                    'rule_id': rule_id,
                    'category': 'format_optimization',
                    'channel_tier': tier,
                    'subscriber_range': f"{subscriber_range['min']:,} - {subscriber_range['max']:,}",
                    'condition': f"Channel size: {tier.title()} ({subscriber_range['min']:,}-{subscriber_range['max']:,} subs) + Format: {format_data['format'].title()}",
                    'expected_boost': format_data['boost_vs_tier_avg'],
                    'avg_performance': format_data['avg_performance'],
                    'evidence_count': format_data['video_count'],
                    'confidence': min(0.9, 0.5 + (format_data['video_count'] / 20))  # More videos = higher confidence
                }
                
                rules.append(rule)
                rule_id += 1
        
        # Timing rules
        for timing_data in tier_data['timing_analysis'][:2]:  # Top 2 timings
            if timing_data['avg_performance'] > tier_avg * 1.15:  # 15% boost
                
                rule = {
                    'rule_id': rule_id,
                    'category': 'timing_optimization',
                    'channel_tier': tier,
                    'subscriber_range': f"{subscriber_range['min']:,} - {subscriber_range['max']:,}",
                    'condition': f"Channel size: {tier.title()} + Publish: {timing_data['day']} at {timing_data['hour']:02d}:00",
                    'expected_boost': timing_data['boost_vs_tier_avg'],
                    'avg_performance': timing_data['avg_performance'],
                    'evidence_count': timing_data['video_count'],
                    'confidence': min(0.8, 0.4 + (timing_data['video_count'] / 15))
                }
                
                rules.append(rule)
                rule_id += 1
        
        # Title rules
        for title_data in tier_data['title_analysis'][:2]:  # Top 2 title patterns
            if title_data['avg_performance'] > tier_avg * 1.1:  # 10% boost
                
                rule = {
                    'rule_id': rule_id,
                    'category': 'title_optimization',
                    'channel_tier': tier,
                    'subscriber_range': f"{subscriber_range['min']:,} - {subscriber_range['max']:,}",
                    'condition': f"Channel size: {tier.title()} + {title_data['pattern']}",
                    'expected_boost': title_data['boost_vs_tier_avg'],
                    'avg_performance': title_data['avg_performance'],
                    'evidence_count': title_data['video_count'],
                    'confidence': min(0.8, 0.4 + (title_data['video_count'] / 20))
                }
                
                rules.append(rule)
                rule_id += 1
    
    # Sort by expected performance
    rules.sort(key=lambda x: x['avg_performance'], reverse=True)
    
    print(f"📋 Generated {len(rules)} actionable rules")
    return rules

def save_channel_analysis(patterns, rules):
    """Save channel-level analysis results"""
    
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    
    # Save detailed patterns
    patterns_path = f"data/ml_channel_patterns_{timestamp}.json"
    with open(patterns_path, 'w') as f:
        json.dump(patterns, f, indent=2)
    
    # Save actionable rules
    rules_path = f"data/ml_channel_rules_{timestamp}.json"
    rules_data = {
        'generated_at': timestamp,
        'total_rules': len(rules),
        'methodology': 'channel_tier_analysis',
        'non_circular': True,
        'rules': rules
    }
    
    with open(rules_path, 'w') as f:
        json.dump(rules_data, f, indent=2)
    
    print(f"💾 Saved channel patterns: {patterns_path}")
    print(f"💾 Saved actionable rules: {rules_path}")
    
    return patterns_path, rules_path

def print_rule_summary(rules):
    """Print summary of top actionable rules"""
    
    print("\n🎯 Top Actionable Rules for Creators:")
    
    categories = {}
    for rule in rules:
        category = rule['category']
        if category not in categories:
            categories[category] = []
        categories[category].append(rule)
    
    for category, category_rules in categories.items():
        print(f"\n📈 {category.replace('_', ' ').title()} ({len(category_rules)} rules):")
        
        for rule in category_rules[:3]:  # Top 3 per category
            print(f"   • {rule['condition']}")
            print(f"     Expected boost: {rule['expected_boost']} (based on {rule['evidence_count']} videos)")
            print(f"     Confidence: {rule['confidence']:.1%}")

def main():
    """Main channel-level pattern extraction pipeline"""
    print("🚀 Starting channel-level pattern extraction...")
    
    # Load model (for context, but we're not using it for circular predictions)
    print("📁 Loading model metadata...")
    model, metadata = load_model_and_metadata()
    
    # Extract channel data
    df = extract_channel_data()
    
    if len(df) < 100:
        print("⚠️ Not enough data for reliable channel analysis")
        return
    
    # Extract non-circular features
    print("⚙️ Processing channel features...")
    features_df = extract_channel_features(df)
    
    if len(features_df) < 50:
        print("⚠️ Not enough valid feature data")
        return
    
    # Analyze patterns by channel tier
    patterns = analyze_channel_tier_patterns(features_df)
    
    # Generate actionable rules
    rules = generate_actionable_rules(patterns)
    
    # Save results
    patterns_path, rules_path = save_channel_analysis(patterns, rules)
    
    # Print summary
    print_rule_summary(rules)
    
    print(f"\n✅ Channel-level pattern extraction complete!")
    print(f"📊 Analyzed {len(features_df)} videos across {len(patterns)} channel tiers")
    print(f"📋 Generated {len(rules)} non-circular actionable rules")
    
    # Success check
    if len(rules) >= 5:
        print("🎉 SUCCESS: Generated actionable creator insights!")
    else:
        print("⚠️ Limited actionable insights - may need more data")

if __name__ == "__main__":
    main()