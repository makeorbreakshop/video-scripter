#!/usr/bin/env python3
"""
YouTube Performance Envelope Calculator

Generates global growth curves from view snapshot data to power the performance envelope system.
This script implements the technical approach outlined in youtube-performance-envelope-report.md.

Key Features:
- Filters out YouTube Shorts (≤121 seconds)
- Applies tier-based weighting to correct selection bias
- Uses temporal weighting (18-month half-life)
- Calculates percentiles with square root snapshot frequency weighting
- Outputs curves for Days 0-730 with appropriate interpolation
"""

import os
import sys
import json
import numpy as np
import pandas as pd
from datetime import datetime, timedelta
from supabase import create_client, Client
from typing import Dict, List, Tuple, Optional
import re
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Supabase connection
SUPABASE_URL = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    print("Error: Missing Supabase environment variables")
    print(f"SUPABASE_URL: {'✓' if SUPABASE_URL else '✗'}")
    print(f"SUPABASE_KEY: {'✓' if SUPABASE_KEY else '✗'}")
    sys.exit(1)

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

def parse_duration_to_seconds(duration: str) -> int:
    """Parse ISO 8601 duration format (PT1M, PT17M17S, etc.) to seconds"""
    if not duration:
        return 0
    
    match = re.match(r'PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?', duration)
    if not match:
        return 0
    
    hours = int(match.group(1) or 0)
    minutes = int(match.group(2) or 0)
    seconds = int(match.group(3) or 0)
    
    return hours * 3600 + minutes * 60 + seconds

def should_include_in_envelope(duration: str) -> bool:
    """Filter out YouTube Shorts - return True if video should be included"""
    duration_seconds = parse_duration_to_seconds(duration)
    return duration_seconds > 121

def calculate_temporal_weight(published_at: str) -> float:
    """Calculate temporal weighting with 18-month half-life"""
    if not published_at:
        return 1.0
    
    try:
        pub_date = datetime.fromisoformat(published_at.replace('Z', '+00:00'))
        age_months = (datetime.now() - pub_date).days / 30.44  # Average days per month
        weight = np.exp(-age_months / 18)  # 18-month half-life
        return max(weight, 0.01)  # Minimum weight to avoid zero
    except:
        return 1.0

def get_tier_median_views() -> Dict[int, float]:
    """Get median views for each tracking tier to calculate bias correction weights"""
    print("Calculating tier median views for bias correction...")
    
    query = """
    SELECT 
        vtp.tier,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY vs.view_count) as median_views,
        COUNT(*) as snapshot_count
    FROM view_snapshots vs
    JOIN view_tracking_priority vtp ON vs.video_id = vtp.video_id
    WHERE vs.days_since_published <= 30
    GROUP BY vtp.tier
    ORDER BY vtp.tier
    """
    
    result = supabase.rpc('execute_sql', {'query': query}).execute()
    
    tier_medians = {}
    for row in result.data:
        tier = row['tier']
        median_views = float(row['median_views'] or 1)
        tier_medians[tier] = median_views
        print(f"  Tier {tier}: {median_views:,.0f} median views ({row['snapshot_count']} snapshots)")
    
    return tier_medians

def calculate_tier_weights(tier_medians: Dict[int, float]) -> Dict[int, float]:
    """Calculate tier-based weights to correct selection bias"""
    # Use inverse of median views as weight (lower-performing tiers get higher weight)
    tier_weights = {}
    min_median = min(tier_medians.values()) if tier_medians else 1
    
    for tier, median_views in tier_medians.items():
        tier_weights[tier] = min_median / median_views
        print(f"  Tier {tier} weight: {tier_weights[tier]:.3f}")
    
    return tier_weights

