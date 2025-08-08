#!/usr/bin/env python3

"""
Simple Realistic Video Backfill
Uses realistic interpolation/extrapolation instead of buggy ML predictions
"""

import json
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
from datetime import datetime
import warnings
warnings.filterwarnings('ignore')

class SimpleRealisticBackfiller:
    def load_channel_data(self, channel_name="I Like To Make Stuff"):
        """Load data for specific channel"""
        print(f"📊 Loading data for channel: {channel_name}...")
        
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
        
        # Filter to specific channel
        channel_data = df[df['channel_name'] == channel_name].copy()
        
        if len(channel_data) == 0:
            print(f"❌ No data found for {channel_name}")
            return None
        
        print(f"✅ Found {len(channel_data)} snapshots from {channel_data['video_id'].nunique()} videos")
        return channel_data
    
    def get_last_10_videos(self, channel_data):
        """Get last 10 videos from channel"""
        print("📹 Getting last 10 videos for backfill...")
        
        video_groups = []
        for video_id in channel_data['video_id'].unique():
            video_data = channel_data[channel_data['video_id'] == video_id]
            video_groups.append({
                'video_id': video_id,
                'title': video_data['title'].iloc[0],
                'snapshots': len(video_data),
                'max_views': video_data['view_count'].max(),
                'data': video_data.sort_values('days_since_published')
            })
        
        # Sort by max views as proxy for recent/popular videos
        video_groups.sort(key=lambda x: x['max_views'], reverse=True)
        
        # Take top 10 videos with at least 2 snapshots
        last_10_videos = []
        for video_group in video_groups:
            if len(video_group['data']) >= 2:
                last_10_videos.append(video_group)
                if len(last_10_videos) >= 10:
                    break
        
        print(f"🎯 Selected {len(last_10_videos)} videos:")
        for i, video in enumerate(last_10_videos):
            print(f"   {i+1}. {video['title'][:50]}... ({video['snapshots']} snapshots)")
        
        return last_10_videos
    
    def realistic_backfill_video(self, video_data):
        """Create realistic backfill using simple interpolation/extrapolation"""
        if len(video_data) < 2:
            return pd.DataFrame()
        
        # Sort by days
        video_data = video_data.sort_values('days_since_published')
        actual_days = video_data['days_since_published'].tolist()
        actual_views = video_data['view_count'].tolist()
        
        # Create complete progression
        progression = []
        
        for day in range(1, 91):
            if day in actual_days:
                # Use actual data
                idx = actual_days.index(day)
                views = actual_views[idx]
                data_type = 'actual'
            else:
                # Interpolate or extrapolate
                views = self.estimate_views_for_day(day, actual_days, actual_views)
                data_type = 'predicted'
            
            progression.append({
                'video_id': video_data['video_id'].iloc[0],
                'title': video_data['title'].iloc[0],
                'days_since_published': day,
                'views': views,
                'data_type': data_type
            })
        
        return pd.DataFrame(progression)
    
    def estimate_views_for_day(self, target_day, actual_days, actual_views):
        """Estimate views for target day using realistic growth patterns"""
        
        # If target is before first actual point, extrapolate backwards
        if target_day < actual_days[0]:
            first_day = actual_days[0]
            first_views = actual_views[0]
            
            # Assume early exponential growth
            if first_day > 1:
                # Early growth rate estimate
                early_growth = first_views / first_day
                return max(early_growth * target_day, 1000)
            else:
                return first_views
        
        # If target is after last actual point, extrapolate forwards
        elif target_day > actual_days[-1]:
            if len(actual_days) >= 2:
                # Use last two points to estimate growth rate
                last_day = actual_days[-1]
                last_views = actual_views[-1]
                prev_day = actual_days[-2]
                prev_views = actual_views[-2]
                
                # Calculate growth rate
                days_diff = last_day - prev_day
                views_ratio = last_views / prev_views if prev_views > 0 else 1.1
                daily_growth = views_ratio ** (1.0 / days_diff)
                
                # Apply diminishing returns for long extrapolation
                days_beyond = target_day - last_day
                decay_factor = np.exp(-days_beyond / 30.0)  # Slower growth over time
                growth_factor = 1 + (daily_growth - 1) * decay_factor
                
                return last_views * (growth_factor ** days_beyond)
            else:
                return actual_views[-1]
        
        # Target is between actual points - interpolate
        else:
            # Find surrounding points
            prev_idx = None
            next_idx = None
            
            for i, day in enumerate(actual_days):
                if day < target_day:
                    prev_idx = i
                elif day > target_day and next_idx is None:
                    next_idx = i
                    break
            
            if prev_idx is not None and next_idx is not None:
                prev_day = actual_days[prev_idx]
                next_day = actual_days[next_idx]
                prev_views = actual_views[prev_idx]
                next_views = actual_views[next_idx]
                
                # Linear interpolation in log space for realistic growth
                progress = (target_day - prev_day) / (next_day - prev_day)
                log_prev = np.log1p(prev_views)
                log_next = np.log1p(next_views)
                log_interpolated = log_prev + progress * (log_next - log_prev)
                
                return np.expm1(log_interpolated)
            
            # Fallback
            return actual_views[0]
    
    def create_envelope_from_videos(self, all_progressions):
        """Create envelope from video progressions"""
        print("📊 Creating envelope from backfilled videos...")
        
        all_data = pd.concat(all_progressions, ignore_index=True)
        
        envelope_data = []
        for day in range(1, 91):
            day_views = all_data[all_data['days_since_published'] == day]['views']
            if len(day_views) >= 3:
                envelope_data.append({
                    'day': day,
                    'p10': np.percentile(day_views, 10),
                    'p50': np.percentile(day_views, 50),
                    'p90': np.percentile(day_views, 90),
                    'count': len(day_views)
                })
        
        envelope_df = pd.DataFrame(envelope_data)
        
        print(f"✅ Created envelope with {len(envelope_df)} days")
        print(f"   P10: {envelope_df['p10'].min():,.0f} - {envelope_df['p10'].max():,.0f}")
        print(f"   P50: {envelope_df['p50'].min():,.0f} - {envelope_df['p50'].max():,.0f}")
        print(f"   P90: {envelope_df['p90'].min():,.0f} - {envelope_df['p90'].max():,.0f}")
        
        return envelope_df
    
    def create_realistic_visualization(self, last_10_videos, all_progressions, envelope_df):
        """Create realistic visualization"""
        print("🎨 Creating realistic backfill visualization...")
        
        fig, axes = plt.subplots(2, 2, figsize=(16, 12))
        
        # Top left: Single video example
        ax1 = axes[0, 0]
        target_progression = all_progressions[0]
        
        actual = target_progression[target_progression['data_type'] == 'actual']
        predicted = target_progression[target_progression['data_type'] == 'predicted']
        
        # Plot smooth curve
        ax1.plot(target_progression['days_since_published'], target_progression['views'], 
                'b-', alpha=0.8, linewidth=2, label='Realistic Backfilled Curve')
        ax1.scatter(actual['days_since_published'], actual['views'], 
                   color='red', s=100, zorder=5, label='Actual Data Points')
        
        ax1.set_title(f'Single Video: Realistic Backfill\n{last_10_videos[0]["title"][:40]}...')
        ax1.set_xlabel('Days Since Published')
        ax1.set_ylabel('View Count')
        ax1.legend()
        ax1.grid(True, alpha=0.3)
        ax1.set_yscale('log')
        
        # Top right: All videos
        ax2 = axes[0, 1]
        colors = plt.cm.tab10(np.linspace(0, 1, len(all_progressions)))
        
        for i, progression in enumerate(all_progressions):
            actual = progression[progression['data_type'] == 'actual']
            
            ax2.plot(progression['days_since_published'], progression['views'], 
                    color=colors[i], alpha=0.7, linewidth=1.5, 
                    label=f'Video {i+1}' if i < 3 else "")
            ax2.scatter(actual['days_since_published'], actual['views'], 
                       color=colors[i], s=20, zorder=5)
        
        ax2.set_title('All 10 Videos: Realistic Backfilled Progressions')
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
        
        ax3.set_title('Channel Envelope from Realistic Backfill')
        ax3.set_xlabel('Days Since Published')
        ax3.set_ylabel('View Count')
        ax3.legend()
        ax3.grid(True, alpha=0.3)
        ax3.set_yscale('log')
        
        # Bottom right: Assessment
        ax4 = axes[1, 1]
        
        # Plot envelope
        ax4.fill_between(envelope_df['day'], envelope_df['p10'], envelope_df['p90'],
                        alpha=0.4, color='gray', label='Channel Confidence Band')
        ax4.plot(envelope_df['day'], envelope_df['p50'], 'g-', linewidth=2, 
                alpha=0.8, label='Expected Performance')
        
        # Plot target video
        target_progression = all_progressions[0]
        actual = target_progression[target_progression['data_type'] == 'actual']
        
        ax4.plot(target_progression['days_since_published'], target_progression['views'], 
                'b-', alpha=0.8, linewidth=2, label='Target Video')
        ax4.scatter(actual['days_since_published'], actual['views'], 
                   color='red', s=100, zorder=5, label='Actual Points')
        
        ax4.set_title('Performance Assessment vs Channel')
        ax4.set_xlabel('Days Since Published')
        ax4.set_ylabel('View Count')
        ax4.legend()
        ax4.grid(True, alpha=0.3)
        ax4.set_yscale('log')
        
        plt.suptitle('Realistic Backfill: No Crazy ML Curves, Just Sensible Interpolation', 
                    fontsize=14, fontweight='bold')
        plt.tight_layout()
        
        # Save
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        viz_path = f'data/realistic_backfill_demo_{timestamp}.png'
        plt.savefig(viz_path, dpi=300, bbox_inches='tight')
        print(f"💾 Realistic visualization: {viz_path}")
        
        return viz_path
    
    def run_realistic_demo(self, channel_name="I Like To Make Stuff"):
        """Run realistic backfill demo"""
        print(f"🚀 Running Realistic Backfill Demo for {channel_name}")
        print("=" * 60)
        
        # Load data
        channel_data = self.load_channel_data(channel_name)
        if channel_data is None:
            return None
        
        # Get videos
        last_10_videos = self.get_last_10_videos(channel_data)
        if len(last_10_videos) < 5:
            return None
        
        # Backfill each video
        print("\n🔄 Creating realistic backfill progressions...")
        all_progressions = []
        for i, video in enumerate(last_10_videos):
            print(f"   Processing {i+1}/{len(last_10_videos)}: {video['title'][:40]}...")
            progression = self.realistic_backfill_video(video['data'])
            if len(progression) > 0:
                all_progressions.append(progression)
        
        print(f"✅ Created {len(all_progressions)} realistic progressions")
        
        # Create envelope
        envelope_df = self.create_envelope_from_videos(all_progressions)
        
        # Visualize
        viz_path = self.create_realistic_visualization(last_10_videos, all_progressions, envelope_df)
        
        print(f"\n🎉 REALISTIC DEMO COMPLETE!")
        print(f"💾 Visualization: {viz_path}")
        print(f"✅ No crazy flat-then-jump curves - just sensible growth patterns")
        
        return viz_path

def main():
    backfiller = SimpleRealisticBackfiller()
    backfiller.run_realistic_demo()

if __name__ == "__main__":
    main()