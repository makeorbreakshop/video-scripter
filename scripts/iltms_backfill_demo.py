#!/usr/bin/env python3

"""
ILTMS Backfill Demo - Quick Version
Shows the concept of backfilling specific video data points
"""

import json
import pandas as pd
import numpy as np
import pickle
import matplotlib.pyplot as plt
from datetime import datetime
import warnings
warnings.filterwarnings('ignore')

def load_iltms_sample():
    """Load a sample of ILTMS data quickly"""
    print("📊 Loading ILTMS sample data...")
    
    # Load just first batch to be fast
    with open('data/ml_training_batch_1.json', 'r') as f:
        batch_data = json.load(f)
    
    df = pd.DataFrame(batch_data)
    
    # Convert types
    numeric_columns = ['subscriber_count', 'channel_video_count', 'view_count', 
                      'days_since_published', 'title_length', 'title_word_count']
    for col in numeric_columns:
        df[col] = pd.to_numeric(df[col], errors='coerce')
    
    # Filter to ILTMS
    iltms_data = df[df['channel_name'] == 'I Like To Make Stuff']
    
    if len(iltms_data) == 0:
        print("❌ No ILTMS data found in first batch, using sample data...")
        # Create sample data structure
        sample_data = []
        for i in range(5):
            base_views = 150000 + i * 50000
            for day in [1, 7, 14, 30, 60]:
                sample_data.append({
                    'video_id': f'sample_video_{i}',
                    'title': f'Sample ILTMS Video {i+1}',
                    'channel_name': 'I Like To Make Stuff',
                    'days_since_published': day,
                    'view_count': int(base_views * (1 + day * 0.02)),
                    'subscriber_count': 3370000,
                    'channel_video_count': 464
                })
        iltms_data = pd.DataFrame(sample_data)
    
    print(f"✅ Found {len(iltms_data)} ILTMS data points from {iltms_data['video_id'].nunique()} videos")
    return iltms_data

def simple_ml_backfill(video_data, days_range):
    """Simple ML-inspired backfill using exponential decay model"""
    # Get actual data points
    actual_days = video_data['days_since_published'].tolist()
    actual_views = video_data['view_count'].tolist()
    
    # Fit simple exponential growth model to actual points
    if len(actual_days) >= 2:
        # Calculate growth rate from actual data
        early_views = actual_views[0] if len(actual_views) > 0 else 100000
        growth_rate = 0.02  # Default growth rate
        
        if len(actual_views) >= 2:
            days_diff = actual_days[1] - actual_days[0]
            views_ratio = actual_views[1] / actual_views[0] if actual_views[0] > 0 else 1.1
            growth_rate = (views_ratio - 1) / days_diff
    
    # Generate backfilled data
    backfilled = []
    for day in days_range:
        if day in actual_days:
            # Use actual data
            idx = actual_days.index(day)
            backfilled.append({
                'days_since_published': day,
                'views': actual_views[idx],
                'data_type': 'actual'
            })
        else:
            # ML backfill - exponential growth model
            predicted_views = early_views * (1 + growth_rate) ** day
            backfilled.append({
                'days_since_published': day,
                'views': predicted_views,
                'data_type': 'predicted'
            })
    
    return pd.DataFrame(backfilled)