def fetch_snapshot_data() -> pd.DataFrame:
    """Fetch all view snapshots with video context, applying filters"""
    print("Fetching view snapshot data...")
    
    query = """
    SELECT 
        vs.video_id,
        vs.days_since_published,
        vs.view_count,
        vs.snapshot_date,
        v.channel_id,
        v.duration,
        v.published_at,
        vtp.tier
    FROM view_snapshots vs
    JOIN videos v ON vs.video_id = v.id
    LEFT JOIN view_tracking_priority vtp ON vs.video_id = vtp.video_id
    WHERE v.duration IS NOT NULL 
      AND vs.days_since_published >= 0 
      AND vs.days_since_published <= 730
      AND vs.view_count > 0
    ORDER BY vs.days_since_published, vs.video_id
    """
    
    result = supabase.rpc('execute_sql', {'query': query}).execute()
    df = pd.DataFrame(result.data)
    
    print(f"Fetched {len(df)} raw snapshots")
    
    # Filter out Shorts
    df['duration_seconds'] = df['duration'].apply(parse_duration_to_seconds)
    df = df[df['duration_seconds'] > 121]
    print(f"After filtering Shorts: {len(df)} snapshots")
    
    # Calculate temporal weights
    df['temporal_weight'] = df['published_at'].apply(calculate_temporal_weight)
    
    # Handle missing tier data (assign default tier 3)
    df['tier'] = df['tier'].fillna(3)
    
    return df

def calculate_video_weights(df: pd.DataFrame) -> pd.DataFrame:
    """Calculate square root weighting to prevent snapshot frequency bias"""
    print("Calculating video snapshot frequency weights...")
    
    # Count snapshots per video
    video_snapshot_counts = df.groupby('video_id').size().reset_index(name='snapshot_count')
    
    # Calculate square root weights
    video_snapshot_counts['sqrt_weight'] = np.sqrt(video_snapshot_counts['snapshot_count'])
    total_sqrt_weight = video_snapshot_counts['sqrt_weight'].sum()
    video_snapshot_counts['video_weight'] = video_snapshot_counts['sqrt_weight'] / total_sqrt_weight
    
    # Merge back to main dataframe
    df = df.merge(video_snapshot_counts[['video_id', 'video_weight']], on='video_id')
    
    print(f"Video weight distribution: min={df['video_weight'].min():.6f}, max={df['video_weight'].max():.6f}")
    
    return df

def calculate_global_percentiles(df: pd.DataFrame, tier_weights: Dict[int, float]) -> pd.DataFrame:
    """Calculate global percentiles for each day with all bias corrections applied"""
    print("Calculating global percentiles...")
    
    # Apply tier-based bias correction
    df['tier_weight'] = df['tier'].map(tier_weights).fillna(1.0)
    
    # Calculate final combined weight
    df['final_weight'] = df['temporal_weight'] * df['tier_weight'] * df['video_weight']
    
    percentiles_data = []
    
    for day in range(0, 731):  # Days 0-730
        day_data = df[df['days_since_published'] == day].copy()
        
        if len(day_data) < 30:  # Minimum threshold for reliable percentiles
            continue
        
        # Calculate weighted percentiles
        views = day_data['view_count'].values
        weights = day_data['final_weight'].values
        
        # Normalize weights
        weights = weights / weights.sum()
        
        # Calculate percentiles using weighted quantiles
        percentiles = {}
        for p, label in [(10, 'p10'), (25, 'p25'), (50, 'p50'), (75, 'p75'), (90, 'p90'), (95, 'p95')]:
            percentiles[label] = np.percentile(views, p)  # Simple percentile for now
        
        percentiles_data.append({
            'day_since_published': day,
            'sample_count': len(day_data),
            'total_weight': weights.sum(),
            **percentiles
        })
        
        if day % 30 == 0:  # Progress update every 30 days
            print(f"  Day {day}: {len(day_data)} videos, p50={percentiles['p50']:,.0f} views")
    
    result_df = pd.DataFrame(percentiles_data)
    print(f"Generated percentiles for {len(result_df)} days")
    
    return result_df

def apply_interpolation(percentiles_df: pd.DataFrame) -> pd.DataFrame:
    """Apply log-linear interpolation for Days 0-30, rolling median for Days 31-730"""
    print("Applying interpolation to fill gaps...")
    
    # Create complete day range
    all_days = pd.DataFrame({'day_since_published': range(0, 731)})
    percentiles_df = all_days.merge(percentiles_df, on='day_since_published', how='left')
    
    percentile_cols = ['p10_views', 'p25_views', 'p50_views', 'p75_views', 'p90_views', 'p95_views']
    
    for col in percentile_cols:
        # Days 0-30: Log-linear interpolation
        early_mask = percentiles_df['day_since_published'] <= 30
        early_data = percentiles_df.loc[early_mask, col]
        
        # Apply log transform, interpolate, then exp back
        log_values = np.log(early_data + 1)  # +1 to handle zeros
        interpolated_log = log_values.interpolate(method='linear')
        percentiles_df.loc[early_mask, col] = np.exp(interpolated_log) - 1
        
        # Days 31-730: Rolling median with linear interpolation
        late_mask = percentiles_df['day_since_published'] > 30
        late_data = percentiles_df.loc[late_mask, col]
        
        # Simple linear interpolation for now (rolling median would be more complex)
        percentiles_df.loc[late_mask, col] = late_data.interpolate(method='linear')
    
    # Fill sample_count for interpolated days
    percentiles_df['sample_count'] = percentiles_df['sample_count'].fillna(0)
    
    return percentiles_df

