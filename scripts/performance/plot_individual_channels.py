#!/usr/bin/env python3
"""
Create individual channel graphs to examine performance distribution
"""

import os
import numpy as np
import matplotlib.pyplot as plt
from supabase import create_client, Client
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Initialize Supabase client
url = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
supabase: Client = create_client(url, key)

print("📊 Individual Channel Performance Analysis")
print("=" * 60)

# Get global curve data
global_result = supabase.table('performance_envelopes')\
    .select('day_since_published, p50_views')\
    .lte('day_since_published', 365)\
    .order('day_since_published')\
    .execute()

global_curve = {row['day_since_published']: row['p50_views'] for row in global_result.data}
global_plateau = global_curve[365]

# Function to get real video data for a channel
def get_channel_videos(channel_name, limit=50):
    print(f"📥 Fetching videos for {channel_name}...")
    
    # Get videos
    videos_result = supabase.table('videos')\
        .select('id, title, view_count, published_at')\
        .eq('channel_name', channel_name)\
        .not_.is_('view_count', 'null')\
        .gte('view_count', 100)\
        .order('published_at', desc=False)\
        .limit(limit)\
        .execute()
    
    videos = []
    for video in videos_result.data:
        try:
            from datetime import datetime
            pub_date = datetime.fromisoformat(video['published_at'].replace('Z', '+00:00'))
            days_old = (datetime.now(pub_date.tzinfo) - pub_date).days
            
            if 30 <= days_old <= 365:  # Focus on mature videos
                videos.append({
                    'title': video['title'],
                    'views': video['view_count'],
                    'days': days_old
                })
        except:
            continue
    
    print(f"   Found {len(videos)} videos aged 30-365 days")
    return videos

# Function to calculate plateau baseline
def get_channel_plateau(channel_name):
    plateau_result = supabase.table('videos')\
        .select('view_count')\
        .eq('channel_name', channel_name)\
        .not_.is_('view_count', 'null')\
        .execute()
    
    if not plateau_result.data:
        return None
        
    # Calculate plateau from all videos (simple approach)
    views = [v['view_count'] for v in plateau_result.data if v['view_count'] > 0]
    if len(views) < 10:
        return None
        
    # Use median of all videos as plateau estimate
    plateau = np.percentile(views, 50)
    return plateau

# Test channels
test_channels = [
    'Marques Brownlee',
    'Alex Hormozi', 
    'KUMA FURNITURE',
    'Thomas DeLauer'  # Let's add another medium channel
]

# Create subplots
fig, axes = plt.subplots(2, 2, figsize=(20, 16))
axes = axes.flatten()

all_ratios = []  # Collect all ratios to check distribution

