#!/usr/bin/env python3
"""
Find a video with good trajectory data that's not absurdly viral
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

def find_reasonable_videos():
    """Find videos with reasonable view counts and multiple snapshots"""
    print("🔍 Finding videos with reasonable performance and good data...\n")
    
    # Get videos with moderate view counts (not billions)
    videos_response = supabase.table('videos').select('id, title, view_count, channel_id, published_at').gte('view_count', 10000).lte('view_count', 10000000).order('view_count', desc=True).limit(100).execute()
    
    good_candidates = []
    
    for video in videos_response.data:
        # Check snapshots
        snapshots_response = supabase.table('view_snapshots').select('days_since_published, view_count').eq('video_id', video['id']).order('days_since_published').execute()
        
        if len(snapshots_response.data) >= 5:  # At least 5 snapshots for good trajectory
            # Calculate days since published
            import datetime
            published_date = datetime.datetime.fromisoformat(video['published_at'].replace('Z', '+00:00'))
            days_old = (datetime.datetime.now(datetime.timezone.utc) - published_date).days
            
            good_candidates.append({
                'id': video['id'],
                'title': video['title'],
                'view_count': video['view_count'],
                'channel_id': video['channel_id'],
                'snapshot_count': len(snapshots_response.data),
                'days_old': days_old,
                'snapshots': snapshots_response.data
            })
            
            if len(good_candidates) >= 5:
                break
    
    return good_candidates

def main():
    candidates = find_reasonable_videos()
    
    if not candidates:
        print("❌ No suitable videos found")
        return
    
    print(f"Found {len(candidates)} videos with good trajectory data:\n")
    
    for i, video in enumerate(candidates):
        print(f"{i+1}. {video['title'][:70]}...")
        print(f"   Views: {video['view_count']:,}")
        print(f"   Age: {video['days_old']} days")
        print(f"   Snapshots: {video['snapshot_count']}")
        print(f"   Growth: {video['snapshots'][0]['view_count']:,} → {video['snapshots'][-1]['view_count']:,}")
        print()
    
    # Return the best candidate
    if candidates:
        best = candidates[0]
        print(f"\n✅ Best candidate: {best['title'][:60]}...")
        print(f"Video ID: {best['id']}")
        return best['id']

if __name__ == "__main__":
    video_id = main()
    if video_id:
        print(f"\nUse this video ID: {video_id}")