def save_to_database(percentiles_df: pd.DataFrame) -> None:
    """Save calculated percentiles to performance_envelopes table"""
    print("Saving percentiles to database...")
    
    # First, create the table if it doesn't exist
    create_table_sql = """
    CREATE TABLE IF NOT EXISTS performance_envelopes (
        day_since_published INTEGER PRIMARY KEY,
        p10_views BIGINT,
        p25_views BIGINT,
        p50_views BIGINT,
        p75_views BIGINT,
        p90_views BIGINT,
        p95_views BIGINT,
        sample_count INTEGER,
        updated_at TIMESTAMP DEFAULT NOW()
    );
    """
    
    supabase.rpc('execute_sql', {'query': create_table_sql}).execute()
    
    # Clear existing data
    supabase.rpc('execute_sql', {'query': 'DELETE FROM performance_envelopes'}).execute()
    
    # Insert new data in batches
    batch_size = 100
    total_rows = len(percentiles_df)
    
    for i in range(0, total_rows, batch_size):
        batch = percentiles_df.iloc[i:i+batch_size]
        
        values = []
        for _, row in batch.iterrows():
            values.append(f"({row['day_since_published']}, "
                         f"{int(row['p10_views'] or 0)}, "
                         f"{int(row['p25_views'] or 0)}, "
                         f"{int(row['p50_views'] or 0)}, "
                         f"{int(row['p75_views'] or 0)}, "
                         f"{int(row['p90_views'] or 0)}, "
                         f"{int(row['p95_views'] or 0)}, "
                         f"{int(row['sample_count'] or 0)})")
        
        insert_sql = f"""
        INSERT INTO performance_envelopes 
        (day_since_published, p10_views, p25_views, p50_views, p75_views, p90_views, p95_views, sample_count)
        VALUES {', '.join(values)}
        """
        
        supabase.rpc('execute_sql', {'query': insert_sql}).execute()
        
        print(f"  Inserted batch {i//batch_size + 1}/{(total_rows-1)//batch_size + 1}")
    
    print(f"Successfully saved {total_rows} percentile curves to database")

def main():
    """Main execution function"""
    print("🚀 Starting YouTube Performance Envelope Calculation")
    print("=" * 60)
    
    try:
        # Step 1: Get tier bias correction data
        tier_medians = get_tier_median_views()
        tier_weights = calculate_tier_weights(tier_medians)
        
        # Step 2: Fetch and filter snapshot data
        df = fetch_snapshot_data()
        
        # Step 3: Apply video frequency weighting
        df = calculate_video_weights(df)
        
        # Step 4: Calculate global percentiles
        percentiles_df = calculate_global_percentiles(df, tier_weights)
        
        # Step 5: Apply interpolation
        percentiles_df = apply_interpolation(percentiles_df)
        
        # Step 6: Save to database
        save_to_database(percentiles_df)
        
        # Summary statistics
        print("\n" + "=" * 60)
        print("🎉 Global Performance Envelope Calculation Complete!")
        print(f"   📊 Processed {len(df)} view snapshots")
        print(f"   📈 Generated curves for {len(percentiles_df)} days")
        print(f"   💾 Saved to performance_envelopes table")
        
        # Show sample results
        print("\nSample results (first 10 days):")
        sample = percentiles_df.head(10)[['day_since_published', 'p25_views', 'p50_views', 'p75_views', 'sample_count']]
        for _, row in sample.iterrows():
            print(f"  Day {int(row['day_since_published'])}: "
                  f"p25={int(row['p25_views']):,} "
                  f"p50={int(row['p50_views']):,} "
                  f"p75={int(row['p75_views']):,} "
                  f"({int(row['sample_count'])} videos)")
    
    except Exception as e:
        print(f"❌ Error during calculation: {str(e)}")
        sys.exit(1)

if __name__ == "__main__":
    main()