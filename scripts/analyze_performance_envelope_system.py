#!/usr/bin/env python3
"""
Analyze performance envelope system with real videos at different ages
from small, medium, and large channels
"""

import os
import matplotlib.pyplot as plt
import numpy as np
from supabase import create_client, Client
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Initialize Supabase client
url = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
supabase: Client = create_client(url, key)

def get_channel_baseline(channel_id):
    """Get channel baseline with confidence scoring"""
    # Get videos from this channel
    videos_response = supabase.table('videos')\
        .select('id')\
        .eq('channel_id', channel_id)\
        .execute()
    
    if not videos_response.data:
        return None, 0
    
    video_ids = [v['id'] for v in videos_response.data]
    
    # Get first-week snapshots
    snapshots = supabase.table('view_snapshots')\
        .select('view_count')\
        .in_('video_id', video_ids)\
        .lte('days_since_published', 7)\
        .execute()
    
    if not snapshots.data or len(snapshots.data) < 5:
        return None, 0
    
    # Calculate trimmed median
    views = sorted([s['view_count'] for s in snapshots.data])
    trim_start = int(len(views) * 0.1)
    trim_end = int(len(views) * 0.9)
    trimmed = views[trim_start:trim_end] if trim_end > trim_start else views
    
    median = trimmed[len(trimmed)//2] if trimmed else None
    confidence = min(len(snapshots.data) / 30, 1.0)
    
    return median, confidence

def find_diverse_examples():
    """Find videos at different ages from different channel sizes"""
    examples = {
        'young': [],      # 0-30 days
        'medium_age': [], # 31-180 days  
        'old': []         # 180+ days
    }
    
    channel_sizes = {
        'small': (1000, 50000),      # Small channels
        'medium': (50000, 500000),   # Medium channels
        'large': (500000, 10000000)  # Large channels
    }
    
    print("🔍 Finding diverse video examples...")
    
    for size_name, (min_views, max_views) in channel_sizes.items():
        print(f"\n📊 Searching {size_name} channels ({min_views:,} - {max_views:,} views)...")
        
        # Get channels in this size range
        channels_query = supabase.table('videos')\
            .select('channel_id, channel_name')\
            .gte('view_count', min_views)\
            .lte('view_count', max_views)\
            .execute()
        
        unique_channels = {}
        for v in channels_query.data:
            if v['channel_id'] not in unique_channels:
                unique_channels[v['channel_id']] = v['channel_name']
        
        # For each channel, find videos at different ages
        for channel_id, channel_name in list(unique_channels.items())[:10]:
            # Get videos with snapshots
            videos = supabase.table('videos')\
                .select('id, title, view_count, published_at')\
                .eq('channel_id', channel_id)\
                .execute()
            
            for video in videos.data:
                # Get snapshots
                snapshots = supabase.table('view_snapshots')\
                    .select('*')\
                    .eq('video_id', video['id'])\
                    .order('days_since_published')\
                    .execute()
                
                if len(snapshots.data) >= 3:
                    latest_day = snapshots.data[-1]['days_since_published']
                    
                    example = {
                        'video_id': video['id'],
                        'title': video['title'],
                        'channel_id': channel_id,
                        'channel_name': channel_name,
                        'channel_size': size_name,
                        'current_views': video['view_count'],
                        'snapshots': snapshots.data,
                        'latest_day': latest_day
                    }
                    
                    if latest_day <= 30 and len(examples['young']) < 3:
                        examples['young'].append(example)
                    elif 31 <= latest_day <= 180 and len(examples['medium_age']) < 3:
                        examples['medium_age'].append(example)
                    elif latest_day > 180 and len(examples['old']) < 3:
                        examples['old'].append(example)
    
    return examples

def create_comprehensive_analysis():
    """Create comprehensive analysis of performance envelope system"""
    
    # Get envelope data (full 365 days)
    envelope_response = supabase.table('performance_envelopes')\
        .select('*')\
        .lte('day_since_published', 365)\
        .order('day_since_published')\
        .execute()
    
    envelope_data = envelope_response.data
    days = np.array([e['day_since_published'] for e in envelope_data])
    p50_global = np.array([e['p50_views'] for e in envelope_data])
    
    # Find diverse examples
    examples = find_diverse_examples()
    
    # Create figure with subplots
    fig, axes = plt.subplots(3, 3, figsize=(18, 15))
    fig.suptitle('YouTube Performance Envelope Analysis - Real Videos at Different Ages\nSmall, Medium, and Large Channels', 
                 fontsize=16, y=0.98)
    
    # Calculate global baseline
    global_baseline = p50_global[1] if len(p50_global) > 1 else 8478
    
    plot_idx = 0
    for age_group in ['young', 'medium_age', 'old']:
        for video in examples[age_group][:3]:
            row = plot_idx // 3
            col = plot_idx % 3
            ax = axes[row, col]
            
            # Get channel baseline
            channel_baseline, confidence = get_channel_baseline(video['channel_id'])
            if not channel_baseline:
                # Use global baseline with channel size adjustment
                if video['channel_size'] == 'small':
                    channel_baseline = global_baseline * 0.5
                elif video['channel_size'] == 'medium':
                    channel_baseline = global_baseline * 2
                else:
                    channel_baseline = global_baseline * 10
            
            # Scale envelope to channel
            scale_factor = channel_baseline / global_baseline
            p50_scaled = p50_global * scale_factor
            lower_band = p50_scaled * 0.7
            upper_band = p50_scaled * 1.3
            
            # Plot full envelope (0-365 days)
            ax.fill_between(days, lower_band, upper_band, 
                           alpha=0.2, color='gray', 
                           label='Expected Range (±30%)')
            ax.plot(days, p50_scaled, '--', color='black', 
                   linewidth=1.5, label='Expected', alpha=0.7)
            
            # Extract video data
            video_days = [s['days_since_published'] for s in video['snapshots']]
            video_views = [s['view_count'] for s in video['snapshots']]
            
            # Calculate performance ratio at latest snapshot
            latest_idx = -1
            latest_day = video_days[latest_idx]
            latest_views = video_views[latest_idx]
            
            if latest_day < len(p50_scaled):
                expected_views = p50_scaled[latest_day]
            else:
                # Extrapolate beyond 365 days
                expected_views = p50_scaled[-1] * (1 + (latest_day - 365) * 0.001)
            
            performance_ratio = latest_views / expected_views if expected_views > 0 else 0
            
            # Determine color based on performance
            if performance_ratio > 3.0:
                color = '#FF1493'
                category = 'Viral'
            elif performance_ratio > 1.5:
                color = '#00C851'
                category = 'Outperforming'
            elif performance_ratio > 0.5:
                color = '#33B5E5'
                category = 'On Track'
            else:
                color = '#FF8800'
                category = 'Under'
            
            # Plot video snapshots
            ax.scatter(video_days, video_views, s=100, color=color, 
                      zorder=5, label=f'{category} ({performance_ratio:.1f}x)')
            ax.plot(video_days, video_views, ':', color=color, alpha=0.5)
            
            # Title and labels
            title = f"{video['channel_size'].title()} Channel: {video['channel_name'][:20]}\n"
            title += f"Video Age: Day {latest_day} | {latest_views:,} views"
            ax.set_title(title, fontsize=10)
            
            # Format axes
            ax.set_xlabel('Days Since Published', fontsize=8)
            ax.set_ylabel('Views', fontsize=8)
            ax.set_xlim(-5, 370)
            
            # Set y limits based on data
            max_y = max(max(video_views) * 1.2, max(upper_band[:latest_day+1]) * 1.2) if latest_day < len(upper_band) else max(video_views) * 1.2
            ax.set_ylim(0, max_y)
            
            # Format y-axis
            ax.yaxis.set_major_formatter(plt.FuncFormatter(
                lambda x, p: f'{x/1000:.0f}K' if x < 1000000 else f'{x/1000000:.1f}M'
            ))
            
            # Add performance annotation
            ax.text(0.02, 0.98, f'{performance_ratio:.1f}x', 
                   transform=ax.transAxes,
                   bbox=dict(boxstyle='round', facecolor=color, alpha=0.8),
                   fontsize=12, color='white', weight='bold',
                   verticalalignment='top')
            
            # Grid
            ax.grid(True, alpha=0.3)
            ax.tick_params(labelsize=8)
            
            # Add legend only for first plot
            if plot_idx == 0:
                ax.legend(loc='upper left', fontsize=8)
            
            plot_idx += 1
    
    plt.tight_layout()
    
    # Save
    output_path = 'performance_envelope_analysis.png'
    plt.savefig(output_path, dpi=300, bbox_inches='tight')
    print(f"\n💾 Analysis saved to: {output_path}")
    
    # Print analysis summary
    print("\n📊 ANALYSIS SUMMARY:")
    print("="*60)
    
    for age_group, videos in examples.items():
        if videos:
            print(f"\n{age_group.upper().replace('_', ' ')} VIDEOS:")
            for v in videos:
                latest = v['snapshots'][-1]
                print(f"  • {v['channel_size'].title()}: {v['channel_name'][:30]}")
                print(f"    Video: {v['title'][:50]}...")
                print(f"    Age: Day {latest['days_since_published']}, Views: {latest['view_count']:,}")
                print(f"    Snapshots: {len(v['snapshots'])}")
    
    return examples

def verify_system_integrity():
    """Verify the performance envelope system is working correctly"""
    print("\n🔍 SYSTEM INTEGRITY CHECK:")
    print("="*60)
    
    # Check 1: Envelope monotonicity
    envelope = supabase.table('performance_envelopes')\
        .select('day_since_published, p50_views')\
        .order('day_since_published')\
        .execute()
    
    p50_values = [e['p50_views'] for e in envelope.data]
    is_monotonic = all(p50_values[i] <= p50_values[i+1] for i in range(len(p50_values)-1))
    print(f"✓ Envelope monotonicity: {'PASS' if is_monotonic else 'FAIL'}")
    
    # Check 2: Channel baseline calculations
    test_channels = supabase.table('videos')\
        .select('channel_id, channel_name')\
        .limit(5)\
        .execute()
    
    baseline_count = 0
    for ch in test_channels.data:
        baseline, conf = get_channel_baseline(ch['channel_id'])
        if baseline:
            baseline_count += 1
    
    print(f"✓ Channel baselines: {baseline_count}/5 channels have baselines")
    
    # Check 3: Performance ratio distribution
    print(f"✓ Global median growth: Day 0: {p50_values[0]:,} → Day 365: {p50_values[-1]:,}")
    print(f"✓ Growth multiplier: {p50_values[-1]/p50_values[1]:.1f}x over 1 year")

if __name__ == "__main__":
    examples = create_comprehensive_analysis()
    verify_system_integrity()