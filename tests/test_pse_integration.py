"""
Integration tests for Google PSE search endpoint
Tests the actual HTTP endpoint and database integration
"""

import pytest
import requests
import json
import os
from datetime import datetime
import time

BASE_URL = "http://localhost:3000"


class TestPSEIntegration:
    """Integration tests for Google PSE search functionality"""
    
    @pytest.fixture(scope="class")
    def api_url(self):
        """Get the API endpoint URL"""
        return f"{BASE_URL}/api/google-pse/search"
    
    @pytest.fixture(scope="class") 
    def quota_url(self):
        """Get the quota endpoint URL"""
        return f"{BASE_URL}/api/google-pse/quota"
    
    def test_search_endpoint_exists(self, api_url):
        """Test that the search endpoint is accessible"""
        response = requests.post(api_url, json={"query": ""})
        # Should return 400 for empty query, not 404
        assert response.status_code in [400, 200]
    
    def test_quota_endpoint(self, quota_url):
        """Test quota status endpoint"""
        response = requests.get(quota_url)
        assert response.status_code == 200
        
        data = response.json()
        assert 'quota' in data
        assert 'used' in data['quota']
        assert 'remaining' in data['quota']
        assert 'total' in data['quota']
    
    def test_search_with_valid_query(self, api_url):
        """Test searching with a valid query"""
        query = "Circuit design tutorials for beginners"
        
        response = requests.post(api_url, json={"query": query})
        assert response.status_code == 200
        
        data = response.json()
        assert data['success'] == True
        assert data['query'] == query
        assert 'channelsFound' in data
        assert 'channelsAdded' in data
        assert 'duplicates' in data
        assert 'channels' in data
        assert isinstance(data['channels'], list)
        
        # If we got real results (not mock)
        if not data.get('warning'):
            assert data['channelsFound'] >= 0
            
            # Check channel structure
            for channel in data['channels']:
                assert 'name' in channel
                assert 'url' in channel
                assert 'channelId' in channel
                assert 'confidence' in channel
                assert 'source' in channel
                assert 'isNew' in channel
    
    def test_search_error_handling(self, api_url):
        """Test error handling for invalid requests"""
        # Test missing query
        response = requests.post(api_url, json={})
        assert response.status_code == 400
        assert 'error' in response.json()
        
        # Test invalid query type
        response = requests.post(api_url, json={"query": 123})
        assert response.status_code == 400
        assert 'error' in response.json()
        
        # Test empty query
        response = requests.post(api_url, json={"query": ""})
        assert response.status_code == 400
        assert 'error' in response.json()
    
    def test_duplicate_detection(self, api_url):
        """Test that duplicate channels are detected"""
        query = "Python programming tutorials"
        
        # First search
        response1 = requests.post(api_url, json={"query": query})
        assert response1.status_code == 200
        data1 = response1.json()
        
        if not data1.get('warning'):  # Only test with real data
            channels_added_first = data1['channelsAdded']
            
            # Small delay to ensure different timestamps
            time.sleep(1)
            
            # Second search with same query
            response2 = requests.post(api_url, json={"query": query})
            assert response2.status_code == 200
            data2 = response2.json()
            
            # All channels from second search should be duplicates
            assert data2['channelsFound'] > 0
            assert data2['duplicates'] == data2['channelsFound']
            assert data2['channelsAdded'] == 0
    
    def test_channel_url_formats(self, api_url):
        """Test detection of various YouTube channel URL formats"""
        queries = [
            "site:youtube.com/channel/UC",  # Channel ID format
            "site:youtube.com/@",            # Handle format
            "site:youtube.com/c/",           # Custom URL format
            "site:youtube.com/user/"         # Legacy user format
        ]
        
        for query in queries:
            response = requests.post(api_url, json={"query": query})
            assert response.status_code == 200
            
            data = response.json()
            if not data.get('warning') and data['channelsFound'] > 0:
                # Verify at least one channel was extracted
                assert len(data['channels']) > 0
    
    def test_quota_tracking(self, api_url, quota_url):
        """Test that quota is properly tracked"""
        # Get initial quota
        quota_response = requests.get(quota_url)
        initial_quota = quota_response.json()['quota']
        initial_used = initial_quota['used']
        
        # Perform a search
        response = requests.post(api_url, json={"query": "Electronics tutorials"})
        
        if response.status_code == 200 and not response.json().get('warning'):
            # Get updated quota
            quota_response = requests.get(quota_url)
            updated_quota = quota_response.json()['quota']
            
            # Quota should have increased by 1
            assert updated_quota['used'] == initial_used + 1
            assert updated_quota['remaining'] == initial_quota['remaining'] - 1
    
    def test_concurrent_searches(self, api_url):
        """Test handling of concurrent search requests"""
        import concurrent.futures
        
        queries = [
            "3D printing tutorials",
            "Arduino projects",
            "Raspberry Pi guides",
            "Electronics basics"
        ]
        
        def search(query):
            return requests.post(api_url, json={"query": query})
        
        # Execute searches concurrently
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
            futures = [executor.submit(search, q) for q in queries]
            responses = [f.result() for f in concurrent.futures.as_completed(futures)]
        
        # All should succeed or hit quota limit
        for response in responses:
            assert response.status_code in [200, 429]
    
    @pytest.mark.parametrize("special_query", [
        "C++ programming",
        "C# tutorials",
        "Node.js guides",
        "Vue.js framework",
        "Teaching \"Python\" basics",
        "Channel with special chars: !@#$"
    ])
    def test_special_characters_in_queries(self, api_url, special_query):
        """Test queries with special characters"""
        response = requests.post(api_url, json={"query": special_query})
        assert response.status_code == 200
        
        data = response.json()
        assert data['success'] == True
        assert data['query'] == special_query


class TestDatabaseIntegration:
    """Test database operations for discovered channels"""
    
    @pytest.mark.skipif(not os.getenv('SUPABASE_SERVICE_ROLE_KEY'), 
                        reason="Requires Supabase credentials")
    def test_channel_storage(self):
        """Test that channels are properly stored in the database"""
        from supabase import create_client, Client
        
        url = os.getenv('NEXT_PUBLIC_SUPABASE_URL')
        key = os.getenv('SUPABASE_SERVICE_ROLE_KEY')
        
        if not url or not key:
            pytest.skip("Supabase credentials not configured")
        
        supabase: Client = create_client(url, key)
        
        # Query recent discovered channels
        response = supabase.table('discovered_channels') \
            .select('*') \
            .eq('discovery_method', 'google_pse') \
            .order('discovered_at', desc=True) \
            .limit(10) \
            .execute()
        
        if response.data:
            # Verify channel structure
            for channel in response.data:
                assert 'channel_id' in channel
                assert 'channel_title' in channel
                assert 'discovery_method' in channel
                assert channel['discovery_method'] == 'google_pse'
                assert 'search_query' in channel
                assert 'discovered_at' in channel
                assert 'is_processed' in channel


if __name__ == '__main__':
    print("Running Google PSE Integration Tests")
    print(f"Testing against: {BASE_URL}")
    print("\nMake sure the Next.js dev server is running!")
    print("Run with: npm run dev\n")
    
    pytest.main([__file__, '-v', '-s'])