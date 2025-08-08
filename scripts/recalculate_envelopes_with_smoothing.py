#!/usr/bin/env python3
"""
Recalculate global performance envelopes with 7-day rolling average smoothing
"""

import os
import numpy as np
from supabase import create_client, Client
from dotenv import load_dotenv
from datetime import datetime
import pandas as pd

# Load environment variables
load_dotenv()

# Initialize Supabase client
url = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
supabase: Client = create_client(url, key)

def fetch_all_snapshots():
    """Fetch ALL view snapshots from database"""
    print("📊 Fetching view snapshots from database...")
    
    all_snapshots = []
    offset = 0
    batch_size = 1000
    
    while True:
        # Fetch ALL snapshots without day limit
        batch = supabase.table('view_snapshots')\
            .select('days_since_published, view_count')\
            .gte('days_since_published', 0)\
            .not_.is_('view_count', None)\
            .range(offset, offset + batch_size - 1)\
            .execute()
        
        if not batch.data:
            break
            
        all_snapshots.extend(batch.data)
        
        if len(batch.data) < batch_size:
            break
        offset += batch_size
        
        if offset % 10000 == 0:
            print(f"  Fetched {offset} snapshots...")
    
    print(f"✅ Fetched {len(all_snapshots)} total snapshots")
    return all_snapshots

def calculate_percentiles_with_smoothing(snapshots_by_day):
    """Calculate percentiles for each day and apply 7-day rolling average smoothing"""
    
    print("📈 Calculating percentiles for each day...")
    
    # First, calculate raw percentiles
    raw_envelopes = []
    
    for day in range(0, 3651):  # 0 to 10 years
        if day in snapshots_by_day and len(snapshots_by_day[day]) >= 10:
            views = snapshots_by_day[day]
            envelope = {
                'day_since_published': day,
                'p10_views': int(np.percentile(views, 10)),
                'p25_views': int(np.percentile(views, 25)),
                'p50_views': int(np.percentile(views, 50)),
                'p75_views': int(np.percentile(views, 75)),
                'p90_views': int(np.percentile(views, 90)),
                'sample_count': len(views)
            }
        else:
            # For days with insufficient data, we'll interpolate later
            envelope = {
                'day_since_published': day,
                'p10_views': None,
                'p25_views': None,
                'p50_views': None,
                'p75_views': None,
                'p90_views': None,
                'sample_count': len(snapshots_by_day.get(day, []))
            }
        raw_envelopes.append(envelope)
    
    print("🔄 Applying 7-day rolling average smoothing...")
    
    # Convert to DataFrame for easier smoothing
    df = pd.DataFrame(raw_envelopes)
    
    # Interpolate missing values first
    for col in ['p10_views', 'p25_views', 'p50_views', 'p75_views', 'p90_views']:
        df[col] = df[col].interpolate(method='linear', limit_direction='both')
    
    # Apply 7-day rolling average with centered window
    for col in ['p10_views', 'p25_views', 'p50_views', 'p75_views', 'p90_views']:
        # Use a centered window for better smoothing
        df[f'{col}_smooth'] = df[col].rolling(window=7, center=True, min_periods=1).mean()
        # Round to integers
        df[f'{col}_smooth'] = df[f'{col}_smooth'].round().astype(int)
    
    # Create final smoothed envelopes
    smoothed_envelopes = []
    for _, row in df.iterrows():
        envelope = {
            'day_since_published': int(row['day_since_published']),
            'p10_views': int(row['p10_views_smooth']),
            'p25_views': int(row['p25_views_smooth']),
            'p50_views': int(row['p50_views_smooth']),
            'p75_views': int(row['p75_views_smooth']),
            'p90_views': int(row['p90_views_smooth']),
            'sample_count': int(row['sample_count'])
        }
        smoothed_envelopes.append(envelope)
    
    # Show comparison for key days
    print("\n📊 Smoothing Impact (Raw → Smoothed):")
    for day in [1, 7, 30, 90, 180, 365]:
        if day < len(raw_envelopes):
            raw = raw_envelopes[day]
            smooth = smoothed_envelopes[day]
            if raw['p50_views'] and smooth['p50_views']:
                change = ((smooth['p50_views'] - raw['p50_views']) / raw['p50_views']) * 100
                print(f"  Day {day:3}: {raw['p50_views']:,} → {smooth['p50_views']:,} ({change:+.1f}%)")
    
    return smoothed_envelopes

def update_envelopes_in_database(envelopes):
    """Update performance_envelopes table with smoothed data"""
    
    print(f"\n💾 Updating {len(envelopes)} envelope records in database...")
    
    # Process in batches to avoid timeouts
    batch_size = 100
    total_updated = 0
    
    for i in range(0, len(envelopes), batch_size):
        batch = envelopes[i:i+batch_size]
        
        # Upsert each record
        for envelope in batch:
            try:
                supabase.table('performance_envelopes')\
                    .upsert(envelope, on_conflict='day_since_published')\
                    .execute()
                total_updated += 1
            except Exception as e:
                print(f"  ⚠️ Error updating day {envelope['day_since_published']}: {e}")
        
        if total_updated % 500 == 0:
            print(f"  Updated {total_updated} records...")
    
    print(f"✅ Successfully updated {total_updated} envelope records with smoothing")
    return total_updated

def main():
    print("=" * 60)
    print("GLOBAL PERFORMANCE ENVELOPE RECALCULATION WITH SMOOTHING")
    print("=" * 60)
    
    start_time = datetime.now()
    
    # Step 1: Fetch all snapshots
    snapshots = fetch_all_snapshots()
    
    # Step 2: Group by days_since_published
    print("\n📊 Grouping snapshots by age...")
    snapshots_by_day = {}
    for snapshot in snapshots:
        day = snapshot['days_since_published']
        if day not in snapshots_by_day:
            snapshots_by_day[day] = []
        snapshots_by_day[day].append(snapshot['view_count'])
    
    print(f"  Found data for {len(snapshots_by_day)} unique days")
    
    # Step 3: Calculate percentiles with smoothing
    smoothed_envelopes = calculate_percentiles_with_smoothing(snapshots_by_day)
    
    # Step 4: Update database
    updated_count = update_envelopes_in_database(smoothed_envelopes)
    
    # Calculate processing time
    elapsed = datetime.now() - start_time
    
    print("\n" + "=" * 60)
    print("✅ ENVELOPE RECALCULATION COMPLETE")
    print(f"  Total snapshots processed: {len(snapshots):,}")
    print(f"  Unique days covered: {len(snapshots_by_day):,}")
    print(f"  Envelope records updated: {updated_count:,}")
    print(f"  Processing time: {elapsed}")
    print(f"  Smoothing: 7-day rolling average applied")
    print("=" * 60)

if __name__ == "__main__":
    main()