#!/usr/bin/env python3
"""
Update performance_envelopes table with smooth, monotonic growth curves
Fixes the Day 90 < Day 30 anomaly by ensuring views only increase
"""

import os
import numpy as np
from supabase import create_client, Client
from dotenv import load_dotenv
from scipy.interpolate import interp1d
from datetime import datetime

# Load environment variables
load_dotenv()

# Initialize Supabase client
url = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
supabase: Client = create_client(url, key)

def create_smooth_monotonic_curve(days, values, max_day=365):
    """
    Create smooth, monotonic growth curve from raw percentile data
    """
    # Start at 0 views on day 0 if not present
    if days[0] != 0:
        days = np.concatenate([[0], days])
        values = np.concatenate([[0], values])
    
    # Remove any NaN or None values
    valid_indices = ~np.isnan(values)
    days = days[valid_indices]
    values = values[valid_indices]
    
    # Create interpolation function
    # Use cubic for early days (0-30) for smooth growth
    # Use linear for later days to avoid oscillations
    
    all_days = np.arange(0, max_day + 1)
    smooth_values = np.zeros_like(all_days, dtype=float)
    
    for i, day in enumerate(all_days):
        if day <= 30:
            # For early days, use cubic interpolation if we have enough points
            early_mask = days <= 35  # Include a few extra days for smoothness
            early_days = days[early_mask]
            early_values = values[early_mask]
            
            if len(early_days) >= 4:
                f = interp1d(early_days, early_values, kind='cubic', 
                           bounds_error=False, fill_value='extrapolate')
                smooth_values[i] = max(0, f(day))
            elif len(early_days) >= 2:
                f = interp1d(early_days, early_values, kind='linear',
                           bounds_error=False, fill_value='extrapolate')
                smooth_values[i] = max(0, f(day))
            else:
                smooth_values[i] = values[0] if len(values) > 0 else 0
        else:
            # For later days, use linear interpolation
            f = interp1d(days, values, kind='linear',
                       bounds_error=False, fill_value='extrapolate')
            smooth_values[i] = max(0, f(day))
    
    # Ensure monotonic increase (views can only go up)
    for i in range(1, len(smooth_values)):
        smooth_values[i] = max(smooth_values[i], smooth_values[i-1])
    
    return all_days, smooth_values

def update_smooth_envelopes():
    """
    Update performance_envelopes table with smooth curves
    """
    print("📊 Fetching raw envelope data...")
    
    # Get current envelope data
    response = supabase.table('performance_envelopes')\
        .select('*')\
        .order('day_since_published')\
        .execute()
    
    envelope_data = response.data
    
    # Extract arrays
    days = np.array([e['day_since_published'] for e in envelope_data])
    p10_raw = np.array([e['p10_views'] for e in envelope_data], dtype=float)
    p25_raw = np.array([e['p25_views'] for e in envelope_data], dtype=float)
    p50_raw = np.array([e['p50_views'] for e in envelope_data], dtype=float)
    p75_raw = np.array([e['p75_views'] for e in envelope_data], dtype=float)
    p90_raw = np.array([e['p90_views'] for e in envelope_data], dtype=float)
    p95_raw = np.array([e['p95_views'] for e in envelope_data], dtype=float)
    
    print(f"📈 Found {len(days)} days of raw data")
    print(f"   Day 30 median: {p50_raw[30]:,.0f} views")
    print(f"   Day 90 median: {p50_raw[90]:,.0f} views")
    print(f"   ⚠️  Day 90 < Day 30? {p50_raw[90] < p50_raw[30]}")
    
    # Create smooth curves for each percentile
    print("\n🔄 Creating smooth monotonic curves...")
    
    _, p10_smooth = create_smooth_monotonic_curve(days, p10_raw)
    _, p25_smooth = create_smooth_monotonic_curve(days, p25_raw)
    _, p50_smooth = create_smooth_monotonic_curve(days, p50_raw)
    _, p75_smooth = create_smooth_monotonic_curve(days, p75_raw)
    _, p90_smooth = create_smooth_monotonic_curve(days, p90_raw)
    _, p95_smooth = create_smooth_monotonic_curve(days, p95_raw)
    
    print(f"\n✅ After smoothing:")
    print(f"   Day 30 median: {p50_smooth[30]:,.0f} views")
    print(f"   Day 90 median: {p50_smooth[90]:,.0f} views")
    print(f"   Day 90 > Day 30? {p50_smooth[90] > p50_smooth[30]} ✓")
    
    # Update database with smooth values
    print("\n💾 Updating database with smooth curves...")
    
    updates = []
    for i in range(min(366, len(p50_smooth))):
        update = {
            'day_since_published': i,
            'p10_views': int(p10_smooth[i]),
            'p25_views': int(p25_smooth[i]),
            'p50_views': int(p50_smooth[i]),
            'p75_views': int(p75_smooth[i]),
            'p90_views': int(p90_smooth[i]),
            'p95_views': int(p95_smooth[i]),
            'updated_at': datetime.utcnow().isoformat()
        }
        updates.append(update)
    
    # Update in batches
    batch_size = 50
    for i in range(0, len(updates), batch_size):
        batch = updates[i:i+batch_size]
        response = supabase.table('performance_envelopes')\
            .upsert(batch)\
            .execute()
        print(f"   Updated days {i} to {min(i+batch_size-1, len(updates)-1)}")
    
    print(f"\n✅ Successfully updated {len(updates)} days with smooth curves!")
    
    # Show sample growth progression
    print("\n📊 Sample growth progression (median/p50):")
    sample_days = [0, 1, 7, 14, 30, 60, 90, 180, 365]
    for day in sample_days:
        if day < len(p50_smooth):
            print(f"   Day {day:3d}: {p50_smooth[day]:>10,.0f} views")
    
    # Verify monotonicity
    print("\n🔍 Verifying monotonicity...")
    is_monotonic = all(p50_smooth[i] <= p50_smooth[i+1] for i in range(len(p50_smooth)-1))
    print(f"   Median curve is monotonic: {is_monotonic} ✓")
    
    return p50_smooth

if __name__ == "__main__":
    update_smooth_envelopes()