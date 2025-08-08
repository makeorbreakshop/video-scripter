#!/usr/bin/env python3

"""
ML Performance Envelope Comparison Test
Compares ML-predicted confidence bands vs current global curve scaling approach
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

class EnvelopeComparisonTester:
    def __init__(self, model_timestamp="20250806_093621"):
        self.model_timestamp = model_timestamp
        self.models = {}
        self.encoders = {}
        self.metadata = {}
        
    def load_ml_models(self):
        """Load trained ML envelope models"""
        print("🤖 Loading ML envelope models...")
        
        # Load models
        model_names = ['p10', 'p50', 'p90']
        for name in model_names:
            model_path = f'models/envelope_model_{name}_{self.model_timestamp}.pkl'
            with open(model_path, 'rb') as f:
                self.models[name] = pickle.load(f)
        
        # Load encoders
        encoders_path = f'models/envelope_encoders_{self.model_timestamp}.pkl'
        with open(encoders_path, 'rb') as f:
            self.encoders = pickle.load(f)
        
        # Load metadata
        metadata_path = f'models/envelope_training_metadata_{self.model_timestamp}.json'
        with open(metadata_path, 'r') as f:
            self.metadata = json.load(f)
        
        print(f"✅ Loaded {len(self.models)} ML models with {len(self.metadata['feature_columns'])} features")
        
    def load_test_predictions(self):
        """Load existing test predictions for validation"""
        pred_path = f'data/envelope_test_predictions_{self.model_timestamp}.csv'
        df = pd.read_csv(pred_path)
        
        print(f"📊 Loaded {len(df)} test predictions")
        return df
        
    def simulate_current_approach(self, test_df):
        """Simulate your current global curve scaling approach"""
        print("📈 Simulating current global curve scaling approach...")
        
        # Global performance envelope (simplified - you'd use your actual curves)
        # Using median values from test data as "global baseline"
        global_p10 = test_df['actual_p10'].median()
        global_p50 = test_df['actual_p50'].median() 
        global_p90 = test_df['actual_p90'].median()
        
        print(f"📊 Global envelope: p10={global_p10:,.0f}, p50={global_p50:,.0f}, p90={global_p90:,.0f}")
        
        # Simulate sparse channel data (only 2-3 videos per channel)
        # For each channel, calculate scaling factor from limited data
        current_predictions = []
        
        for _, row in test_df.iterrows():
            # Simulate having only sparse data for baseline calculation
            # Use ±20% noise to simulate real sparse data uncertainty
            sparse_baseline_noise = np.random.normal(1.0, 0.2)
            channel_baseline_estimate = row['actual_p50'] * sparse_baseline_noise
            
            # Calculate scaling factor (your current approach)
            scale_factor = channel_baseline_estimate / global_p50
            
            # Apply global envelope scaled to channel
            current_p10 = global_p10 * scale_factor
            current_p50 = global_p50 * scale_factor  
            current_p90 = global_p90 * scale_factor
            
            current_predictions.append({
                'video_id': row['video_id'],
                'channel_name': row['channel_name'],
                'current_p10': current_p10,
                'current_p50': current_p50,
                'current_p90': current_p90,
                'scale_factor': scale_factor,
                'baseline_noise': sparse_baseline_noise
            })
        
        return pd.DataFrame(current_predictions)
    
    def calculate_comparison_metrics(self, test_df, current_df):
        """Calculate accuracy metrics for both approaches"""
        print("📊 Calculating comparison metrics...")
        
        # Merge dataframes
        comparison_df = test_df.merge(current_df, on=['video_id', 'channel_name'])
        
        # Calculate errors for ML approach
        ml_p10_error = np.abs(comparison_df['p10_pred'] - comparison_df['actual_p10'])
        ml_p50_error = np.abs(comparison_df['p50_pred'] - comparison_df['actual_p50'])
        ml_p90_error = np.abs(comparison_df['p90_pred'] - comparison_df['actual_p90'])
        
        # Calculate errors for current approach
        current_p10_error = np.abs(comparison_df['current_p10'] - comparison_df['actual_p10'])
        current_p50_error = np.abs(comparison_df['current_p50'] - comparison_df['actual_p50'])
        current_p90_error = np.abs(comparison_df['current_p90'] - comparison_df['actual_p90'])
        
        # Calculate percentage errors
        ml_p50_pct_error = (ml_p50_error / comparison_df['actual_p50']) * 100
        current_p50_pct_error = (current_p50_error / comparison_df['actual_p50']) * 100
        
        metrics = {
            'ml_approach': {
                'p10_mae': ml_p10_error.mean(),
                'p50_mae': ml_p50_error.mean(),
                'p90_mae': ml_p90_error.mean(),
                'p50_median_pct_error': ml_p50_pct_error.median(),
                'p50_mean_pct_error': ml_p50_pct_error.mean()
            },
            'current_approach': {
                'p10_mae': current_p10_error.mean(),
                'p50_mae': current_p50_error.mean(),
                'p90_mae': current_p90_error.mean(),
                'p50_median_pct_error': current_p50_pct_error.median(),
                'p50_mean_pct_error': current_p50_pct_error.mean()
            }
        }
        
        # Calculate improvement
        p50_improvement = (current_p50_error.mean() - ml_p50_error.mean()) / current_p50_error.mean() * 100
        metrics['ml_improvement_pct'] = p50_improvement
        
        return metrics, comparison_df
    
    def create_comparison_visualizations(self, comparison_df, metrics):
        """Create visualization comparing both approaches"""
        print("📊 Creating comparison visualizations...")
        
        fig, axes = plt.subplots(2, 2, figsize=(15, 12))
        
        # 1. Prediction Accuracy Scatter Plot
        ax1 = axes[0, 0]
        ax1.scatter(comparison_df['actual_p50'], comparison_df['p50_pred'], 
                   alpha=0.6, label='ML Predictions', color='blue', s=20)
        ax1.scatter(comparison_df['actual_p50'], comparison_df['current_p50'], 
                   alpha=0.6, label='Current Method', color='red', s=20)
        
        # Perfect prediction line
        min_val = min(comparison_df['actual_p50'].min(), 
                     comparison_df['p50_pred'].min(), 
                     comparison_df['current_p50'].min())
        max_val = max(comparison_df['actual_p50'].max(), 
                     comparison_df['p50_pred'].max(), 
                     comparison_df['current_p50'].max())
        ax1.plot([min_val, max_val], [min_val, max_val], 'k--', alpha=0.5, label='Perfect Prediction')
        
        ax1.set_xlabel('Actual P50 Views')
        ax1.set_ylabel('Predicted P50 Views')
        ax1.set_title('Prediction Accuracy Comparison')
        ax1.legend()
        ax1.set_xscale('log')
        ax1.set_yscale('log')
        
        # 2. Error Distribution
        ax2 = axes[0, 1]
        ml_p50_error = np.abs(comparison_df['p50_pred'] - comparison_df['actual_p50'])
        current_p50_error = np.abs(comparison_df['current_p50'] - comparison_df['actual_p50'])
        
        ax2.hist(ml_p50_error, bins=30, alpha=0.7, label='ML Error', color='blue', density=True)
        ax2.hist(current_p50_error, bins=30, alpha=0.7, label='Current Error', color='red', density=True)
        ax2.set_xlabel('Absolute Error')
        ax2.set_ylabel('Density')
        ax2.set_title('Error Distribution Comparison')
        ax2.legend()
        ax2.set_xscale('log')
        
        # 3. Performance by Channel Size
        ax3 = axes[1, 0]
        # Bin by actual p50 performance (proxy for channel size)
        comparison_df['performance_bin'] = pd.qcut(comparison_df['actual_p50'], 
                                                 q=5, labels=['Very Low', 'Low', 'Medium', 'High', 'Very High'])
        
        # Add error columns to dataframe for grouping
        comparison_df['ml_p50_error'] = ml_p50_error
        comparison_df['current_p50_error'] = current_p50_error
        
        ml_error_by_bin = comparison_df.groupby('performance_bin')['ml_p50_error'].mean()
        current_error_by_bin = comparison_df.groupby('performance_bin')['current_p50_error'].mean()
        
        x_pos = np.arange(len(ml_error_by_bin))
        ax3.bar(x_pos - 0.2, ml_error_by_bin, 0.4, label='ML Approach', color='blue', alpha=0.7)
        ax3.bar(x_pos + 0.2, current_error_by_bin, 0.4, label='Current Approach', color='red', alpha=0.7)
        
        ax3.set_xlabel('Performance Tier')
        ax3.set_ylabel('Mean Absolute Error')
        ax3.set_title('Error by Performance Tier')
        ax3.set_xticks(x_pos)
        ax3.set_xticklabels(ml_error_by_bin.index)
        ax3.legend()
        
        # 4. Confidence Band Width Comparison
        ax4 = axes[1, 1]
        ml_width = comparison_df['p90_pred'] - comparison_df['p10_pred']
        current_width = comparison_df['current_p90'] - comparison_df['current_p10']
        actual_width = comparison_df['actual_p90'] - comparison_df['actual_p10']
        
        ax4.scatter(actual_width, ml_width, alpha=0.6, label='ML Band Width', color='blue', s=20)
        ax4.scatter(actual_width, current_width, alpha=0.6, label='Current Band Width', color='red', s=20)
        ax4.plot([actual_width.min(), actual_width.max()], 
                [actual_width.min(), actual_width.max()], 'k--', alpha=0.5, label='Perfect Width')
        
        ax4.set_xlabel('Actual Confidence Band Width')
        ax4.set_ylabel('Predicted Confidence Band Width') 
        ax4.set_title('Confidence Band Width Accuracy')
        ax4.legend()
        ax4.set_xscale('log')
        ax4.set_yscale('log')
        
        plt.tight_layout()
        plt.savefig(f'data/envelope_comparison_analysis_{self.model_timestamp}.png', dpi=300, bbox_inches='tight')
        print(f"💾 Saved visualization: data/envelope_comparison_analysis_{self.model_timestamp}.png")
        
        return fig
    
    def generate_test_cases(self, comparison_df):
        """Generate specific test cases for validation"""
        print("🧪 Generating test cases...")
        
        # Find interesting cases
        test_cases = []
        
        # Case 1: Best ML predictions
        ml_p50_error = np.abs(comparison_df['p50_pred'] - comparison_df['actual_p50']) 
        current_p50_error = np.abs(comparison_df['current_p50'] - comparison_df['actual_p50'])
        
        ml_better_idx = (ml_p50_error < current_p50_error).idxmax()
        best_ml_case = comparison_df.iloc[ml_better_idx]
        
        test_cases.append({
            'case_type': 'Best ML Performance',
            'channel_name': best_ml_case['channel_name'],
            'actual_p50': best_ml_case['actual_p50'],
            'ml_pred_p50': best_ml_case['p50_pred'],
            'current_pred_p50': best_ml_case['current_p50'],
            'ml_error': ml_p50_error.iloc[ml_better_idx],
            'current_error': current_p50_error.iloc[ml_better_idx],
            'improvement': ((current_p50_error.iloc[ml_better_idx] - ml_p50_error.iloc[ml_better_idx]) / 
                          current_p50_error.iloc[ml_better_idx] * 100)
        })
        
        # Case 2: Largest improvement
        improvement_pct = ((current_p50_error - ml_p50_error) / current_p50_error) * 100
        best_improvement_idx = improvement_pct.idxmax()
        best_improvement_case = comparison_df.iloc[best_improvement_idx]
        
        test_cases.append({
            'case_type': 'Largest ML Improvement',
            'channel_name': best_improvement_case['channel_name'],
            'actual_p50': best_improvement_case['actual_p50'],
            'ml_pred_p50': best_improvement_case['p50_pred'],
            'current_pred_p50': best_improvement_case['current_p50'],
            'ml_error': ml_p50_error.iloc[best_improvement_idx],
            'current_error': current_p50_error.iloc[best_improvement_idx],
            'improvement': improvement_pct.iloc[best_improvement_idx]
        })
        
        return test_cases

def main():
    print("🚀 ML Performance Envelope Comparison Test")
    print("="*60)
    
    tester = EnvelopeComparisonTester()
    
    # Load ML models and test data
    tester.load_ml_models()
    test_df = tester.load_test_predictions()
    
    # Simulate current approach
    current_df = tester.simulate_current_approach(test_df)
    
    # Calculate comparison metrics
    metrics, comparison_df = tester.calculate_comparison_metrics(test_df, current_df)
    
    # Create visualizations
    fig = tester.create_comparison_visualizations(comparison_df, metrics)
    
    # Generate test cases
    test_cases = tester.generate_test_cases(comparison_df)
    
    # Print results
    print("\n" + "="*60)
    print("📊 COMPARISON RESULTS")
    print("="*60)
    
    print(f"\n🤖 ML APPROACH:")
    print(f"   P50 MAE: {metrics['ml_approach']['p50_mae']:,.0f} views")
    print(f"   P50 Median % Error: {metrics['ml_approach']['p50_median_pct_error']:.1f}%")
    print(f"   P50 Mean % Error: {metrics['ml_approach']['p50_mean_pct_error']:.1f}%")
    
    print(f"\n📈 CURRENT APPROACH:")
    print(f"   P50 MAE: {metrics['current_approach']['p50_mae']:,.0f} views")
    print(f"   P50 Median % Error: {metrics['current_approach']['p50_median_pct_error']:.1f}%")
    print(f"   P50 Mean % Error: {metrics['current_approach']['p50_mean_pct_error']:.1f}%")
    
    print(f"\n🎯 ML IMPROVEMENT:")
    print(f"   P50 Prediction Improvement: {metrics['ml_improvement_pct']:+.1f}%")
    
    print(f"\n🧪 INTERESTING TEST CASES:")
    for case in test_cases:
        print(f"\n   {case['case_type']}: {case['channel_name']}")
        print(f"     Actual: {case['actual_p50']:,.0f} views")  
        print(f"     ML Pred: {case['ml_pred_p50']:,.0f} views (error: {case['ml_error']:,.0f})")
        print(f"     Current: {case['current_pred_p50']:,.0f} views (error: {case['current_error']:,.0f})")
        print(f"     ML Improvement: {case['improvement']:+.1f}%")
    
    # Save results
    results = {
        'test_date': datetime.now().isoformat(),
        'model_timestamp': tester.model_timestamp,
        'metrics': metrics,
        'test_cases': test_cases,
        'sample_size': len(test_df)
    }
    
    results_path = f'data/envelope_comparison_results_{tester.model_timestamp}.json'
    with open(results_path, 'w') as f:
        json.dump(results, f, indent=2)
    
    print(f"\n💾 Saved detailed results: {results_path}")
    print(f"📊 Saved visualization: data/envelope_comparison_analysis_{tester.model_timestamp}.png")
    
    print("\n" + "="*60)
    print("🎉 Comparison test complete!")
    if metrics['ml_improvement_pct'] > 0:
        print(f"✅ ML approach shows {metrics['ml_improvement_pct']:.1f}% improvement over current method")
    else:
        print(f"⚠️ Current approach performs {-metrics['ml_improvement_pct']:.1f}% better than ML")
    print("="*60)

if __name__ == "__main__":
    main()