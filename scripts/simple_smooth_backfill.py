#!/usr/bin/env python3

"""
Simple Smooth Backfill - No ML, Just Clean Interpolation
Debug version to get smooth curves without ML complexity
"""

import json
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
from datetime import datetime
import warnings
warnings.filterwarnings('ignore')

def load_iltms_recent_videos():
    """Load recent ILTMS videos"""
    print("📊 Loading ILTMS recent videos...")
    
    # Load all data
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
    numeric_columns = ['view_count', 'days_since_published']
    for col in numeric_columns:
        df[col] = pd.to_numeric(df[col], errors='coerce')
    
    # Filter to ILTMS and recent
    iltms_data = df[df['channel_name'] == 'I Like To Make Stuff'].copy()
    recent_videos = iltms_data[iltms_data['days_since_published'] <= 90]
    
    # Get videos with good data
    good_videos = []
    for video_id in recent_videos['video_id'].unique():
        video_data = recent_videos[recent_videos['video_id'] == video_id]
        if len(video_data) >= 3:  # Need at least 3 points
            good_videos.append({
                'video_id': video_id,
                'title': video_data['title'].iloc[0],
                'data': video_data.sort_values('days_since_published'),
                'max_views': video_data['view_count'].max()
            })
    
    # Sort by performance
    good_videos.sort(key=lambda x: x['max_views'], reverse=True)
    
    print(f"✅ Found {len(good_videos)} good recent videos")
    for i, video in enumerate(good_videos[:10]):
        print(f"   {i+1}. {video['title'][:50]}... (max: {video['max_views']:,})")
    
    return good_videos[:10]  # Top 10

def smooth_interpolate_video(video_data):
    """Create smooth interpolated progression"""
    if len(video_data) < 2:
        return pd.DataFrame()
    
    # Get actual points
    actual_data = video_data.sort_values('days_since_published')
    actual_days = actual_data['days_since_published'].values
    actual_views = actual_data['view_count'].values
    
    print(f"   📈 {actual_data['title'].iloc[0][:40]}...")
    print(f"      Points: {list(zip(actual_days.astype(int), actual_views.astype(int)))}")
    
    # Create smooth progression for days 1-90
    progression = []
    
    for day in range(1, 91):
        if day in actual_days:
            # Use exact actual data
            idx = np.where(actual_days == day)[0][0]
            views = actual_views[idx]
            data_type = 'actual'
        else:
            # Smooth interpolation/extrapolation
            views = smooth_estimate(day, actual_days, actual_views)
            data_type = 'predicted'
        
        progression.append({
            'video_id': video_data['video_id'].iloc[0],
            'title': video_data['title'].iloc[0],
            'days_since_published': day,
            'views': views,
            'data_type': data_type
        })
    
    df_prog = pd.DataFrame(progression)
    
    # Ensure monotonic growth (no view losses)
    views = df_prog['views'].values
    for i in range(1, len(views)):
        views[i] = max(views[i], views[i-1])
    df_prog['views'] = views
    
    return df_prog

def smooth_estimate(target_day, actual_days, actual_views):
    """Smooth estimation using spline-like interpolation"""
    
    if target_day < actual_days[0]:
        # Extrapolate before first point
        if len(actual_days) >= 2:
            # Use first two points to estimate early growth
            day1, day2 = actual_days[0], actual_days[1]
            views1, views2 = actual_views[0], actual_views[1]
            
            if day1 != day2:
                growth_rate = (views2 / views1) ** (1 / (day2 - day1))
                days_back = day1 - target_day
                return views1 / (growth_rate ** days_back)
        
        return actual_views[0] * (target_day / actual_days[0])
    
    elif target_day > actual_days[-1]:
        # Extrapolate after last point
        if len(actual_days) >= 2:
            # Use last two points
            day1, day2 = actual_days[-2], actual_days[-1]
            views1, views2 = actual_views[-2], actual_views[-1]
            
            if day1 != day2 and views1 > 0:
                growth_rate = (views2 / views1) ** (1 / (day2 - day1))
                days_forward = target_day - day2
                # Apply diminishing returns
                decay = np.exp(-days_forward / 30)
                effective_growth = 1 + (growth_rate - 1) * decay
                return views2 * (effective_growth ** days_forward)
        
        return actual_views[-1]
    
    else:
        # Interpolate between points
        # Find surrounding points
        left_idx = np.where(actual_days < target_day)[0]
        right_idx = np.where(actual_days > target_day)[0]
        
        if len(left_idx) > 0 and len(right_idx) > 0:
            left_day = actual_days[left_idx[-1]]
            right_day = actual_days[right_idx[0]]
            left_views = actual_views[left_idx[-1]]
            right_views = actual_views[right_idx[0]]
            
            # Smooth interpolation in log space
            if left_views > 0 and right_views > 0:
                progress = (target_day - left_day) / (right_day - left_day)
                log_left = np.log(left_views)
                log_right = np.log(right_views)
                log_interpolated = log_left + progress * (log_right - log_left)
                return np.exp(log_interpolated)
        
        # Fallback to nearest
        distances = np.abs(actual_days - target_day)
        nearest_idx = np.argmin(distances)
        return actual_views[nearest_idx]

