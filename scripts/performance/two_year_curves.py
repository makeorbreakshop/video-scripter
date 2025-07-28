#!/usr/bin/env python3
"""
Create performance curves extended to 2 years (730 days)
Process all snapshots without normalizing beyond 365
"""

import os
import matplotlib.pyplot as plt
import numpy as np
from supabase import create_client, Client
from dotenv import load_dotenv
from scipy.ndimage import gaussian_filter1d
from datetime import datetime
from collections import defaultdict

# Load environment variables
load_dotenv()

# Initialize Supabase client
url = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
supabase: Client = create_client(url, key)

print("🎯 Creating 2-Year Performance Curves (730 days)")
print("=" * 60)

# Check how many snapshots we have in the 365-730 day range
print("\n📊 Checking data availability for days 365-730...")
check_result = supabase.table('view_snapshots')\
    .select('days_since_published', count='exact')\
    .gte('days_since_published', 365)\
    .lte('days_since_published', 730)\
    .execute()

print(f"   Snapshots in days 365-730: {check_result.count:,}")

# Get ALL snapshots up to 730 days
print("\n📊 Fetching all snapshots up to 730 days...")

all_snapshots = []
offset = 0
batch_size = 1000
total_processed = 0

while True:
    # Get batch of snapshots with video info
    result = supabase.table('view_snapshots')\
        .select('days_since_published, view_count, videos(duration)')\
        .lte('days_since_published', 730)\
        .gte('days_since_published', 0)\
        .range(offset, offset + batch_size - 1)\
        .execute()
    
    if not result.data:
        break
    
    # Process each snapshot
    for row in result.data:
        if row.get('videos') and row['videos'].get('duration') and row['view_count']:
            dur = row['videos']['duration']
            
            # Simple duration check for non-Shorts
            is_long_video = False
            
            if 'H' in dur:  # Has hours
                is_long_video = True
            elif 'M' in dur:  # Has minutes
                if 'PT' in dur and 'M' in dur:
                    try:
                        minutes_str = dur.split('M')[0].split('PT')[-1]
                        if minutes_str.isdigit() and int(minutes_str) >= 2:
                            is_long_video = True
                    except:
                        pass
            elif 'S' in dur and 'PT' in dur:  # Only seconds
                try:
                    seconds_str = dur.split('S')[0].split('PT')[-1]
                    if seconds_str.isdigit() and int(seconds_str) > 121:
                        is_long_video = True
                except:
                    pass
            
            if is_long_video:
                all_snapshots.append({
                    'day': row['days_since_published'],
                    'views': row['view_count']
                })
    
    total_processed += len(result.data)
    offset += batch_size
    
    if total_processed % 10000 == 0:
        print(f"   Processed {total_processed:,} records, found {len(all_snapshots):,} non-Short snapshots...")
    
    if len(result.data) < batch_size:
        break

print(f"\n✅ Total non-Short snapshots (0-730 days): {len(all_snapshots):,}")

# Calculate percentiles
print("\n📈 Calculating percentiles for 2-year range...")
views_by_day = defaultdict(list)

for snap in all_snapshots:
    views_by_day[snap['day']].append(snap['views'])

# Show data volume at key points
print(f"\n   Sample sizes at key days:")
for day in [0, 1, 7, 30, 90, 180, 365, 400, 500, 600, 730]:
    if day in views_by_day:
        print(f"   Day {day}: {len(views_by_day[day]):,} snapshots")

percentile_data = []
for day in range(731):  # 0 to 730
    if day in views_by_day and len(views_by_day[day]) >= 10:
        views = views_by_day[day]
        percentile_data.append({
            'day': day,
            'count': len(views),
            'p10': np.percentile(views, 10),
            'p25': np.percentile(views, 25),
            'p50': np.percentile(views, 50),
            'p75': np.percentile(views, 75),
            'p90': np.percentile(views, 90),
            'p95': np.percentile(views, 95)
        })

print(f"\n   Days with sufficient data (10+ videos): {len(percentile_data)}")

# Create smooth curves for 730 days
print("\n🎨 Creating natural smooth curves (2 years)...")
days = np.array([d['day'] for d in percentile_data])
smooth_days = np.arange(0, 731)
smooth_curves = {}

for percentile in ['p10', 'p25', 'p50', 'p75', 'p90', 'p95']:
    raw_values = np.array([d[percentile] for d in percentile_data])
    
    # Interpolate
    interpolated = np.interp(smooth_days, days, raw_values)
    
    # Apply graduated smoothing - NO MONOTONIC CONSTRAINT
    smooth_values = np.zeros_like(interpolated)
    
    # Days 0-7: Very light smoothing
    smooth_values[:8] = gaussian_filter1d(interpolated[:8], sigma=0.5)
    
    # Days 8-30: Light smoothing
    smooth_values[8:31] = gaussian_filter1d(interpolated[8:31], sigma=1.0)
    
    # Days 31-90: Medium smoothing
    smooth_values[31:91] = gaussian_filter1d(interpolated[31:91], sigma=2.0)
    
    # Days 91-365: Heavier smoothing
    smooth_values[91:366] = gaussian_filter1d(interpolated[91:366], sigma=3.0)
    
    # Days 366-730: Even heavier smoothing (less data)
    smooth_values[366:] = gaussian_filter1d(interpolated[366:], sigma=5.0)
    
    # Ensure non-negative
    smooth_values = np.maximum(smooth_values, 0)
    
    smooth_curves[percentile] = smooth_values

# Create visualization
print("\n📊 Creating 2-year visualization...")
fig, ((ax1, ax2), (ax3, ax4)) = plt.subplots(2, 2, figsize=(18, 12))

