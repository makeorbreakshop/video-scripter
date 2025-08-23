#!/usr/bin/env python3
"""
Test the leaderboard context API endpoint to debug why it's not showing
"""

import requests
import json

BASE_URL = "http://localhost:3000"

def test_leaderboard_context_api():
    """Test the leaderboard context API with real data"""
    
    print("Testing leaderboard context API...")
    
    # First, let's see what's in the database
    print("\n1. Testing with a known good player (should exist)...")
    
    # Test with a score that should exist
    test_cases = [
        ("john", 9909),
        ("testuser", 5000),
        ("player1", 10000),
        ("Leanify TV", 15000)  # Known player from previous tests
    ]
    
    for player_name, final_score in test_cases:
        print(f"\n--- Testing {player_name} with score {final_score} ---")
        
        # Test the leaderboard context API
        url = f"{BASE_URL}/api/thumbnail-battle/leaderboard-context"
        params = {
            "player_name": player_name,
            "final_score": final_score
        }
        
        try:
            response = requests.get(url, params=params)
            print(f"Status: {response.status_code}")
            
            if response.status_code == 200:
                data = response.json()
                print(f"Response keys: {list(data.keys())}")
                
                if 'leaderboard_context' in data:
                    context = data['leaderboard_context']
                    print(f"Leaderboard context length: {len(context)}")
                    
                    if len(context) > 0:
                        print("Sample entries:")
                        for i, entry in enumerate(context[:3]):  # Show first 3
                            print(f"  {i+1}. Rank #{entry.get('rank', 'N/A')}: {entry.get('player_name', 'N/A')} - {entry.get('best_score', 'N/A')} points")
                            if entry.get('is_current_player'):
                                print(f"     ^^^ This is the current player")
                    else:
                        print("⚠️  Empty leaderboard context!")
                else:
                    print("❌ No 'leaderboard_context' in response")
                    
                if 'player_rank' in data:
                    print(f"Player rank: #{data['player_rank']}")
                else:
                    print("❌ No 'player_rank' in response")
                    
            else:
                print(f"❌ Error response: {response.text}")
                
        except Exception as e:
            print(f"❌ Request failed: {e}")

def test_with_recent_game_data():
    """Test with data from a recent game that should be in the database"""
    
    print("\n\n2. Let's check what games exist in the database first...")
    
    try:
        # Check recent games to find real data to test with
        response = requests.get(f"{BASE_URL}/api/thumbnail-battle/leaderboard?limit=20")
        
        if response.status_code == 200:
            data = response.json()
            games = data.get('best_games', [])
            
            print(f"Found {len(games)} recent games:")
            for i, game in enumerate(games[:5]):  # Show top 5
                print(f"  {i+1}. {game.get('player_name', 'Unknown')} - {game.get('best_score', 0)} points")
            
            # Test with the first real game
            if games:
                test_game = games[0]
                player_name = test_game.get('player_name')
                final_score = test_game.get('best_score')
                
                print(f"\n--- Testing with real data: {player_name}, score {final_score} ---")
                
                url = f"{BASE_URL}/api/thumbnail-battle/leaderboard-context"
                params = {
                    "player_name": player_name,
                    "final_score": final_score
                }
                
                response = requests.get(url, params=params)
                print(f"Status: {response.status_code}")
                
                if response.status_code == 200:
                    data = response.json()
                    print("✅ SUCCESS! API is working")
                    
                    context = data.get('leaderboard_context', [])
                    print(f"Context entries: {len(context)}")
                    
                    if context:
                        print("Leaderboard context:")
                        for entry in context:
                            marker = "→ " if entry.get('is_current_player') else "  "
                            print(f"{marker}#{entry.get('rank')}: {entry.get('player_name')} - {entry.get('best_score')} pts")
                    else:
                        print("❌ Empty context despite 200 response")
                else:
                    print(f"❌ Failed: {response.text}")
            else:
                print("❌ No games found in database")
        else:
            print(f"❌ Failed to get leaderboard: {response.text}")
            
    except Exception as e:
        print(f"❌ Error: {e}")

def test_missing_parameters():
    """Test API with missing parameters to see error handling"""
    
    print("\n\n3. Testing error cases...")
    
    test_cases = [
        ("Missing both params", {}),
        ("Missing final_score", {"player_name": "test"}),
        ("Missing player_name", {"final_score": 5000}),
        ("Invalid score", {"player_name": "test", "final_score": "invalid"})
    ]
    
    for desc, params in test_cases:
        print(f"\n--- {desc} ---")
        try:
            response = requests.get(f"{BASE_URL}/api/thumbnail-battle/leaderboard-context", params=params)
            print(f"Status: {response.status_code}")
            if response.status_code != 200:
                print(f"Error: {response.text}")
            else:
                print("Unexpected success!")
        except Exception as e:
            print(f"Request error: {e}")

if __name__ == "__main__":
    print("=== THUMBNAIL BATTLE LEADERBOARD CONTEXT API TEST ===")
    
    try:
        test_leaderboard_context_api()
        test_with_recent_game_data() 
        test_missing_parameters()
        
        print("\n🎯 DIAGNOSIS:")
        print("If you see 'SUCCESS! API is working' above, then the issue is likely:")
        print("1. Frontend not calling the API (check useEffect dependencies)")
        print("2. Player name/score mismatch between game and API call") 
        print("3. API call happening but state not updating properly")
        print("\nIf API tests fail, then the backend endpoint has issues.")
        
    except Exception as e:
        print(f"\n💥 TEST SUITE FAILED: {e}")