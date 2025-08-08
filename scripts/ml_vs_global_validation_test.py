#!/usr/bin/env python3

"""
ML vs Global Curve Validation Test (80/20 Approach)
Comprehensive validation comparing ML backfill vs global curve + channel normalization
"""

import json
import pandas as pd
import numpy as np
import pickle
import matplotlib.pyplot as plt
import seaborn as sns
from datetime import datetime
import warnings
warnings.filterwarnings('ignore')

class MLvsGlobalValidator:
    def __init__(self, model_timestamp="20250806_100239"):
        self.model_timestamp = model_timestamp
        self.model = None
        self.preprocessors = None
        self.metadata = None
        
    def load_ml_models(self):
        """Load trained ML backfill models"""
        print("🤖 Loading ML backfill models...")
        
        try:
            # Load model
            model_path = f'models/historical_backfill_model_{self.model_timestamp}.pkl'
            with open(model_path, 'rb') as f:
                self.model = pickle.load(f)
            
            # Load preprocessors
            preprocessing_path = f'models/historical_backfill_preprocessing_{self.model_timestamp}.pkl'
            with open(preprocessing_path, 'rb') as f:
                self.preprocessors = pickle.load(f)
            
            # Load metadata
            metadata_path = f'models/historical_backfill_metadata_{self.model_timestamp}.json'
            with open(metadata_path, 'r') as f:
                self.metadata = json.load(f)
            
            print(f"✅ Loaded ML model with {self.metadata['test_r2']:.1%} accuracy")
            return True
        except Exception as e:
            print(f"❌ Could not load ML models: {e}")
            return False
    
    def load_validation_data(self):
        """Load data and find well-tracked channels for validation"""
        print("📊 Loading validation dataset...")
        
        # Load all batches
        all_data = []
        for i in range(1, 15):
            try:
                with open(f'data/ml_training_batch_{i}.json', 'r') as f:
                    batch_data = json.load(f)
                    all_data.extend(batch_data)
            except FileNotFoundError:
                continue
        
        df = pd.DataFrame(all_data)
        
        # Convert types
        numeric_columns = ['subscriber_count', 'channel_video_count', 'view_count', 
                          'days_since_published', 'title_length', 'title_word_count']
        for col in numeric_columns:
            df[col] = pd.to_numeric(df[col], errors='coerce')
        
        # Remove invalid data
        df = df.dropna(subset=['view_count', 'days_since_published', 'video_id'])
        df = df[df['view_count'] > 0]
        
        print(f"✅ Loaded {len(df):,} snapshots from {df['channel_name'].nunique()} channels")
        
        return df
    
    def find_well_tracked_channels(self, df, min_videos=8, min_avg_snapshots=5):
        """Find channels with sufficient tracking data for validation"""
        print(f"🔍 Finding well-tracked channels (≥{min_videos} videos, ≥{min_avg_snapshots} avg snapshots)...")
        
        # Count snapshots per video per channel
        video_counts = df.groupby(['channel_name', 'video_id']).size()
        channel_stats = video_counts.groupby('channel_name').agg(['count', 'mean', 'max', 'std'])
        channel_stats.columns = ['video_count', 'avg_snapshots', 'max_snapshots', 'std_snapshots']
        
        # Find well-tracked channels
        good_channels = channel_stats[
            (channel_stats['video_count'] >= min_videos) &
            (channel_stats['avg_snapshots'] >= min_avg_snapshots) &
            (channel_stats['max_snapshots'] >= 8)  # At least one video with good tracking
        ].copy()
        
        # Add subscriber info
        for channel in good_channels.index:
            channel_data = df[df['channel_name'] == channel]
            subscribers = channel_data['subscriber_count'].iloc[0]
            good_channels.loc[channel, 'subscribers'] = subscribers
        
        # Sort by quality (video count * avg snapshots)
        good_channels['quality_score'] = good_channels['video_count'] * good_channels['avg_snapshots']
        good_channels = good_channels.sort_values('quality_score', ascending=False)
        
        print(f"🎯 Found {len(good_channels)} well-tracked channels")
        print("\nTop 10 channels for validation:")
        for channel, stats in good_channels.head(10).iterrows():
            print(f"   {channel}: {stats['video_count']:.0f} videos, {stats['avg_snapshots']:.1f} avg snapshots, {stats['subscribers']:,.0f} subs")
        
        return good_channels.head(10).index.tolist()
    
    def create_sparse_data_scenario(self, channel_data, sparsity_level=0.7):
        """Create artificially sparse data by hiding random snapshots"""
        sparse_data = []
        full_data = []
        
        for video_id in channel_data['video_id'].unique():
            video_snapshots = channel_data[channel_data['video_id'] == video_id].sort_values('days_since_published')
            
            if len(video_snapshots) >= 5:  # Need minimum snapshots for test
                # Keep random subset as "sparse" data
                n_keep = max(2, int(len(video_snapshots) * (1 - sparsity_level)))
                keep_indices = np.random.choice(len(video_snapshots), size=n_keep, replace=False)
                keep_indices = np.sort(keep_indices)  # Keep chronological order
                
                sparse_snapshots = video_snapshots.iloc[keep_indices]
                sparse_data.append(sparse_snapshots)
                full_data.append(video_snapshots)
        
        return pd.concat(sparse_data) if sparse_data else pd.DataFrame(), full_data
    
    def global_curve_approach(self, sparse_data, target_days=None):
        """Simulate global curve + channel normalization approach"""
        if target_days is None:
            target_days = list(range(1, 91))
        
        # Calculate global baseline (simplified - use median from all data)
        global_baseline = sparse_data['view_count'].median()
        
        # Global performance curve (simplified exponential growth model)
        global_curves = {}
        for day in target_days:
            # Simple growth model: views = baseline * (1 + growth_rate)^day with plateau
            growth_rate = 0.05  # 5% daily growth
            plateau_factor = min(1.0, day / 30)  # Plateau after 30 days
            global_p10 = global_baseline * 0.3 * (1 + growth_rate * plateau_factor) ** (day * 0.5)
            global_p50 = global_baseline * (1 + growth_rate * plateau_factor) ** (day * 0.7)
            global_p90 = global_baseline * 2.5 * (1 + growth_rate * plateau_factor) ** (day * 0.9)
            
            global_curves[day] = {
                'p10': global_p10,
                'p50': global_p50,
                'p90': global_p90
            }
        
        # Apply channel-specific scaling
        channel_predictions = {}
        for channel in sparse_data['channel_name'].unique():
            channel_data = sparse_data[sparse_data['channel_name'] == channel]
            channel_baseline = channel_data['view_count'].median()
            scale_factor = channel_baseline / global_baseline if global_baseline > 0 else 1.0
            
            channel_curves = {}
            for day in target_days:
                channel_curves[day] = {
                    'p10': global_curves[day]['p10'] * scale_factor,
                    'p50': global_curves[day]['p50'] * scale_factor,
                    'p90': global_curves[day]['p90'] * scale_factor
                }
            
            channel_predictions[channel] = channel_curves
        
        return channel_predictions
    
    def ml_backfill_approach(self, sparse_data, target_days=None):
        """Generate predictions using ML backfill approach"""
        if target_days is None:
            target_days = list(range(1, 91))
        
        channel_predictions = {}
        
        for channel in sparse_data['channel_name'].unique():
            channel_data = sparse_data[sparse_data['channel_name'] == channel]
            channel_baseline = channel_data['view_count'].median()
            
            # Get recent videos for this channel
            recent_videos = channel_data['video_id'].unique()[:5]  # Use up to 5 videos
            
            all_video_progressions = []
            
            for video_id in recent_videos:
                video_snapshots = channel_data[channel_data['video_id'] == video_id]
                if len(video_snapshots) > 0:
                    # Create video info for ML prediction
                    video_info = video_snapshots.iloc[0].to_dict()
                    video_info['log_channel_baseline'] = np.log1p(channel_baseline)
                    video_info['days_category'] = 'month1'
                    
                    # Determine subscriber tier
                    subs = video_info['subscriber_count']
                    if subs < 10000:
                        video_info['subscriber_tier'] = 'small'
                    elif subs < 100000:
                        video_info['subscriber_tier'] = 'small'
                    elif subs < 1000000:
                        video_info['subscriber_tier'] = 'medium'
                    elif subs < 10000000:
                        video_info['subscriber_tier'] = 'large'
                    else:
                        video_info['subscriber_tier'] = 'mega'
                    
                    # Generate ML predictions for this video
                    video_progression = self.predict_video_progression(video_info, target_days)
                    all_video_progressions.append(video_progression)
            
            # Calculate percentiles from all video progressions
            if all_video_progressions:
                combined_progression = pd.concat(all_video_progressions, ignore_index=True)
                
                channel_curves = {}
                for day in target_days:
                    day_views = combined_progression[combined_progression['days_since_published'] == day]['predicted_views']
                    if len(day_views) >= 2:
                        channel_curves[day] = {
                            'p10': np.percentile(day_views, 10),
                            'p50': np.percentile(day_views, 50),
                            'p90': np.percentile(day_views, 90)
                        }
                    else:
                        # Fallback for insufficient data
                        channel_curves[day] = {
                            'p10': channel_baseline * 0.5,
                            'p50': channel_baseline,
                            'p90': channel_baseline * 2.0
                        }
                
                channel_predictions[channel] = channel_curves
        
        return channel_predictions
    
    def predict_video_progression(self, video_info, days_to_predict):
        """Predict daily view progression using ML model"""
        if not self.model:
            return pd.DataFrame()
        
        predictions = []
        
        for day in days_to_predict:
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
                if cat_col in self.preprocessors['encoders']:
                    try:
                        encoded_val = self.preprocessors['encoders'][cat_col].transform([str(video_info.get(cat_col, 'unknown'))])[0]
                        features[f'{cat_col}_encoded'] = encoded_val
                    except:
                        features[f'{cat_col}_encoded'] = 0
            
            # Create DataFrame and scale features
            feature_df = pd.DataFrame([features])
            
            # Scale numerical features
            numerical_cols = [col for col in self.metadata['feature_columns'] if not col.endswith('_encoded')]
            if len(numerical_cols) > 0:
                feature_df[numerical_cols] = self.preprocessors['scalers']['features'].transform(feature_df[numerical_cols])
            
            # Predict (model outputs log views)
            try:
                log_views_pred = self.model.predict(feature_df[self.metadata['feature_columns']])[0]
                views_pred = np.expm1(log_views_pred)  # Convert back from log
                predictions.append({
                    'days_since_published': day,
                    'predicted_views': max(views_pred, 100)
                })
            except Exception as e:
                # Fallback prediction
                predictions.append({
                    'days_since_published': day,
                    'predicted_views': video_info.get('log_channel_baseline', 10000) * (1 + day * 0.01)
                })
        
        return pd.DataFrame(predictions)
    
    def run_validation_tests(self, df, test_channels):
        """Run all three validation tests"""
        print("\n🧪 Running validation tests...")
        
        results = {
            'test_1_coverage': {},
            'test_2_band_width': {},
            'test_3_early_prediction': {},
            'summary': {}
        }
        
        for i, channel in enumerate(test_channels):
            print(f"\n📊 Testing channel {i+1}/{len(test_channels)}: {channel}")
            
            channel_data = df[df['channel_name'] == channel]
            
            # Create sparse data scenario (hide 70% of data)
            sparse_data, full_data = self.create_sparse_data_scenario(channel_data, sparsity_level=0.7)
            
            if len(sparse_data) == 0:
                print(f"⚠️ Insufficient data for {channel}, skipping...")
                continue
            
            # Test 1: Coverage accuracy
            coverage_results = self.test_coverage_accuracy(sparse_data, full_data)
            results['test_1_coverage'][channel] = coverage_results
            
            # Test 2: Band width comparison
            bandwidth_results = self.test_band_width_comparison(sparse_data)
            results['test_2_band_width'][channel] = bandwidth_results
            
            # Test 3: Early prediction accuracy
            early_pred_results = self.test_early_prediction_accuracy(channel_data)
            results['test_3_early_prediction'][channel] = early_pred_results
        
        # Calculate summary statistics
        results['summary'] = self.calculate_summary_stats(results)
        
        return results
    
    def test_coverage_accuracy(self, sparse_data, full_data):
        """Test 1: Do actual videos fall within predicted confidence bands?"""
        # Generate predictions using both methods
        global_predictions = self.global_curve_approach(sparse_data)
        ml_predictions = self.ml_backfill_approach(sparse_data)
        
        coverage_results = {
            'global': {'p10_coverage': 0, 'p90_coverage': 0, 'total_tests': 0},
            'ml': {'p10_coverage': 0, 'p90_coverage': 0, 'total_tests': 0}
        }
        
        # Test against full data
        for video_snapshots in full_data:
            if len(video_snapshots) == 0:
                continue
                
            channel = video_snapshots['channel_name'].iloc[0]
            
            for _, snapshot in video_snapshots.iterrows():
                day = int(snapshot['days_since_published'])
                actual_views = snapshot['view_count']
                
                # Test global predictions
                if channel in global_predictions and day in global_predictions[channel]:
                    global_pred = global_predictions[channel][day]
                    coverage_results['global']['total_tests'] += 1
                    
                    if actual_views >= global_pred['p10']:
                        coverage_results['global']['p10_coverage'] += 1
                    if actual_views <= global_pred['p90']:
                        coverage_results['global']['p90_coverage'] += 1
                
                # Test ML predictions  
                if channel in ml_predictions and day in ml_predictions[channel]:
                    ml_pred = ml_predictions[channel][day]
                    coverage_results['ml']['total_tests'] += 1
                    
                    if actual_views >= ml_pred['p10']:
                        coverage_results['ml']['p10_coverage'] += 1
                    if actual_views <= ml_pred['p90']:
                        coverage_results['ml']['p90_coverage'] += 1
        
        # Calculate coverage percentages
        for method in ['global', 'ml']:
            total = coverage_results[method]['total_tests']
            if total > 0:
                coverage_results[method]['p10_pct'] = (coverage_results[method]['p10_coverage'] / total) * 100
                coverage_results[method]['p90_pct'] = (coverage_results[method]['p90_coverage'] / total) * 100
        
        return coverage_results
    
    def test_band_width_comparison(self, sparse_data):
        """Test 2: Compare confidence band widths"""
        target_days = [7, 14, 30, 60, 90]
        
        # Generate predictions
        global_predictions = self.global_curve_approach(sparse_data, target_days)
        ml_predictions = self.ml_backfill_approach(sparse_data, target_days)
        
        bandwidth_results = {
            'global_avg_width': 0,
            'ml_avg_width': 0,
            'improvement_pct': 0
        }
        
        global_widths = []
        ml_widths = []
        
        for channel in sparse_data['channel_name'].unique():
            if channel in global_predictions and channel in ml_predictions:
                for day in target_days:
                    if day in global_predictions[channel] and day in ml_predictions[channel]:
                        global_width = global_predictions[channel][day]['p90'] - global_predictions[channel][day]['p10']
                        ml_width = ml_predictions[channel][day]['p90'] - ml_predictions[channel][day]['p10']
                        
                        global_widths.append(global_width)
                        ml_widths.append(ml_width)
        
        if global_widths and ml_widths:
            bandwidth_results['global_avg_width'] = np.mean(global_widths)
            bandwidth_results['ml_avg_width'] = np.mean(ml_widths)
            bandwidth_results['improvement_pct'] = ((bandwidth_results['global_avg_width'] - bandwidth_results['ml_avg_width']) / bandwidth_results['global_avg_width']) * 100
        
        return bandwidth_results
    
    def test_early_prediction_accuracy(self, channel_data):
        """Test 3: Early prediction accuracy (day 1-30 → day 90)"""
        early_pred_results = {
            'global_error': 0,
            'ml_error': 0,
            'tests_completed': 0
        }
        
        errors_global = []
        errors_ml = []
        
        # Find videos with data at both early (≤30 days) and late (≥90 days) periods
        for video_id in channel_data['video_id'].unique():
            video_snapshots = channel_data[channel_data['video_id'] == video_id]
            
            early_data = video_snapshots[video_snapshots['days_since_published'] <= 30]
            late_data = video_snapshots[video_snapshots['days_since_published'] >= 90]
            
            if len(early_data) > 0 and len(late_data) > 0:
                # Use early data to predict late performance
                actual_late_views = late_data['view_count'].iloc[0]  # Take first late snapshot
                
                # Generate predictions using early data only
                global_pred = self.global_curve_approach(early_data, [90])
                ml_pred = self.ml_backfill_approach(early_data, [90])
                
                channel = video_snapshots['channel_name'].iloc[0]
                
                if channel in global_pred and 90 in global_pred[channel]:
                    global_predicted = global_pred[channel][90]['p50']
                    global_error = abs(global_predicted - actual_late_views) / actual_late_views * 100
                    errors_global.append(global_error)
                
                if channel in ml_pred and 90 in ml_pred[channel]:
                    ml_predicted = ml_pred[channel][90]['p50']
                    ml_error = abs(ml_predicted - actual_late_views) / actual_late_views * 100
                    errors_ml.append(ml_error)
        
        if errors_global and errors_ml:
            early_pred_results['global_error'] = np.median(errors_global)
            early_pred_results['ml_error'] = np.median(errors_ml)
            early_pred_results['tests_completed'] = min(len(errors_global), len(errors_ml))
        
        return early_pred_results
    
    def calculate_summary_stats(self, results):
        """Calculate overall summary statistics"""
        summary = {
            'test_1_summary': {'global_avg_coverage': 0, 'ml_avg_coverage': 0},
            'test_2_summary': {'avg_improvement': 0, 'channels_tested': 0},
            'test_3_summary': {'global_median_error': 0, 'ml_median_error': 0},
            'overall_winner': 'inconclusive'
        }
        
        # Test 1 summary
        coverage_scores_global = []
        coverage_scores_ml = []
        
        for channel, results_1 in results['test_1_coverage'].items():
            if 'global' in results_1 and results_1['global']['total_tests'] > 0:
                avg_coverage = (results_1['global']['p10_pct'] + results_1['global']['p90_pct']) / 2
                coverage_scores_global.append(avg_coverage)
            
            if 'ml' in results_1 and results_1['ml']['total_tests'] > 0:
                avg_coverage = (results_1['ml']['p10_pct'] + results_1['ml']['p90_pct']) / 2
                coverage_scores_ml.append(avg_coverage)
        
        if coverage_scores_global:
            summary['test_1_summary']['global_avg_coverage'] = np.mean(coverage_scores_global)
        if coverage_scores_ml:
            summary['test_1_summary']['ml_avg_coverage'] = np.mean(coverage_scores_ml)
        
        # Test 2 summary
        improvements = [results_2['improvement_pct'] for results_2 in results['test_2_band_width'].values() 
                       if 'improvement_pct' in results_2]
        if improvements:
            summary['test_2_summary']['avg_improvement'] = np.mean(improvements)
            summary['test_2_summary']['channels_tested'] = len(improvements)
        
        # Test 3 summary
        global_errors = [results_3['global_error'] for results_3 in results['test_3_early_prediction'].values()
                        if 'global_error' in results_3 and results_3['global_error'] > 0]
        ml_errors = [results_3['ml_error'] for results_3 in results['test_3_early_prediction'].values()
                    if 'ml_error' in results_3 and results_3['ml_error'] > 0]
        
        if global_errors:
            summary['test_3_summary']['global_median_error'] = np.median(global_errors)
        if ml_errors:
            summary['test_3_summary']['ml_median_error'] = np.median(ml_errors)
        
        # Determine overall winner
        ml_wins = 0
        total_tests = 0
        
        # Coverage test (higher is better)
        if summary['test_1_summary']['ml_avg_coverage'] > summary['test_1_summary']['global_avg_coverage']:
            ml_wins += 1
        total_tests += 1
        
        # Band width test (positive improvement is ML win)
        if summary['test_2_summary']['avg_improvement'] > 0:
            ml_wins += 1
        total_tests += 1
        
        # Early prediction test (lower error is better)
        if (summary['test_3_summary']['ml_median_error'] > 0 and 
            summary['test_3_summary']['global_median_error'] > 0 and
            summary['test_3_summary']['ml_median_error'] < summary['test_3_summary']['global_median_error']):
            ml_wins += 1
        total_tests += 1
        
        if ml_wins > total_tests / 2:
            summary['overall_winner'] = 'ML'
        elif ml_wins < total_tests / 2:
            summary['overall_winner'] = 'Global'
        else:
            summary['overall_winner'] = 'Tie'
        
        return summary
    
    def create_validation_report(self, results):
        """Generate comprehensive validation report"""
        print("\n" + "="*80)
        print("🏆 ML vs GLOBAL CURVE VALIDATION RESULTS")
        print("="*80)
        
        # Test 1: Coverage Accuracy
        print(f"\n📊 TEST 1: COVERAGE ACCURACY")
        print(f"   (Do actual videos fall within predicted confidence bands?)")
        
        summary_1 = results['summary']['test_1_summary']
        print(f"   Global Method Average Coverage: {summary_1['global_avg_coverage']:.1f}%")
        print(f"   ML Method Average Coverage: {summary_1['ml_avg_coverage']:.1f}%")
        
        if summary_1['ml_avg_coverage'] > summary_1['global_avg_coverage']:
            print(f"   ✅ ML WINS: {summary_1['ml_avg_coverage'] - summary_1['global_avg_coverage']:+.1f}% better coverage")
        else:
            print(f"   ❌ Global wins: {summary_1['global_avg_coverage'] - summary_1['ml_avg_coverage']:+.1f}% better coverage")
        
        # Test 2: Band Width Comparison
        print(f"\n📏 TEST 2: CONFIDENCE BAND WIDTH")
        print(f"   (Tighter bands with same accuracy = better)")
        
        summary_2 = results['summary']['test_2_summary']
        print(f"   Average Band Width Improvement: {summary_2['avg_improvement']:+.1f}%")
        print(f"   Channels Tested: {summary_2['channels_tested']}")
        
        if summary_2['avg_improvement'] > 0:
            print(f"   ✅ ML WINS: {summary_2['avg_improvement']:.1f}% tighter bands")
        else:
            print(f"   ❌ Global wins: {-summary_2['avg_improvement']:.1f}% tighter bands")
        
        # Test 3: Early Prediction Accuracy
        print(f"\n🔮 TEST 3: EARLY PREDICTION ACCURACY")
        print(f"   (Day 1-30 data predicting day 90+ performance)")
        
        summary_3 = results['summary']['test_3_summary']
        print(f"   Global Method Median Error: {summary_3['global_median_error']:.1f}%")
        print(f"   ML Method Median Error: {summary_3['ml_median_error']:.1f}%")
        
        if summary_3['ml_median_error'] < summary_3['global_median_error'] and summary_3['ml_median_error'] > 0:
            improvement = ((summary_3['global_median_error'] - summary_3['ml_median_error']) / summary_3['global_median_error']) * 100
            print(f"   ✅ ML WINS: {improvement:.1f}% lower prediction error")
        elif summary_3['global_median_error'] > 0:
            decline = ((summary_3['ml_median_error'] - summary_3['global_median_error']) / summary_3['global_median_error']) * 100
            print(f"   ❌ Global wins: {decline:.1f}% lower prediction error")
        
        # Overall Winner
        print(f"\n🏆 OVERALL WINNER: {results['summary']['overall_winner']}")
        
        # Detailed channel results
        print(f"\n📋 DETAILED RESULTS BY CHANNEL:")
        for channel in results['test_1_coverage'].keys():
            print(f"\n   {channel}:")
            
            # Coverage results
            if channel in results['test_1_coverage']:
                cov = results['test_1_coverage'][channel]
                if 'global' in cov and cov['global']['total_tests'] > 0:
                    print(f"     Coverage - Global: {(cov['global']['p10_pct'] + cov['global']['p90_pct'])/2:.1f}%")
                if 'ml' in cov and cov['ml']['total_tests'] > 0:
                    print(f"     Coverage - ML: {(cov['ml']['p10_pct'] + cov['ml']['p90_pct'])/2:.1f}%")
            
            # Band width results
            if channel in results['test_2_band_width']:
                bw = results['test_2_band_width'][channel]
                if 'improvement_pct' in bw:
                    print(f"     Band Width Improvement: {bw['improvement_pct']:+.1f}%")
            
            # Early prediction results
            if channel in results['test_3_early_prediction']:
                ep = results['test_3_early_prediction'][channel]
                if ep['tests_completed'] > 0:
                    print(f"     Early Pred - Global Error: {ep['global_error']:.1f}%")
                    print(f"     Early Pred - ML Error: {ep['ml_error']:.1f}%")
        
        print("\n" + "="*80)
        
        return results

def main():
    print("🚀 ML vs Global Curve Validation Test (80/20 Approach)")
    print("=" * 60)
    
    validator = MLvsGlobalValidator()
    
    # Load ML models
    if not validator.load_ml_models():
        print("❌ Cannot proceed without ML models")
        return
    
    # Load validation data
    df = validator.load_validation_data()
    
    # Find well-tracked channels
    test_channels = validator.find_well_tracked_channels(df, min_videos=6, min_avg_snapshots=4)
    
    if len(test_channels) < 5:
        print(f"⚠️ Only found {len(test_channels)} suitable channels, need at least 5 for reliable validation")
        return
    
    print(f"\n🎯 Running validation on {len(test_channels)} channels...")
    
    # Run validation tests
    results = validator.run_validation_tests(df, test_channels)
    
    # Generate comprehensive report
    final_results = validator.create_validation_report(results)
    
    # Save results
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    results_path = f'data/ml_vs_global_validation_{timestamp}.json'
    with open(results_path, 'w') as f:
        json.dump(final_results, f, indent=2)
    
    print(f"\n💾 Detailed results saved: {results_path}")
    print("🎉 Validation complete!")

if __name__ == "__main__":
    main()