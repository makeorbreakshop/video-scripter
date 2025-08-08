#!/usr/bin/env python3
"""
Smart channel baseline calculation with ML enhancement
Uses ML model to predict better baselines when early tracking data is sparse
"""

import os
import matplotlib.pyplot as plt
import numpy as np
import json
import pickle
import pandas as pd
from supabase import create_client, Client
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Initialize Supabase client
url = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
supabase: Client = create_client(url, key)

def load_ml_baseline_model():
    """Load the ML baseline prediction model"""
    try:
        model_dir = "models"
        if not os.path.exists(model_dir):
            return None, None
        
        # Find latest baseline model files
        model_files = [f for f in os.listdir(model_dir) if f.endswith('.pkl') and 'baseline_predictor' in f]
        metadata_files = [f for f in os.listdir(model_dir) if f.endswith('_metadata.json') and 'baseline_predictor' in f]
        
        if not model_files or not metadata_files:
            return None, None
        
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
    except Exception as e:
        print(f"⚠️  Could not load ML model: {e}")
        return None, None

def get_channel_characteristics_for_ml(channel_name, videos_data):
    """Extract channel characteristics needed for ML baseline prediction"""
    try:
        # Get channel stats from first video
        first_video = videos_data[0] if videos_data else {}
        
        # Extract subscriber count from metadata if available
        subscriber_count = 10000  # Default
        if 'metadata' in first_video and first_video['metadata']:
            metadata = first_video['metadata']
            if isinstance(metadata, dict) and 'channel' in metadata:
                subscriber_count = metadata['channel'].get('subscriber_count', 10000)
        
        # Analyze video characteristics
        formats = [v.get('format_type', 'tutorial') for v in videos_data if v.get('format_type')]
        topics = [v.get('topic_cluster_id', 50) for v in videos_data if v.get('topic_cluster_id')]
        titles = [v.get('title', '') for v in videos_data if v.get('title')]
        
        # Get dominant characteristics
        dominant_format = max(set(formats), key=formats.count) if formats else 'tutorial'
        dominant_topic = int(np.median(topics)) if topics else 50
        avg_title_length = np.mean([len(title.split()) for title in titles]) if titles else 8
        
        return {
            'channel_name': channel_name,
            'subscriber_count': subscriber_count,
            'dominant_format': dominant_format,
            'dominant_topic_cluster': dominant_topic,
            'avg_title_length': int(avg_title_length)
        }
    except Exception as e:
        print(f"⚠️  Error extracting channel characteristics: {e}")
        return {
            'channel_name': channel_name,
            'subscriber_count': 10000,
            'dominant_format': 'tutorial',
            'dominant_topic_cluster': 50,
            'avg_title_length': 8
        }

def generate_ml_baseline(channel_characteristics, model, metadata, global_baseline=8478):
    """Generate ML-based baseline for a channel"""
    try:
        # Extract features for ML prediction
        subscriber_count = channel_characteristics['subscriber_count']
        dominant_format = channel_characteristics['dominant_format']
        dominant_topic = channel_characteristics['dominant_topic_cluster']
        avg_title_length = channel_characteristics['avg_title_length']
        
        # Create features similar to ml_recent_baseline_backfill.py
        features = {
            'subscriber_count': float(subscriber_count),
            'channel_tier': get_channel_tier_numeric(subscriber_count),
            'topic_cluster_id': int(dominant_topic),
            'title_word_count': max(3, int(avg_title_length)),
            'day_of_week': 2,  # Tuesday (common upload day)
            'hour_of_day': 14  # 2 PM (common upload time)
        }
        
        # One-hot encode format type
        baseline_formats = [
            'case_study', 'explainer', 'listicle', 'personal_story', 
            'product_focus', 'shorts', 'tutorial', 'vlog'
        ]
        
        for fmt in baseline_formats:
            features[f'format_{fmt}'] = 1 if dominant_format == fmt else 0
        
        # Create DataFrame with correct column order
        feature_names = metadata['features']
        feature_data = {}
        
        for feature_name in feature_names:
            if feature_name in features:
                feature_data[feature_name] = features[feature_name]
            else:
                feature_data[feature_name] = 0
        
        features_df = pd.DataFrame([feature_data])
        
        # Get ML prediction (log multiplier)
        log_prediction = model.predict(features_df)[0]
        multiplier = np.exp(log_prediction)
        
        # Apply multiplier to global baseline
        ml_baseline = global_baseline * multiplier
        
        print(f"   ML Prediction: {multiplier:.2f}x multiplier → {ml_baseline:,.0f} views baseline")
        
        return ml_baseline, multiplier
        
    except Exception as e:
        print(f"   ⚠️  ML prediction failed: {e}")
        return global_baseline, 1.0

def get_channel_tier_numeric(subscriber_count):
    """Convert subscriber count to numeric channel tier"""
    if subscriber_count < 1000:
        return 0  # micro
    elif subscriber_count < 10000:
        return 1  # small
    elif subscriber_count < 100000:
        return 2  # medium
    elif subscriber_count < 1000000:
        return 3  # large
    else:
        return 4  # mega

