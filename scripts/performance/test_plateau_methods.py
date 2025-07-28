#!/usr/bin/env python3
"""
Comprehensive testing of different plateau calculation methods to fix distribution bias.
Tests multiple approaches with varied channel samples from our database.
"""

import os
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import seaborn as sns
from scipy import stats
from supabase import create_client, Client
from dotenv import load_dotenv
from typing import Dict, List, Tuple, Any
import warnings
warnings.filterwarnings('ignore')

# Load environment variables
load_dotenv()

# Initialize Supabase client
url = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
supabase: Client = create_client(url, key)

print("🧪 Comprehensive Plateau Calculation Method Testing")
print("=" * 60)

class PlateauTester:
    def __init__(self):
        self.global_curve = self._load_global_curve()
        self.global_plateau = self.global_curve[365]
        self.test_channels = self._select_test_channels()
        self.results = {}
        
    def _load_global_curve(self) -> Dict[int, float]:
        """Load global performance curve"""
        print("📥 Loading global curve...")
        result = supabase.table('performance_envelopes')\
            .select('day_since_published, p50_views')\
            .lte('day_since_published', 365)\
            .order('day_since_published')\
            .execute()
        
        curve = {row['day_since_published']: row['p50_views'] for row in result.data}
        print(f"   Global plateau (day 365): {curve[365]:,} views")
        return curve
    
    def _select_test_channels(self) -> List[str]:
        """Select diverse channels for testing"""
        print("🎯 Selecting test channels...")
        
        # Get channel distribution
        result = supabase.table('videos')\
            .select('channel_name, view_count')\
            .not_.is_('view_count', 'null')\
            .gte('view_count', 100)\
            .execute()
        
        df = pd.DataFrame(result.data)
        channel_stats = df.groupby('channel_name').agg({
            'view_count': ['count', 'median', 'std', 'min', 'max']
        }).round(0)
        
        channel_stats.columns = ['video_count', 'median_views', 'std_views', 'min_views', 'max_views']
        channel_stats = channel_stats[channel_stats['video_count'] >= 20].copy()
        
        # Select diverse channels by size
        channel_stats['size_category'] = pd.cut(
            channel_stats['median_views'], 
            bins=[0, 1000, 10000, 100000, float('inf')],
            labels=['Micro', 'Small', 'Medium', 'Large']
        )
        
        # Sample from each category
        selected = []
        for category in ['Micro', 'Small', 'Medium', 'Large']:
            category_channels = channel_stats[channel_stats['size_category'] == category]
            if len(category_channels) > 0:
                # Sample 3-5 channels per category
                sample_size = min(5, len(category_channels))
                sampled = category_channels.sample(sample_size, random_state=42)
                selected.extend(sampled.index.tolist())
        
        print(f"   Selected {len(selected)} channels across size categories")
        return selected[:20]  # Limit to 20 for performance
    
    def get_channel_videos(self, channel_name: str) -> pd.DataFrame:
        """Get video data for a channel"""
        result = supabase.table('videos')\
            .select('id, title, view_count, published_at')\
            .eq('channel_name', channel_name)\
            .not_.is_('view_count', 'null')\
            .gte('view_count', 100)\
            .execute()
        
        df = pd.DataFrame(result.data)
        if len(df) == 0:
            return df
            
        # Calculate video age
        df['published_at'] = pd.to_datetime(df['published_at'])
        df['days_old'] = (pd.Timestamp.now(tz='UTC') - df['published_at']).dt.days
        
        return df[df['days_old'] >= 30].copy()  # Only mature videos
    
    def calculate_plateau_methods(self, views: np.array) -> Dict[str, float]:
        """Test different plateau calculation methods"""
        if len(views) < 10:
            return {}
            
        methods = {}
        
        # Method 1: Current (Median of all)
        methods['current_median'] = np.median(views)
        
        # Method 2: 25th Percentile
        methods['p25'] = np.percentile(views, 25)
        
        # Method 3: Trimmed Mean (remove top/bottom 10%)
        if len(views) >= 10:
            methods['trimmed_mean'] = stats.trim_mean(views, 0.1)
        
        # Method 4: IQR Filtered Median
        Q1 = np.percentile(views, 25)
        Q3 = np.percentile(views, 75)
        IQR = Q3 - Q1
        lower = Q1 - 1.5 * IQR
        upper = Q3 + 1.5 * IQR
        filtered_views = views[(views >= lower) & (views <= upper)]
        if len(filtered_views) >= 5:
            methods['iqr_filtered'] = np.median(filtered_views)
        
        # Method 5: Mode-based (peak of log distribution)
        if len(views) >= 20:
            log_views = np.log10(views[views > 0])
            hist, bins = np.histogram(log_views, bins=min(20, len(views)//3))
            if len(hist) > 0:
                mode_bin = bins[np.argmax(hist)]
                methods['modal_baseline'] = 10 ** mode_bin
        
        # Method 6: Time-windowed (90-365 days old only)
        # Note: This would require age data per video, using approximation
        if len(views) >= 10:
            # Assume older videos are less viral (simple heuristic)
            sorted_views = np.sort(views)
            # Take middle 50% as "mature" videos
            start_idx = len(sorted_views) // 4
            end_idx = 3 * len(sorted_views) // 4
            mature_views = sorted_views[start_idx:end_idx]
            if len(mature_views) >= 3:
                methods['time_windowed'] = np.median(mature_views)
        
        # Method 7: Robust (combination approach)
        reliable_methods = []
        if 'p25' in methods:
            reliable_methods.append(methods['p25'])
        if 'iqr_filtered' in methods:
            reliable_methods.append(methods['iqr_filtered'])
        if 'trimmed_mean' in methods:
            reliable_methods.append(methods['trimmed_mean'])
        
        if len(reliable_methods) >= 2:
            methods['robust_combined'] = np.median(reliable_methods)
        
        return methods
    
    def test_channel_performance_distribution(self, channel_name: str, plateau_value: float) -> Dict[str, Any]:
        """Test performance distribution for a given plateau value"""
        videos_df = self.get_channel_videos(channel_name)
        
        if len(videos_df) < 10:
            return {}
        
        # Calculate performance ratios
        scale_factor = plateau_value / self.global_plateau
        performance_ratios = []
        
        for _, video in videos_df.iterrows():
            days = video['days_old']
            if days in self.global_curve:
                expected = self.global_curve[days] * scale_factor
                ratio = video['view_count'] / expected if expected > 0 else 0
                performance_ratios.append(ratio)
        
        if len(performance_ratios) == 0:
            return {}
        
        ratios = np.array(performance_ratios)
        
        # Calculate distribution
        viral = np.sum(ratios > 3.0)
        outperforming = np.sum((ratios >= 1.5) & (ratios <= 3.0))
        on_track = np.sum((ratios >= 0.5) & (ratios < 1.5))
        underperforming = np.sum((ratios >= 0.2) & (ratios < 0.5))
        poor = np.sum(ratios < 0.2)
        
        total = len(ratios)
        
        return {
            'channel': channel_name,
            'total_videos': total,
            'median_ratio': np.median(ratios),
            'mean_ratio': np.mean(ratios),
            'viral_pct': viral / total * 100,
            'outperforming_pct': outperforming / total * 100,
            'on_track_pct': on_track / total * 100,
            'underperforming_pct': underperforming / total * 100,
            'poor_pct': poor / total * 100,
            'plateau_value': plateau_value,
            'scale_factor': scale_factor
        }
    
    def run_comprehensive_test(self):
        """Run comprehensive test across all methods and channels"""
        print(f"🔬 Testing {len(self.test_channels)} channels with multiple plateau methods...")
        
        all_results = []
        method_performance = {}
        
        for i, channel in enumerate(self.test_channels):
            print(f"   Testing channel {i+1}/{len(self.test_channels)}: {channel}")
            
            videos_df = self.get_channel_videos(channel)
            if len(videos_df) < 10:
                print(f"      Skipping {channel} - insufficient data ({len(videos_df)} videos)")
                continue
            
            views = videos_df['view_count'].values
            plateau_methods = self.calculate_plateau_methods(views)
            
            channel_results = {}
            for method_name, plateau_value in plateau_methods.items():
                if plateau_value > 0:
                    distribution = self.test_channel_performance_distribution(channel, plateau_value)
                    if distribution:
                        distribution['method'] = method_name
                        channel_results[method_name] = distribution
                        all_results.append(distribution)
            
            self.results[channel] = channel_results
        
        # Analyze method performance
        df_results = pd.DataFrame(all_results)
        
        if len(df_results) > 0:
            print(f"\n📊 Analyzing {len(df_results)} test results...")
            self._analyze_method_performance(df_results)
            self._create_visualizations(df_results)
        
        return df_results
    
    def _analyze_method_performance(self, df: pd.DataFrame):
        """Analyze which method produces best distribution"""
        print("\n🎯 Method Performance Analysis:")
        print("=" * 50)
        
        # Expected ideal distribution: ~25% under, ~50% on-track, ~25% over
        ideal_under = 25  # underperforming + poor
        ideal_on_track = 50
        ideal_over = 25  # outperforming + viral
        
        method_scores = {}
        
        for method in df['method'].unique():
            method_data = df[df['method'] == method]
            
            avg_under = method_data['underperforming_pct'].mean() + method_data['poor_pct'].mean()
            avg_on_track = method_data['on_track_pct'].mean()
            avg_over = method_data['outperforming_pct'].mean() + method_data['viral_pct'].mean()
            avg_median_ratio = method_data['median_ratio'].mean()
            
            # Score based on deviation from ideal
            under_error = abs(avg_under - ideal_under)
            on_track_error = abs(avg_on_track - ideal_on_track)
            over_error = abs(avg_over - ideal_over)
            ratio_error = abs(avg_median_ratio - 1.0) * 100  # Convert to percentage
            
            total_error = under_error + on_track_error + over_error + ratio_error
            method_scores[method] = {
                'total_error': total_error,
                'avg_under': avg_under,
                'avg_on_track': avg_on_track,
                'avg_over': avg_over,
                'avg_median_ratio': avg_median_ratio,
                'channels_tested': len(method_data)
            }
            
            print(f"\n{method.upper()}:")
            print(f"  Underperforming: {avg_under:.1f}% (ideal: 25%)")
            print(f"  On Track:        {avg_on_track:.1f}% (ideal: 50%)")  
            print(f"  Overperforming:  {avg_over:.1f}% (ideal: 25%)")
            print(f"  Median Ratio:    {avg_median_ratio:.2f}x (ideal: 1.0x)")
            print(f"  Total Error:     {total_error:.1f}")
            print(f"  Channels:        {len(method_data)}")
        
        # Rank methods
        sorted_methods = sorted(method_scores.items(), key=lambda x: x[1]['total_error'])
        
        print(f"\n🏆 METHOD RANKINGS (by total error):")
        print("-" * 40)
        for i, (method, scores) in enumerate(sorted_methods):
            print(f"{i+1:2d}. {method:<18} (error: {scores['total_error']:5.1f})")
        
        self.best_method = sorted_methods[0][0]
        print(f"\n✅ RECOMMENDED METHOD: {self.best_method.upper()}")
        
        return method_scores
    
    def _create_visualizations(self, df: pd.DataFrame):
        """Create comprehensive visualizations"""
        print("\n📈 Creating visualizations...")
        
        # Set up the plot
        fig, axes = plt.subplots(2, 3, figsize=(20, 12))
        fig.suptitle('Plateau Calculation Method Comparison', fontsize=16, fontweight='bold')
        
        # 1. Distribution comparison
        ax1 = axes[0, 0]
        methods = df['method'].unique()
        x_pos = np.arange(len(methods))
        
        under_means = [df[df['method'] == m]['underperforming_pct'].mean() + 
                      df[df['method'] == m]['poor_pct'].mean() for m in methods]
        on_track_means = [df[df['method'] == m]['on_track_pct'].mean() for m in methods]
        over_means = [df[df['method'] == m]['outperforming_pct'].mean() + 
                     df[df['method'] == m]['viral_pct'].mean() for m in methods]
        
        width = 0.25
        ax1.bar(x_pos - width, under_means, width, label='Underperforming', color='red', alpha=0.7)
        ax1.bar(x_pos, on_track_means, width, label='On Track', color='green', alpha=0.7)
        ax1.bar(x_pos + width, over_means, width, label='Overperforming', color='orange', alpha=0.7)
        
        ax1.axhline(y=25, color='gray', linestyle='--', alpha=0.5, label='Ideal (25%)')
        ax1.axhline(y=50, color='gray', linestyle='--', alpha=0.5)
        ax1.set_xlabel('Method')
        ax1.set_ylabel('Percentage')
        ax1.set_title('Performance Distribution by Method')
        ax1.set_xticks(x_pos)
        ax1.set_xticklabels(methods, rotation=45, ha='right')
        ax1.legend()
        ax1.grid(True, alpha=0.3)
        
        # 2. Median ratio comparison
        ax2 = axes[0, 1]
        median_ratios = [df[df['method'] == m]['median_ratio'].mean() for m in methods]
        bars = ax2.bar(methods, median_ratios, color='skyblue', alpha=0.7)
        ax2.axhline(y=1.0, color='red', linestyle='--', linewidth=2, label='Ideal (1.0x)')
        ax2.set_ylabel('Median Performance Ratio')
        ax2.set_title('Median Ratio by Method')
        ax2.set_xticklabels(methods, rotation=45, ha='right')
        ax2.legend()
        ax2.grid(True, alpha=0.3)
        
        # Add value labels on bars
        for bar, value in zip(bars, median_ratios):
            ax2.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 0.02, 
                    f'{value:.2f}', ha='center', va='bottom', fontweight='bold')
        
        # 3. Method error scores
        ax3 = axes[0, 2]
        method_errors = []
        for method in methods:
            method_data = df[df['method'] == method]
            avg_under = method_data['underperforming_pct'].mean() + method_data['poor_pct'].mean()
            avg_on_track = method_data['on_track_pct'].mean()
            avg_over = method_data['outperforming_pct'].mean() + method_data['viral_pct'].mean()
            avg_median_ratio = method_data['median_ratio'].mean()
            
            total_error = (abs(avg_under - 25) + abs(avg_on_track - 50) + 
                          abs(avg_over - 25) + abs(avg_median_ratio - 1.0) * 100)
            method_errors.append(total_error)
        
        bars = ax3.bar(methods, method_errors, color='lightcoral', alpha=0.7)
        ax3.set_ylabel('Total Error Score')
        ax3.set_title('Method Accuracy (Lower = Better)')
        ax3.set_xticklabels(methods, rotation=45, ha='right')
        ax3.grid(True, alpha=0.3)
        
        # Add value labels
        for bar, value in zip(bars, method_errors):
            ax3.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 1, 
                    f'{value:.1f}', ha='center', va='bottom', fontweight='bold')
        
        # 4. Channel size impact
        ax4 = axes[1, 0]
        # Create channel size categories based on scale factor
        df['size_category'] = pd.cut(df['scale_factor'], 
                                   bins=[0, 0.1, 1, 10, float('inf')],
                                   labels=['Micro', 'Small', 'Medium', 'Large'])
        
        size_medians = df.groupby(['size_category', 'method'])['median_ratio'].mean().unstack()
        size_medians.plot(kind='bar', ax=ax4, alpha=0.8)
        ax4.axhline(y=1.0, color='red', linestyle='--', alpha=0.7)
        ax4.set_title('Median Ratio by Channel Size & Method')
        ax4.set_ylabel('Median Ratio')
        ax4.legend(title='Method', bbox_to_anchor=(1.05, 1), loc='upper left')
        ax4.grid(True, alpha=0.3)
        
        # 5. Distribution spread
        ax5 = axes[1, 1]
        for method in methods[:5]:  # Limit to top 5 methods for clarity
            method_data = df[df['method'] == method]['median_ratio']
            ax5.hist(method_data, alpha=0.6, label=method, bins=10)
        ax5.axvline(x=1.0, color='red', linestyle='--', linewidth=2)
        ax5.set_xlabel('Median Ratio')
        ax5.set_ylabel('Frequency')
        ax5.set_title('Distribution of Median Ratios')
        ax5.legend()
        ax5.grid(True, alpha=0.3)
        
        # 6. Method consistency
        ax6 = axes[1, 2]
        method_std = []
        for method in methods:
            method_data = df[df['method'] == method]['median_ratio']
            method_std.append(method_data.std())
        
        bars = ax6.bar(methods, method_std, color='lightgreen', alpha=0.7)
        ax6.set_ylabel('Standard Deviation')
        ax6.set_title('Method Consistency (Lower = Better)')
        ax6.set_xticklabels(methods, rotation=45, ha='right')
        ax6.grid(True, alpha=0.3)
        
        plt.tight_layout()
        plt.savefig('plateau_method_comparison.png', dpi=300, bbox_inches='tight')
        print("   ✅ Visualization saved as 'plateau_method_comparison.png'")
        
        return fig