def create_demo_visualization():
    """Create demonstration of the backfill process"""
    print("🎨 Creating ILTMS backfill demonstration...")
    
    # Load sample ILTMS data
    iltms_data = load_iltms_sample()
    
    # Get unique videos (limit to 5 for demo)
    unique_videos = iltms_data['video_id'].unique()[:5]
    
    # Create visualization
    fig, axes = plt.subplots(2, 2, figsize=(16, 12))
    
    # Top left: Single video backfill example
    ax1 = axes[0, 0]
    if len(unique_videos) > 0:
        target_video = unique_videos[0]
        video_data = iltms_data[iltms_data['video_id'] == target_video]
        
        # Backfill this video
        days_range = list(range(1, 91))  # 90 days
        backfilled = simple_ml_backfill(video_data, days_range)
        
        actual = backfilled[backfilled['data_type'] == 'actual']
        predicted = backfilled[backfilled['data_type'] == 'predicted']
        
        # Plot backfilled curve
        ax1.plot(predicted['days_since_published'], predicted['views'], 
                'b--', alpha=0.7, linewidth=2, label='ML Backfilled Points')
        
        # Plot actual points
        ax1.scatter(actual['days_since_published'], actual['views'], 
                   color='red', s=100, zorder=5, label='Actual Data Points')
        
        ax1.set_title(f'Target Video: ML Backfill Demo\n"When You\'re Stuck... Try THIS" style')
        ax1.set_xlabel('Days Since Published')
        ax1.set_ylabel('View Count')
        ax1.legend()
        ax1.grid(True, alpha=0.3)
        ax1.set_yscale('log')
    
    # Top right: Multiple video backfills
    ax2 = axes[0, 1]
    all_backfilled = []
    colors = plt.cm.tab10(np.linspace(0, 1, len(unique_videos)))
    
    for i, video_id in enumerate(unique_videos):
        video_data = iltms_data[iltms_data['video_id'] == video_id]
        backfilled = simple_ml_backfill(video_data, list(range(1, 91)))
        all_backfilled.append(backfilled)
        
        actual = backfilled[backfilled['data_type'] == 'actual']
        predicted = backfilled[backfilled['data_type'] == 'predicted']
        
        # Plot backfilled curve
        ax2.plot(predicted['days_since_published'], predicted['views'], 
                '--', color=colors[i], alpha=0.6, linewidth=1, label=f'Video {i+1}' if i < 3 else "")
        
        # Plot actual points
        ax2.scatter(actual['days_since_published'], actual['views'], 
                   color=colors[i], alpha=0.8, s=20, zorder=5)
    
    ax2.set_title('Last 5 ILTMS Videos: Backfilled Curves\n(Input for Gray Envelope Calculation)')
    ax2.set_xlabel('Days Since Published')
    ax2.set_ylabel('View Count')
    ax2.legend()
    ax2.grid(True, alpha=0.3)
    ax2.set_yscale('log')
    
    # Bottom left: Calculate envelope from backfilled data
    ax3 = axes[1, 0]
    
    # Combine all backfilled data to calculate envelope
    all_views_by_day = {}
    for backfilled in all_backfilled:
        for _, row in backfilled.iterrows():
            day = row['days_since_published']
            if day not in all_views_by_day:
                all_views_by_day[day] = []
            all_views_by_day[day].append(row['views'])
    
    # Calculate percentiles
    envelope_days = []
    envelope_p10 = []
    envelope_p50 = []
    envelope_p90 = []
    
    for day in sorted(all_views_by_day.keys()):
        views = all_views_by_day[day]
        if len(views) >= 3:  # Need at least 3 videos for percentiles
            envelope_days.append(day)
            envelope_p10.append(np.percentile(views, 10))
            envelope_p50.append(np.percentile(views, 50))
            envelope_p90.append(np.percentile(views, 90))
    
    # Plot envelope
    ax3.fill_between(envelope_days, envelope_p10, envelope_p90,
                    alpha=0.3, color='gray', label='ML-Generated Confidence Band')
    ax3.plot(envelope_days, envelope_p50, 'g-', linewidth=2, label='Expected Performance')
    
    ax3.set_title('ML-Enhanced Confidence Envelope\n(Gray Area from Backfilled Videos)')
    ax3.set_xlabel('Days Since Published')
    ax3.set_ylabel('View Count')
    ax3.legend()
    ax3.grid(True, alpha=0.3)
    ax3.set_yscale('log')
    
    # Bottom right: Final result - target video with envelope
    ax4 = axes[1, 1]
    
    # Plot envelope
    ax4.fill_between(envelope_days, envelope_p10, envelope_p90,
                    alpha=0.3, color='gray', label='ML Confidence Band')
    ax4.plot(envelope_days, envelope_p50, 'g-', linewidth=2, alpha=0.8, label='Expected Performance')
    
    # Plot target video again
    target_backfilled = all_backfilled[0]
    target_actual = target_backfilled[target_backfilled['data_type'] == 'actual']
    target_predicted = target_backfilled[target_backfilled['data_type'] == 'predicted']
    
    ax4.plot(target_predicted['days_since_published'], target_predicted['views'], 
            'b--', alpha=0.7, linewidth=2, label='Target Video (Backfilled)')
    ax4.scatter(target_actual['days_since_published'], target_actual['views'], 
               color='red', s=100, zorder=5, label='Target Video (Actual)')
    
    # Performance assessment
    if len(target_actual) > 0:
        latest_actual_views = target_actual['views'].iloc[-1]
        latest_day = target_actual['days_since_published'].iloc[-1]
        
        # Find envelope at that day
        if latest_day in envelope_days:
            idx = envelope_days.index(latest_day)
            p10_at_day = envelope_p10[idx]
            p90_at_day = envelope_p90[idx]
            
            if latest_actual_views > p90_at_day:
                performance = "Overperforming"
                ax4.text(0.02, 0.98, f"Status: {performance}", transform=ax4.transAxes,
                        verticalalignment='top', bbox=dict(boxstyle='round', facecolor='lightgreen'))
            elif latest_actual_views < p10_at_day:
                performance = "Underperforming"  
                ax4.text(0.02, 0.98, f"Status: {performance}", transform=ax4.transAxes,
                        verticalalignment='top', bbox=dict(boxstyle='round', facecolor='lightcoral'))
            else:
                performance = "Meeting Expectations"
                ax4.text(0.02, 0.98, f"Status: {performance}", transform=ax4.transAxes,
                        verticalalignment='top', bbox=dict(boxstyle='round', facecolor='lightblue'))
    
    ax4.set_title('Final Result: Target Video vs ML Envelope\n(Like Your Performance Graph)')
    ax4.set_xlabel('Days Since Published')
    ax4.set_ylabel('View Count')
    ax4.legend()
    ax4.grid(True, alpha=0.3)
    ax4.set_yscale('log')
    
    plt.suptitle('ILTMS ML Backfill Process: From Sparse Data to Gray Confidence Bands', 
                fontsize=16, fontweight='bold')
    plt.tight_layout()
    
    demo_path = 'data/iltms_backfill_demo.png'
    plt.savefig(demo_path, dpi=300, bbox_inches='tight')
    print(f"💾 Demo visualization saved: {demo_path}")
    
    return demo_path

def main():
    print("🚀 ILTMS Backfill Demo")
    print("=" * 40)
    
    demo_path = create_demo_visualization()
    
    print("\n" + "=" * 40)
    print("🎉 Demo Complete!")
    print(f"📊 Shows the complete process:")
    print("   1. Target video with sparse actual data points")
    print("   2. ML backfill of missing points for multiple videos")  
    print("   3. Calculation of confidence envelope from backfilled curves")
    print("   4. Final performance assessment using ML-enhanced gray area")
    print(f"💾 Visualization: {demo_path}")
    print("=" * 40)

if __name__ == "__main__":
    main()