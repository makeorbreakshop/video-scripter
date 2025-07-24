#!/usr/bin/env python3
"""
Analyze what trajectory data we actually have
"""

import os
from supabase import create_client, Client
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Initialize Supabase client
url = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
supabase: Client = create_client(url, key)

# First, let's see what videos have the most snapshots
print("🔍 Analyzing trajectory data...\n")

# Get videos with most snapshots (using a join query approach)
videos_with_counts = []

# Get sample of videos
videos_response = supabase.table('videos').select('id, title, view_count').order('view_count', desc=True).limit(200).execute()

print("Checking videos for trajectory data...")
for video in videos_response.data[:50]:  # Check first 50
    snapshots_response = supabase.table('view_snapshots').select('days_since_published').eq('video_id', video['id']).execute()
    
    if len(snapshots_response.data) > 0:
        videos_with_counts.append({
            'id': video['id'],
            'title': video['title'],
            'view_count': video['view_count'],
            'snapshot_count': len(snapshots_response.data)
        })

# Sort by snapshot count
videos_with_counts.sort(key=lambda x: x['snapshot_count'], reverse=True)

print(f"\nTop 10 videos by snapshot count:")
for i, video in enumerate(videos_with_counts[:10]):
    print(f"{i+1}. Snapshots: {video['snapshot_count']} | Views: {video['view_count']:,}")
    print(f"   {video['title'][:70]}...")
    print(f"   ID: {video['id']}")
    print()

# Let's pick a video with good data and create a proper chart
if videos_with_counts:
    # Find one with reasonable views (not billions)
    for video in videos_with_counts:
        if video['view_count'] < 100_000_000:  # Less than 100M views
            print(f"\n✅ Good candidate found:")
            print(f"Title: {video['title'][:70]}...")
            print(f"Views: {video['view_count']:,}")
            print(f"Snapshots: {video['snapshot_count']}")
            print(f"Video ID: {video['id']}")
            
            # Get its trajectory
            snapshots_response = supabase.table('view_snapshots').select('days_since_published, view_count').eq('video_id', video['id']).order('days_since_published').execute()
            
            print("\nTrajectory:")
            for snap in snapshots_response.data[:5]:
                print(f"  Day {snap['days_since_published']}: {snap['view_count']:,} views")
            
            return video['id']