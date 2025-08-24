#!/usr/bin/env python3
"""
Test the leaderboard context API with a zero score
"""

import requests

BASE_URL = "http://localhost:3000"

def test_zero_score():
    """Test with score 0"""
    
    print("Testing leaderboard context with score 0...")
    
    # Test with a score of 0
    url = f"{BASE_URL}/api/thumbnail-battle/leaderboard-context"
    params = {
        "player_name": "testplayer",
        "final_score": 0
    }
    
    response = requests.get(url, params=params)
    print(f"Status: {response.status_code}")
    
    if response.status_code == 200:
        data = response.json()
        context = data.get('leaderboard_context', [])
        print(f"✅ SUCCESS! Got {len(context)} leaderboard entries")
        
        # Show some entries
        for i, entry in enumerate(context[:5]):
            marker = "→ " if entry.get('is_current_player') else "  "
            print(f"{marker}#{entry.get('rank')}: {entry.get('player_name')} - {entry.get('best_score')} pts")
            
        player_rank = data.get('player_rank')
        print(f"Player rank: #{player_rank}")
        
    else:
        print(f"❌ Failed: {response.text}")

if __name__ == "__main__":
    test_zero_score()