# Plot 1: First 90 days (same as before)
raw_days = [d['day'] for d in percentile_data if d['day'] <= 90]
raw_p50 = [d['p50'] for d in percentile_data if d['day'] <= 90]

ax1.scatter(raw_days, raw_p50, alpha=0.5, s=30, color='gray', label='Raw data')
ax1.plot(smooth_days[:91], smooth_curves['p50'][:91], 'b-', linewidth=2, label='Smooth curve')
ax1.set_title('Median Views - First 90 Days', fontsize=14)
ax1.set_xlabel('Days Since Published')
ax1.set_ylabel('Views')
ax1.legend()
ax1.grid(True, alpha=0.3)

# Plot 2: Full 2 years
ax2.fill_between(smooth_days, smooth_curves['p10'], smooth_curves['p90'],
                 alpha=0.2, color='blue', label='10th-90th percentile')
ax2.fill_between(smooth_days, smooth_curves['p25'], smooth_curves['p75'],
                 alpha=0.3, color='blue', label='25th-75th percentile')
ax2.plot(smooth_days, smooth_curves['p50'], 'b-', linewidth=2, label='Median')

# Add year markers
ax2.axvline(x=365, color='red', linestyle='--', alpha=0.5, label='1 year')
ax2.axvline(x=730, color='red', linestyle='--', alpha=0.5, label='2 years')

ax2.set_title('2-Year Performance Envelope', fontsize=14)
ax2.set_xlabel('Days Since Published')
ax2.set_ylabel('Views')
ax2.legend()
ax2.grid(True, alpha=0.3)
ax2.set_yscale('log')

# Plot 3: Sample sizes across 2 years
sample_days = [d['day'] for d in percentile_data]
sample_counts = [d['count'] for d in percentile_data]

ax3.bar(sample_days, sample_counts, width=1, alpha=0.7, color='green')
ax3.axvline(x=365, color='red', linestyle='--', alpha=0.5)
ax3.set_title('Sample Size by Day (2 Years)', fontsize=14)
ax3.set_xlabel('Days Since Published')
ax3.set_ylabel('Number of Snapshots')
ax3.grid(True, alpha=0.3)

# Plot 4: Year 1 vs Year 2 comparison
ax4.axis('off')

p50 = smooth_curves['p50']
year1_end = p50[365] if len(p50) > 365 else 0
year2_end = p50[730] if len(p50) > 730 else 0

stats_text = f"""
2-YEAR PERFORMANCE ENVELOPE STATISTICS

Data Coverage:
• Total snapshots processed: {len(all_snapshots):,}
• Days with sufficient data: {len(percentile_data)}
• Year 1 coverage: Days 0-365
• Year 2 coverage: Days 366-730

Median (P50) Growth Pattern:
• Day 1: {p50[1]:,.0f} views
• Day 7: {p50[7]:,.0f} views
• Day 30: {p50[30]:,.0f} views
• Day 90: {p50[90]:,.0f} views
• Day 180: {p50[180]:,.0f} views
• Day 365 (1 year): {year1_end:,.0f} views
• Day 730 (2 years): {year2_end:,.0f} views

Year-over-Year Growth:
• Year 1 total: {year1_end:,.0f} views
• Year 2 total: {year2_end - year1_end:,.0f} views
• Year 2 growth: {((year2_end - year1_end) / year1_end * 100) if year1_end > 0 else 0:.1f}%

Key Insights:
• Most growth happens in first 90 days
• Year 2 shows continued gradual growth
• Long-tail content continues accumulating views
"""

ax4.text(0.05, 0.5, stats_text, fontsize=11, 
         verticalalignment='center', fontfamily='monospace',
         bbox=dict(boxstyle="round,pad=0.5", facecolor="lightgray", alpha=0.3))

plt.tight_layout()
plt.savefig('two_year_performance_envelope.png', dpi=300, bbox_inches='tight')
print("   Saved to: two_year_performance_envelope.png")

# Update database with 2-year curves
print("\n💾 Updating database with 2-year curves...")

# First, check if we need to add rows for days 366-730
existing_days = supabase.table('performance_envelopes')\
    .select('day_since_published')\
    .gte('day_since_published', 366)\
    .execute()

existing_day_set = {row['day_since_published'] for row in existing_days.data}

updates = []
for i in range(731):  # 0 to 730
    sample_count = next((d['count'] for d in percentile_data if d['day'] == i), 0)
    
    updates.append({
        'day_since_published': i,
        'p10_views': int(smooth_curves['p10'][i]) if i < len(smooth_curves['p10']) else 0,
        'p25_views': int(smooth_curves['p25'][i]) if i < len(smooth_curves['p25']) else 0,
        'p50_views': int(smooth_curves['p50'][i]) if i < len(smooth_curves['p50']) else 0,
        'p75_views': int(smooth_curves['p75'][i]) if i < len(smooth_curves['p75']) else 0,
        'p90_views': int(smooth_curves['p90'][i]) if i < len(smooth_curves['p90']) else 0,
        'p95_views': int(smooth_curves['p95'][i]) if i < len(smooth_curves['p95']) else 0,
        'sample_count': sample_count,
        'updated_at': datetime.now().isoformat()
    })

# Update in batches
batch_size = 50
for i in range(0, len(updates), batch_size):
    batch = updates[i:i+batch_size]
    for update in batch:
        supabase.table('performance_envelopes')\
            .upsert(update, on_conflict='day_since_published')\
            .execute()
    
    if i % 200 == 0:
        print(f"   Updated days {i} to {min(i+batch_size, len(updates))}")

print("\n✅ SUCCESS! 2-year performance curves created:")
print(f"   - Processed snapshots from days 0-730")
print("   - Natural growth patterns preserved")
print("   - Database updated with extended curves")