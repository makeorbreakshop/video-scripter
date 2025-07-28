#!/usr/bin/env python3
"""
Simple plateau-based scaling
Just scale based on where videos actually plateau
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

def simple_plateau_scaling():
    """Scale curve based on plateau values"""
    
    print("📊 Simple plateau-based scaling for Matt Mitchell...")
    
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
    
    # Get plateau values (latest snapshot for each video)
    plateau_values = []
    for video in matt_videos.data:
        snapshots = supabase.table('view_snapshots')\
            .select('*')\
            .eq('video_id', video['id'])\
            .order('days_since_published', desc=True)\
            .limit(1)\
            .execute()
        
        if snapshots.data:
            latest = snapshots.data[0]
            # Only use if it's old enough to be plateaued (>90 days)
            if latest['days_since_published'] > 90:
                plateau_values.append({
                    'views': latest['view_count'],
                    'day': latest['days_since_published'],
                    'title': video['title']
                })
    
    print(f"✓ Found {len(plateau_values)} plateaued videos (>90 days old)")
    
    # Calculate median plateau
    median_plateau = np.median([p['views'] for p in plateau_values])
    
    # What does the global curve say at day 365 (typical plateau)?
    global_plateau = p50_global[min(365, len(p50_global)-1)]
    
    # Simple scale factor
    scale_factor = median_plateau / global_plateau
    
    print(f"\n✅ SIMPLE SCALING:")
    print(f"   Median plateau: {median_plateau:,.0f} views")
    print(f"   Global plateau: {global_plateau:,.0f} views") 
    print(f"   Scale factor: {scale_factor:.2f}x")
    
    # Apply scale to entire curve
    p50_scaled = p50_global * scale_factor
    lower_band = p50_scaled * 0.7
    upper_band = p50_scaled * 1.3
    
    # Create visualization
    plt.figure(figsize=(16, 10))
    
    # Plot envelope
    plt.fill_between(days, lower_band, upper_band, 
                    alpha=0.2, color='gray', 
                    label='Expected Range (±30%)')
    plt.plot(days, p50_scaled, '-', color='black', 
            linewidth=2, label=f'Expected (scale={scale_factor:.1f}x)', alpha=0.8)
    
    # Get ALL snapshots to show the full picture
    all_snapshots = []
    for video in matt_videos.data:
        snapshots = supabase.table('view_snapshots')\
            .select('*')\
            .eq('video_id', video['id'])\
            .execute()
        
        for snap in snapshots.data:
            snap['video_title'] = video['title']
        all_snapshots.extend(snapshots.data)
    
    # Plot all snapshots colored by performance
    for snapshot in all_snapshots:
        day = snapshot['days_since_published']
        views = snapshot['view_count']
        
        # Get expected at this day
        if day < len(p50_scaled):
            expected = p50_scaled[day]
        else:
            expected = p50_scaled[-1]
        
        ratio = views / expected if expected > 0 else 0
        
        # Color based on performance
        if ratio > 1.3:
            color = '#00C851'  # Green - overperforming
        elif ratio > 0.7:
            color = '#33B5E5'  # Blue - normal
        else:
            color = '#FF8800'  # Orange - underperforming
        
        plt.scatter(day, views, s=20, c=color, alpha=0.6)
    
    # Add title
    plt.title(f'Simple Plateau-Based Scaling for Matt Mitchell\\n'
              f'Median plateau: {median_plateau:,.0f} views | Scale: {scale_factor:.1f}x global curve', 
              fontsize=14)
    plt.xlabel('Days Since Published')
    plt.ylabel('Views')
    
    # Format y-axis
    plt.gca().yaxis.set_major_formatter(plt.FuncFormatter(
        lambda x, p: f'{x/1000:.0f}K' if x < 1000000 else f'{x/1000000:.1f}M'
    ))
    
    plt.xlim(-10, 400)
    plt.ylim(0, 1000000)
    plt.grid(True, alpha=0.3)
    
    # Legend
    from matplotlib.patches import Patch
    legend_elements = [
        Patch(facecolor='gray', alpha=0.2, label='Expected Range'),
        plt.Line2D([0], [0], color='black', lw=2, label='Expected Performance'),
        plt.scatter([], [], c='#00C851', s=40, label='Overperforming (>1.3x)'),
        plt.scatter([], [], c='#33B5E5', s=40, label='Normal (0.7-1.3x)'),
        plt.scatter([], [], c='#FF8800', s=40, label='Underperforming (<0.7x)')
    ]
    plt.legend(handles=legend_elements, loc='upper left')
    
    plt.tight_layout()
    
    # Save
    output_path = 'simple_plateau_scaling.png'
    plt.savefig(output_path, dpi=300, bbox_inches='tight')
    print(f"\n💾 Saved to: {output_path}")
    
    # Analyze performance distribution
    ratios = []
    for snapshot in all_snapshots:
        day = snapshot['days_since_published']
        views = snapshot['view_count']
        
        if day < len(p50_scaled):
            expected = p50_scaled[day]
        else:
            expected = p50_scaled[-1]
        
        if expected > 0:
            ratios.append(views / expected)
    
    print(f"\n📊 PERFORMANCE WITH SIMPLE SCALING:")
    print(f"   Median ratio: {np.median(ratios):.2f}x")
    print(f"   Overperforming: {sum(1 for r in ratios if r > 1.3)} snapshots")
    print(f"   Normal: {sum(1 for r in ratios if 0.7 <= r <= 1.3)} snapshots")
    print(f"   Underperforming: {sum(1 for r in ratios if r < 0.7)} snapshots")

if __name__ == "__main__":
    simple_plateau_scaling()