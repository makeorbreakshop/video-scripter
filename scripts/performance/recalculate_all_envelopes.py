#!/usr/bin/env python3
"""
Recalculate ALL performance envelope curves from scratch using all view snapshots.
Processes day 0 to 3650 (10 years) using the complete dataset.
"""

import os
import numpy as np
from supabase import create_client, Client
from dotenv import load_dotenv
from datetime import datetime
from collections import defaultdict

# Load environment variables
load_dotenv()

# Initialize Supabase client
url = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
supabase: Client = create_client(url, key)

def recalculate_all_envelopes():
    """Recalculate all performance envelopes from view_snapshots"""
    
    print("🚀 Recalculating ALL performance envelopes from view snapshots...")
    print("   This will process all 700K+ snapshots from day 0 to 3650")
    print()
    
    # Step 1: Fetch all snapshots up to 10 years
    print("📊 Step 1: Fetching view snapshots...")
    all_snapshots = []
    offset = 0
    batch_size = 1000  # Supabase limit
    
    while True:
        batch = supabase.table('view_snapshots')\
            .select('days_since_published, view_count')\
            .gte('days_since_published', 0)\
            .not_.is_('view_count', None)\
            .range(offset, offset + batch_size - 1)\
            .execute()
        
        if not batch.data:
            break
            
        all_snapshots.extend(batch.data)
        offset += batch_size
        
        if offset % 10000 == 0:
            print(f"   Fetched {len(all_snapshots):,} snapshots...")
        
        if len(batch.data) < batch_size:
            break
    
    print(f"✅ Total snapshots fetched: {len(all_snapshots):,}")
    print()
    
    # Step 2: Group by day and calculate percentiles
    print("📈 Step 2: Calculating percentiles for each day...")
    views_by_day = defaultdict(list)
    
    for snap in all_snapshots:
        day = snap['days_since_published']
        views = snap['view_count']
        if views > 0:  # Filter out zero views
            views_by_day[day].append(views)
    
    print(f"   Days with data: {len(views_by_day)}")
    print()
    
    # Calculate percentiles for each day
    print("🔢 Step 3: Computing percentile curves...")
    envelope_data = []
    
    # Get the max day from the data
    max_day = max(views_by_day.keys()) if views_by_day else 3650
    print(f"   Processing days 0 to {max_day}")
    
    for day in range(0, min(max_day + 1, 3651)):  # Cap at 10 years for now
        views = views_by_day.get(day, [])
        
        if len(views) >= 30:  # Need minimum samples for reliable percentiles
            envelope_data.append({
                'day_since_published': day,
                'p10_views': int(np.percentile(views, 10)),
                'p25_views': int(np.percentile(views, 25)),
                'p50_views': int(np.percentile(views, 50)),
                'p75_views': int(np.percentile(views, 75)),
                'p90_views': int(np.percentile(views, 90)),
                'p95_views': int(np.percentile(views, 95)),
                'sample_count': len(views),
                'updated_at': datetime.now().isoformat()
            })
            
            # Show progress for key days
            if day in [1, 7, 30, 90, 180, 365, 730, 1095, 1825, 2555, 3285, 3650]:
                median = int(np.percentile(views, 50))
                print(f"   Day {day:4}: {len(views):6,} samples, median: {median:,} views")
    
    print(f"\n✅ Calculated percentiles for {len(envelope_data)} days")
    print()
    
    # Step 4: Clear existing data and insert new curves
    print("💾 Step 4: Updating database...")
    
    # Clear existing envelope data
    print("   Clearing old envelope data...")
    supabase.table('performance_envelopes')\
        .delete()\
        .gte('day_since_published', 0)\
        .execute()
    
    # Insert new data in batches
    print("   Inserting new envelope curves...")
    batch_size = 100
    for i in range(0, len(envelope_data), batch_size):
        batch = envelope_data[i:i+batch_size]
        supabase.table('performance_envelopes')\
            .insert(batch)\
            .execute()
        
        if i % 500 == 0:
            print(f"   Inserted {min(i+batch_size, len(envelope_data))}/{len(envelope_data)} days")
    
    print()
    print("✅ SUCCESS! Performance envelopes recalculated:")
    print(f"   • Processed {len(all_snapshots):,} snapshots")
    print(f"   • Generated curves for {len(envelope_data)} days")
    print(f"   • Coverage: Day 0 to Day 3650 (10 years)")
    print()
    
    # Show some statistics
    if envelope_data:
        day1 = next((d for d in envelope_data if d['day_since_published'] == 1), None)
        day30 = next((d for d in envelope_data if d['day_since_published'] == 30), None)
        day365 = next((d for d in envelope_data if d['day_since_published'] == 365), None)
        
        if day1 and day30 and day365:
            print("📊 Sample median values:")
            print(f"   Day 1:   {day1['p50_views']:,} views")
            print(f"   Day 30:  {day30['p50_views']:,} views ({day30['p50_views']/day1['p50_views']:.1f}x)")
            print(f"   Day 365: {day365['p50_views']:,} views ({day365['p50_views']/day1['p50_views']:.1f}x)")

if __name__ == "__main__":
    recalculate_all_envelopes()