def create_envelope(all_progressions):
    """Create envelope from progressions"""
    print("📊 Creating envelope from smooth progressions...")
    
    all_data = pd.concat(all_progressions, ignore_index=True)
    
    envelope_data = []
    for day in range(1, 91):
        day_views = all_data[all_data['days_since_published'] == day]['views']
        if len(day_views) >= 3:
            envelope_data.append({
                'day': day,
                'p10': np.percentile(day_views, 10),
                'p50': np.percentile(day_views, 50),
                'p90': np.percentile(day_views, 90)
            })
    
    envelope_df = pd.DataFrame(envelope_data)
    print(f"✅ Envelope: P50 range {envelope_df['p50'].min():,.0f} - {envelope_df['p50'].max():,.0f}")
    return envelope_df

def create_smooth_viz(good_videos, all_progressions, envelope_df):
    """Create smooth visualization"""
    print("🎨 Creating smooth visualization...")
    
    fig, axes = plt.subplots(2, 2, figsize=(16, 12))
    
    # Top left: Single video
    ax1 = axes[0, 0]
    target_prog = all_progressions[0]
    actual = target_prog[target_prog['data_type'] == 'actual']
    
    ax1.plot(target_prog['days_since_published'], target_prog['views'], 
            'b-', linewidth=2, label='Smooth Interpolated Curve')
    ax1.scatter(actual['days_since_published'], actual['views'], 
               color='red', s=100, zorder=5, label='Actual Data Points')
    
    ax1.set_title(f'Smooth Interpolation Example\n{good_videos[0]["title"][:40]}...')
    ax1.set_xlabel('Days Since Published')
    ax1.set_ylabel('View Count')
    ax1.legend()
    ax1.grid(True, alpha=0.3)
    ax1.set_yscale('log')
    
    # Top right: All videos - SMOOTH CURVES ONLY
    ax2 = axes[0, 1]
    colors = plt.cm.tab10(np.linspace(0, 1, len(all_progressions)))
    
    for i, progression in enumerate(all_progressions):
        # Plot ONLY the smooth curve, no scatter points
        ax2.plot(progression['days_since_published'], progression['views'], 
                color=colors[i], linewidth=2, alpha=0.8,
                label=f'Video {i+1}' if i < 3 else "")
    
    ax2.set_title(f'All {len(all_progressions)} Videos: Smooth Interpolated Curves')
    ax2.set_xlabel('Days Since Published')
    ax2.set_ylabel('View Count')
    ax2.grid(True, alpha=0.3)
    ax2.set_yscale('log')
    if len(all_progressions) <= 3:
        ax2.legend()
    
    # Bottom left: Envelope
    ax3 = axes[1, 0]
    
    ax3.fill_between(envelope_df['day'], envelope_df['p10'], envelope_df['p90'],
                    alpha=0.4, color='gray', label='Confidence Band')
    ax3.plot(envelope_df['day'], envelope_df['p50'], 'g-', linewidth=3,
            label='Expected Performance')
    
    ax3.set_title('Channel Envelope from Smooth Curves')
    ax3.set_xlabel('Days Since Published')
    ax3.set_ylabel('View Count')
    ax3.legend()
    ax3.grid(True, alpha=0.3)
    ax3.set_yscale('log')
    
    # Bottom right: Assessment
    ax4 = axes[1, 1]
    
    ax4.fill_between(envelope_df['day'], envelope_df['p10'], envelope_df['p90'],
                    alpha=0.4, color='gray', label='Channel Envelope')
    ax4.plot(envelope_df['day'], envelope_df['p50'], 'g-', linewidth=2,
            alpha=0.8, label='Expected Performance')
    
    target_prog = all_progressions[0]
    actual = target_prog[target_prog['data_type'] == 'actual']
    
    ax4.plot(target_prog['days_since_published'], target_prog['views'], 
            'b-', linewidth=2, alpha=0.8, label='Target Video')
    ax4.scatter(actual['days_since_published'], actual['views'], 
               color='red', s=100, zorder=5, label='Actual Points')
    
    ax4.set_title('Performance Assessment: Smooth Curves')
    ax4.set_xlabel('Days Since Published')
    ax4.set_ylabel('View Count')
    ax4.legend()
    ax4.grid(True, alpha=0.3)
    ax4.set_yscale('log')
    
    plt.suptitle('SMOOTH Backfill: Clean Interpolation Without ML Chaos', 
                fontsize=14, fontweight='bold')
    plt.tight_layout()
    
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    viz_path = f'data/smooth_backfill_{timestamp}.png'
    plt.savefig(viz_path, dpi=300, bbox_inches='tight')
    print(f"💾 Smooth visualization: {viz_path}")
    
    return viz_path

def main():
    print("🚀 SMOOTH BACKFILL (No ML Chaos)")
    print("=" * 50)
    
    # Load videos
    good_videos = load_iltms_recent_videos()
    
    if len(good_videos) < 5:
        print("❌ Not enough videos")
        return
    
    # Create smooth progressions
    print(f"\n🔄 Creating smooth progressions for {len(good_videos)} videos...")
    all_progressions = []
    
    for video in good_videos:
        progression = smooth_interpolate_video(video['data'])
        if len(progression) > 0:
            all_progressions.append(progression)
    
    print(f"✅ Created {len(all_progressions)} smooth progressions")
    
    # Create envelope
    envelope_df = create_envelope(all_progressions)
    
    # Create viz
    viz_path = create_smooth_viz(good_videos, all_progressions, envelope_df)
    
    print(f"\n🎉 SMOOTH DEMO COMPLETE!")
    print(f"✅ No crazy curves - just clean smooth interpolation")
    print(f"💾 Visualization: {viz_path}")

if __name__ == "__main__":
    main()