for i, channel_name in enumerate(test_channels):
    ax = axes[i]
    
    # Get channel data
    videos = get_channel_videos(channel_name, 100)
    plateau = get_channel_plateau(channel_name)
    
    if not videos or not plateau:
        ax.text(0.5, 0.5, f'Insufficient data for\n{channel_name}', 
                ha='center', va='center', transform=ax.transAxes, fontsize=14)
        ax.set_title(f'{channel_name} - No Data')
        continue
    
    scale_factor = plateau / global_plateau
    
    # Plot global curve
    days = np.array(list(range(30, 366)))
    global_views = np.array([global_curve.get(d, 0) for d in days])
    
    # Plot expected curve for this channel
    expected_curve = global_views * scale_factor
    ax.plot(days, expected_curve, 'k-', linewidth=3, label=f'Expected ({scale_factor:.2f}x global)', alpha=0.8)
    
    # Performance bands around expected curve
    ax.fill_between(days, expected_curve * 0.5, expected_curve * 1.5, alpha=0.2, color='green', label='On Track (0.5-1.5x)')
    ax.fill_between(days, expected_curve * 1.5, expected_curve * 3.0, alpha=0.2, color='orange', label='Outperforming (1.5-3x)')
    ax.fill_between(days, expected_curve * 3.0, expected_curve * 10, alpha=0.2, color='red', label='Viral (>3x)')
    ax.fill_between(days, expected_curve * 0.2, expected_curve * 0.5, alpha=0.2, color='yellow', label='Underperforming (0.2-0.5x)')
    ax.fill_between(days, expected_curve * 0.01, expected_curve * 0.2, alpha=0.2, color='red', label='Poor (<0.2x)')
    
    # Plot actual videos
    video_days = [v['days'] for v in videos]
    video_views = [v['views'] for v in videos]
    
    # Calculate ratios for each video
    ratios = []
    colors = []
    for video in videos:
        expected = global_curve.get(video['days'], 0) * scale_factor
        ratio = video['views'] / expected if expected > 0 else 0
        ratios.append(ratio)
        all_ratios.append(ratio)
        
        # Color by performance
        if ratio > 3.0:
            colors.append('red')
        elif ratio >= 1.5:
            colors.append('orange')  
        elif ratio >= 0.5:
            colors.append('green')
        elif ratio >= 0.2:
            colors.append('yellow')
        else:
            colors.append('darkred')
    
    ax.scatter(video_days, video_views, c=colors, s=50, alpha=0.7, edgecolors='black', linewidth=0.5)
    
    # Set scale and labels
    ax.set_yscale('log')
    ax.set_xlabel('Days Since Published')
    ax.set_ylabel('View Count')
    ax.set_title(f'{channel_name}\nPlateau: {plateau:,.0f} views, Scale: {scale_factor:.3f}x')
    ax.grid(True, alpha=0.3)
    ax.legend(fontsize=8, loc='upper left')
    
    # Stats text
    below_half = sum(1 for r in ratios if r < 0.5)
    above_1_5 = sum(1 for r in ratios if r > 1.5)
    on_track = len(ratios) - below_half - above_1_5
    
    stats_text = f'Videos: {len(videos)}\nUnderperforming: {below_half} ({below_half/len(ratios)*100:.1f}%)\nOn Track: {on_track} ({on_track/len(ratios)*100:.1f}%)\nOutperforming+: {above_1_5} ({above_1_5/len(ratios)*100:.1f}%)\nMedian Ratio: {np.median(ratios):.2f}x'
    
    ax.text(0.02, 0.98, stats_text, transform=ax.transAxes, fontsize=9, 
            verticalalignment='top', bbox=dict(boxstyle='round', facecolor='white', alpha=0.8))

plt.tight_layout()
plt.savefig('individual_channel_analysis.png', dpi=300, bbox_inches='tight')
print(f"\n✅ Individual channel plots saved as 'individual_channel_analysis.png'")

# Overall distribution analysis
print(f"\n📊 Overall Performance Distribution Analysis:")
print(f"Total videos analyzed: {len(all_ratios)}")
print(f"Median ratio: {np.median(all_ratios):.2f}x")
print(f"Mean ratio: {np.mean(all_ratios):.2f}x")

# Distribution breakdown
viral = sum(1 for r in all_ratios if r > 3.0)
outperforming = sum(1 for r in all_ratios if 1.5 <= r <= 3.0)
on_track = sum(1 for r in all_ratios if 0.5 <= r <= 1.5)
underperforming = sum(1 for r in all_ratios if 0.2 <= r < 0.5)
poor = sum(1 for r in all_ratios if r < 0.2)

print(f"\nPerformance Categories:")
print(f"  Viral (>3x):           {viral:3d} ({viral/len(all_ratios)*100:5.1f}%)")
print(f"  Outperforming (1.5-3x): {outperforming:3d} ({outperforming/len(all_ratios)*100:5.1f}%)")
print(f"  On Track (0.5-1.5x):    {on_track:3d} ({on_track/len(all_ratios)*100:5.1f}%)")
print(f"  Underperforming (0.2-0.5x): {underperforming:3d} ({underperforming/len(all_ratios)*100:5.1f}%)")
print(f"  Poor (<0.2x):          {poor:3d} ({poor/len(all_ratios)*100:5.1f}%)")

print(f"\n🚨 Issues Detected:")
if np.median(all_ratios) > 1.5:
    print(f"   ⚠️  Median ratio {np.median(all_ratios):.2f}x is too high (should be ~1.0x)")
if underperforming + poor < len(all_ratios) * 0.2:
    print(f"   ⚠️  Too few underperforming videos ({(underperforming + poor)/len(all_ratios)*100:.1f}% vs expected ~25%)")
if viral + outperforming > len(all_ratios) * 0.5:
    print(f"   ⚠️  Too many overperforming videos ({(viral + outperforming)/len(all_ratios)*100:.1f}% vs expected ~25%)")

print(f"\n🔍 Possible Causes:")
print(f"   • Plateau calculation may be biased upward")
print(f"   • Sample bias (only tracking successful videos?)")
print(f"   • Global curve may not reflect true baseline")
print(f"   • Channel scaling method needs adjustment")