def main():
    """Run the comprehensive plateau testing"""
    tester = PlateauTester()
    results_df = tester.run_comprehensive_test()
    
    if len(results_df) > 0:
        # Save detailed results
        results_df.to_csv('plateau_method_test_results.csv', index=False)
        print(f"\n💾 Detailed results saved to 'plateau_method_test_results.csv'")
        
        print(f"\n🎯 FINAL RECOMMENDATIONS:")
        print("=" * 50)
        print(f"Best performing method: {tester.best_method.upper()}")
        
        best_results = results_df[results_df['method'] == tester.best_method]
        avg_under = best_results['underperforming_pct'].mean() + best_results['poor_pct'].mean()
        avg_on_track = best_results['on_track_pct'].mean()
        avg_over = best_results['outperforming_pct'].mean() + best_results['viral_pct'].mean()
        avg_ratio = best_results['median_ratio'].mean()
        
        print(f"Distribution with {tester.best_method}:")
        print(f"  - Underperforming: {avg_under:.1f}% (target: 25%)")
        print(f"  - On Track:        {avg_on_track:.1f}% (target: 50%)")
        print(f"  - Overperforming:  {avg_over:.1f}% (target: 25%)")
        print(f"  - Median Ratio:    {avg_ratio:.2f}x (target: 1.0x)")
        
        # Implementation recommendations
        print(f"\n🔧 IMPLEMENTATION PLAN:")
        if tester.best_method == 'p25':
            print("  1. Replace np.median() with np.percentile(views, 25)")
            print("  2. Update plateau calculation in all scripts")
            print("  3. Recalculate channel scale factors")
        elif tester.best_method == 'iqr_filtered':
            print("  1. Implement IQR outlier filtering before median")
            print("  2. Add robust statistics to plateau calculation")
            print("  3. Handle edge cases with < 10 videos")
        elif tester.best_method == 'trimmed_mean':
            print("  1. Use scipy.stats.trim_mean(views, 0.1)")
            print("  2. Update plateau calculation functions")
            print("  3. Add minimum video count validation")
        
        print(f"\n✅ Testing complete! Check visualizations and CSV for detailed analysis.")
    
    else:
        print("❌ No valid results generated. Check channel data and method implementations.")

if __name__ == "__main__":
    main()