def smart_baseline_calculation():
    """Calculate baseline using early tracking data, enhanced with ML when sparse"""
    
    print("📊 Smart baseline calculation with ML enhancement for Matt Mitchell...")
    
    # Load ML model for baseline enhancement
    print("🤖 Loading ML baseline model...")
    ml_model, ml_metadata = load_ml_baseline_model()
    if ml_model:
        print(f"✓ Loaded model: {ml_metadata['model_id']}")
    else:
        print("⚠️  No ML model available - using traditional method")
    
    # Get envelope data
    envelope_response = supabase.table('performance_envelopes')\
        .select('*')\
        .order('day_since_published')\
        .execute()
    
    envelope_data = envelope_response.data
    days = np.array([e['day_since_published'] for e in envelope_data])
    p50_global = np.array([e['p50_views'] for e in envelope_data])
    
    # Get all Matt Mitchell videos
    matt_videos = supabase.table('videos')\
        .select('*')\
        .eq('channel_name', 'Matt Mitchell')\
        .execute()
    
    print(f"✓ Found {len(matt_videos.data)} videos")
    
    # Categorize videos by tracking quality
    early_tracked = []  # Has snapshots in first 30 days
    late_tracked = []   # Only has snapshots after 30 days
    
    for video in matt_videos.data:
        snapshots = supabase.table('view_snapshots')\
            .select('*')\
            .eq('video_id', video['id'])\
            .order('days_since_published')\
            .execute()
        
        if snapshots.data:
            earliest_day = min(s['days_since_published'] for s in snapshots.data)
            video['snapshots'] = snapshots.data
            video['earliest_tracking'] = earliest_day
            
            if earliest_day <= 30:
                early_tracked.append(video)
            else:
                late_tracked.append(video)
    
    print(f"\n📊 Tracking Analysis:")
    print(f"   Early tracked (≤30 days): {len(early_tracked)} videos")
    print(f"   Late tracked (>30 days): {len(late_tracked)} videos")
    
    # Calculate baseline - try early tracking first, then ML enhancement
    global_baseline = p50_global[1] if len(p50_global) > 1 else 8478
    ml_multiplier = 1.0
    
    if early_tracked:
        print(f"\n✅ Using {len(early_tracked)} early-tracked videos for baseline:")
        
        early_views = []
        for video in early_tracked:
            # Get first-week views
            first_week = [s for s in video['snapshots'] if s['days_since_published'] <= 7]
            if first_week:
                early_views.extend([s['view_count'] for s in first_week])
                print(f"   {video['title'][:40]:40} - {len(first_week)} early snapshots")
        
        if early_views:
            traditional_baseline = np.median(early_views)
            print(f"\n✓ Traditional baseline from early data: {traditional_baseline:,.0f} views")
            
            # Enhance with ML if model is available
            if ml_model and len(matt_videos.data) > 0:
                print("\n🤖 Enhancing baseline with ML predictions...")
                channel_chars = get_channel_characteristics_for_ml('Matt Mitchell', matt_videos.data)
                ml_baseline, ml_multiplier = generate_ml_baseline(channel_chars, ml_model, ml_metadata, global_baseline)
                
                # Blend traditional and ML baselines (60% traditional, 40% ML)
                channel_baseline = traditional_baseline * 0.6 + ml_baseline * 0.4
                print(f"   Blended baseline (60% traditional + 40% ML): {channel_baseline:,.0f} views")
            else:
                channel_baseline = traditional_baseline
        else:
            # No first-week data but have early-tracked videos - use ML if available
            if ml_model and len(matt_videos.data) > 0:
                print(f"\n🤖 No first-week data - using ML baseline prediction...")
                channel_chars = get_channel_characteristics_for_ml('Matt Mitchell', matt_videos.data)
                channel_baseline, ml_multiplier = generate_ml_baseline(channel_chars, ml_model, ml_metadata, global_baseline)
            else:
                channel_baseline = 50000  # Reasonable default
                print(f"\n⚠️  No first-week data, using default: {channel_baseline:,.0f} views")
    else:
        # No early tracked videos - use ML if available, otherwise estimate from late data
        if ml_model and len(matt_videos.data) > 0:
            print("\n🤖 NO early-tracked videos! Using ML baseline prediction...")
            channel_chars = get_channel_characteristics_for_ml('Matt Mitchell', matt_videos.data)
            channel_baseline, ml_multiplier = generate_ml_baseline(channel_chars, ml_model, ml_metadata, global_baseline)
        else:
            print("\n⚠️  NO early-tracked videos! Estimating from plateau values...")
            
            # Use plateau values and work backwards
            plateau_views = []
            for video in late_tracked[:20]:  # Sample some videos
                if video['snapshots']:
                    latest = video['snapshots'][-1]
                    plateau_views.append(latest['view_count'])
            
            if plateau_views:
                # Rough estimate: Day 1 is typically 5-10% of plateau
                median_plateau = np.median(plateau_views)
                channel_baseline = median_plateau * 0.07
                print(f"   Median plateau: {median_plateau:,.0f} views")
                print(f"   Estimated baseline (7% of plateau): {channel_baseline:,.0f} views")
            else:
                channel_baseline = 50000
    
    # Calculate scale factor
    global_baseline = p50_global[1] if len(p50_global) > 1 else 8478
    scale_factor = channel_baseline / global_baseline
    
    print(f"\n📊 Final Parameters:")
    print(f"   Channel baseline: {channel_baseline:,.0f} views")
    print(f"   Global baseline: {global_baseline:,.0f} views")
    print(f"   Scale factor: {scale_factor:.2f}x")
    if ml_model:
        print(f"   ML multiplier: {ml_multiplier:.2f}x")
        print(f"   Method: {'ML-enhanced' if len(early_tracked) > 0 else 'ML-only'}")
    else:
        print(f"   Method: Traditional (no ML model)")
    
    # Create visualization
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(18, 8))
    
    # Left plot: Early vs Late tracked videos
    p50_scaled = p50_global * scale_factor
    lower_band = p50_scaled * 0.7
    upper_band = p50_scaled * 1.3
    
    ax1.fill_between(days, lower_band, upper_band, 
                    alpha=0.2, color='gray', label='Expected Range')
    ax1.plot(days, p50_scaled, '-', color='black', 
            linewidth=2, label='Expected (smart baseline)', alpha=0.8)
    
    # Plot early-tracked videos
    for video in early_tracked[:10]:  # Show up to 10
        if video['snapshots']:
            v_days = [s['days_since_published'] for s in video['snapshots']]
            v_views = [s['view_count'] for s in video['snapshots']]
            ax1.plot(v_days, v_views, 'o-', alpha=0.7, markersize=6)
    
    ax1.set_title(f'Early-Tracked Videos (First snapshot ≤30 days)\n'
                  f'{len(early_tracked)} videos with growth data', fontsize=12)
    ax1.set_xlabel('Days Since Published')
    ax1.set_ylabel('Views')
    ax1.set_xlim(-5, 120)
    ax1.set_ylim(0, 500000)
    ax1.grid(True, alpha=0.3)
    ax1.legend()
    
    # Right plot: Late-tracked videos
    ax2.fill_between(days, lower_band, upper_band, 
                    alpha=0.2, color='gray')
    ax2.plot(days, p50_scaled, '-', color='black', 
            linewidth=2, alpha=0.8)
    
    # Plot late-tracked videos
    for video in late_tracked[:20]:  # Show up to 20
        if video['snapshots']:
            v_days = [s['days_since_published'] for s in video['snapshots']]
            v_views = [s['view_count'] for s in video['snapshots']]
            ax2.scatter(v_days, v_views, alpha=0.5, s=30, color='red')
    
    ax2.set_title(f'Late-Tracked Videos (First snapshot >30 days)\n'
                  f'{len(late_tracked)} videos - mostly plateaued!', fontsize=12)
    ax2.set_xlabel('Days Since Published')
    ax2.set_ylabel('Views')
    ax2.set_xlim(-50, 2200)
    ax2.set_ylim(0, 2000000)
    ax2.grid(True, alpha=0.3)
    
    # Format y-axes
    for ax in [ax1, ax2]:
        ax.yaxis.set_major_formatter(plt.FuncFormatter(
            lambda x, p: f'{x/1000:.0f}K' if x < 1000000 else f'{x/1000000:.1f}M'
        ))
    
    method_str = "ML-Enhanced" if ml_model else "Traditional"
    fig.suptitle(f'Matt Mitchell Channel: {method_str} Baseline Calculation\n'
                 f'Channel baseline: {channel_baseline:,.0f} views (scale factor: {scale_factor:.2f}x)',
                 fontsize=14)
    
    plt.tight_layout()
    
    # Save
    output_path = 'smart_baseline_analysis.png'
    plt.savefig(output_path, dpi=300, bbox_inches='tight')
    print(f"\n💾 Saved to: {output_path}")
    
    # Summary insights
    print("\n🔍 KEY INSIGHTS:")
    print(f"1. Only {len(early_tracked)}/{len(matt_videos.data)} videos have early tracking")
    print(f"2. {len(late_tracked)} videos are tracked too late to assess growth")
    if ml_model:
        print("3. ML model provides baseline predictions when early data is sparse")
        print(f"4. Final baseline uses {('ML-enhanced' if len(early_tracked) > 0 else 'ML-only')} calculation")
        print(f"5. ML multiplier: {ml_multiplier:.2f}x applied to global baseline")
    else:
        print("3. Late-tracked videos will ALWAYS appear to underperform")
        print("4. The system works best with early tracking data")
    print(f"\n💡 SOLUTION: {'ML predictions enhance' if ml_model else 'Focus on'} performance analysis {'with' if ml_model else 'on videos with'} early snapshots")

if __name__ == "__main__":
    smart_baseline_calculation()