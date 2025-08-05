"""
Comprehensive pytest tests for Google PSE search endpoint
Tests the full search process including:
- API endpoint functionality
- Channel discovery and extraction
- Database insertion
- Quota management
- Error handling
"""

import pytest
import json
from unittest.mock import patch, MagicMock, AsyncMock
from datetime import datetime
import os
import sys

# Add the project root to the Python path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Mock the Next.js specific imports before importing the modules
sys.modules['next/server'] = MagicMock()


class TestGooglePSESearch:
    """Test Google PSE search functionality end-to-end"""
    
    @pytest.fixture
    def mock_env(self, monkeypatch):
        """Set up environment variables for testing"""
        monkeypatch.setenv('GOOGLE_PSE_API_KEY', 'test-api-key')
        monkeypatch.setenv('GOOGLE_PSE_ENGINE_ID', 'test-engine-id')
        monkeypatch.setenv('YOUTUBE_API_KEY', 'test-youtube-key')
        monkeypatch.setenv('NEXT_PUBLIC_SUPABASE_URL', 'https://test.supabase.co')
        monkeypatch.setenv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'test-anon-key')
    
    @pytest.fixture
    def mock_pse_response(self):
        """Mock Google PSE API response"""
        return {
            "kind": "customsearch#search",
            "url": {
                "type": "application/json",
                "template": "https://www.googleapis.com/customsearch/v1?q={searchTerms}"
            },
            "queries": {
                "request": [{
                    "title": "Google Custom Search - Circuit design tutorials",
                    "totalResults": "2500",
                    "searchTerms": "Circuit design tutorials site:youtube.com",
                    "count": 10,
                    "startIndex": 1,
                    "inputEncoding": "utf8",
                    "outputEncoding": "utf8",
                    "safe": "off",
                    "cx": "test-engine-id"
                }]
            },
            "context": {
                "title": "YouTube Search"
            },
            "searchInformation": {
                "searchTime": 0.315159,
                "formattedSearchTime": "0.32",
                "totalResults": "2500",
                "formattedTotalResults": "2,500"
            },
            "items": [
                {
                    "kind": "customsearch#result",
                    "title": "Circuit Design Tutorial - Complete Course - YouTube",
                    "htmlTitle": "<b>Circuit Design Tutorial</b> - Complete Course - YouTube",
                    "link": "https://www.youtube.com/watch?v=fJeqYXbnZ4U",
                    "displayLink": "www.youtube.com",
                    "snippet": "Learn circuit design from scratch in this comprehensive tutorial by Electronics Academy",
                    "htmlSnippet": "Learn <b>circuit design</b> from scratch in this comprehensive tutorial",
                    "formattedUrl": "https://www.youtube.com/watch?v=fJeqYXbnZ4U",
                    "htmlFormattedUrl": "https://www.youtube.com/watch?v=fJeqYXbnZ4U",
                    "pagemap": {
                        "videoobject": [{
                            "name": "Circuit Design Tutorial - Complete Course",
                            "description": "Learn circuit design from scratch",
                            "thumbnailurl": "https://i.ytimg.com/vi/fJeqYXbnZ4U/maxresdefault.jpg",
                            "uploaddate": "2024-01-15",
                            "duration": "PT2H30M",
                            "author": "Electronics Academy",
                            "channelid": "UCabcdef123456789012345678"
                        }],
                        "person": [{
                            "name": "Electronics Academy",
                            "url": "https://www.youtube.com/@ElectronicsAcademy"
                        }]
                    }
                },
                {
                    "kind": "customsearch#result",
                    "title": "PCB Design Pro - YouTube",
                    "htmlTitle": "PCB Design Pro - YouTube",
                    "link": "https://www.youtube.com/channel/UCxyz123456789012345678",
                    "displayLink": "www.youtube.com",
                    "snippet": "Professional PCB design tutorials and tips. Learn KiCad, Altium, and Eagle.",
                    "htmlSnippet": "Professional <b>PCB design</b> tutorials and tips",
                    "formattedUrl": "https://www.youtube.com/channel/UCxyz123456789012345678",
                    "htmlFormattedUrl": "https://www.youtube.com/channel/UCxyz123456789012345678"
                },
                {
                    "kind": "customsearch#result",
                    "title": "Circuit Basics - Beginner Electronics - YouTube",
                    "htmlTitle": "<b>Circuit</b> Basics - Beginner Electronics - YouTube",
                    "link": "https://www.youtube.com/@CircuitBasics",
                    "displayLink": "www.youtube.com",
                    "snippet": "Learn electronics and circuit design with easy to follow tutorials",
                    "htmlSnippet": "Learn electronics and <b>circuit design</b> with easy to follow tutorials",
                    "formattedUrl": "https://www.youtube.com/@CircuitBasics",
                    "htmlFormattedUrl": "https://www.youtube.com/@CircuitBasics"
                }
            ]
        }
    
    @pytest.fixture
    def mock_supabase_client(self):
        """Mock Supabase client"""
        mock_client = MagicMock()
        
        # Mock the from() method chain
        mock_table = MagicMock()
        mock_client.from_ = MagicMock(return_value=mock_table)
        mock_client.from_.return_value = mock_table
        
        # Set up the chain for select queries
        mock_select = MagicMock()
        mock_table.select = MagicMock(return_value=mock_select)
        mock_in = MagicMock()
        mock_select.in_ = MagicMock(return_value=mock_in)
        
        # Return empty data for existing channels check (all channels are new)
        mock_in.execute = MagicMock(return_value=MagicMock(data=[]))
        
        # Set up insert
        mock_table.insert = MagicMock(return_value=MagicMock(
            execute=MagicMock(return_value=MagicMock(error=None))
        ))
        
        return mock_client
    
    @pytest.mark.asyncio
    async def test_successful_search_with_new_channels(self, mock_env, mock_pse_response, mock_supabase_client):
        """Test successful search that discovers new channels"""
        from lib.google_pse_service import googlePSE
        
        # Mock the fetch call
        with patch('lib.google_pse_service.fetch') as mock_fetch:
            mock_response = MagicMock()
            mock_response.ok = True
            mock_response.json = AsyncMock(return_value=mock_pse_response)
            mock_fetch.return_value = mock_response
            
            # Mock supabase client
            with patch('lib.supabase_client.supabase', mock_supabase_client):
                # Perform search
                result = await googlePSE.searchYouTube("Circuit design tutorials")
                
                # Verify API was called correctly
                mock_fetch.assert_called_once()
                call_args = mock_fetch.call_args[0][0]
                assert 'key=test-api-key' in call_args
                assert 'cx=test-engine-id' in call_args
                assert 'q=Circuit+design+tutorials+site%3Ayoutube.com' in call_args
                
                # Verify results
                assert result['totalResults'] == 2500
                assert len(result['results']) == 3
                
                # Check first channel extraction (from video)
                first_channel = result['results'][0]
                assert first_channel['channelName'] == 'Electronics Academy'
                assert first_channel['channelId'] == 'UCabcdef123456789012345678'
                assert first_channel['channelUrl'] == 'https://youtube.com/@ElectronicsAcademy'
                assert first_channel['videoTitle'] == 'Circuit Design Tutorial - Complete Course'
                assert first_channel['confidence'] == 'high'
                assert first_channel['source'] == 'video'
                
                # Check second channel extraction (direct channel)
                second_channel = result['results'][1]
                assert second_channel['channelName'] == 'PCB Design Pro'
                assert second_channel['channelId'] == 'UCxyz123456789012345678'
                assert second_channel['channelUrl'] == 'https://www.youtube.com/channel/UCxyz123456789012345678'
                assert second_channel['confidence'] == 'high'
                assert second_channel['source'] == 'channel'
                
                # Check third channel extraction (@ handle)
                third_channel = result['results'][2]
                assert third_channel['channelName'] == 'Circuit Basics - Beginner Electronics'
                assert third_channel['channelUrl'] == 'https://www.youtube.com/@CircuitBasics'
                assert third_channel['confidence'] == 'medium'  # No channel ID
                assert third_channel['source'] == 'channel'
    
    @pytest.mark.asyncio
    async def test_database_insertion(self, mock_env, mock_pse_response, mock_supabase_client):
        """Test that channels are correctly inserted into the database"""
        from app.api.google_pse.search.route import POST
        from next.server import NextRequest
        
        # Create mock request
        mock_request = MagicMock(spec=NextRequest)
        mock_request.json = AsyncMock(return_value={'query': 'Circuit design tutorials'})
        
        # Mock the PSE service
        with patch('lib.google_pse_service.googlePSE.searchYouTube') as mock_search:
            mock_search.return_value = {
                'results': [
                    {
                        'channelId': 'UCabcdef123456789012345678',
                        'channelName': 'Electronics Academy',
                        'channelUrl': 'https://youtube.com/@ElectronicsAcademy',
                        'videoTitle': 'Circuit Design Tutorial',
                        'videoUrl': 'https://youtube.com/watch?v=abc123',
                        'confidence': 'high',
                        'source': 'video'
                    },
                    {
                        'channelId': '',
                        'channelName': 'Circuit Basics',
                        'channelUrl': 'https://youtube.com/@CircuitBasics',
                        'confidence': 'medium',
                        'source': 'channel'
                    }
                ],
                'totalResults': 100
            }
            
            with patch('app.api.google_pse.search.route.supabase', mock_supabase_client):
                # Call the endpoint
                response = await POST(mock_request)
                result = await response.json()
                
                # Verify response
                assert result['success'] == True
                assert result['channelsFound'] == 2
                assert result['channelsAdded'] == 2
                assert result['duplicates'] == 0
                
                # Verify database insert was called
                mock_supabase_client.from_.assert_called_with('discovered_channels')
                insert_call = mock_supabase_client.from_.return_value.insert
                insert_call.assert_called_once()
                
                # Check inserted data
                inserted_data = insert_call.call_args[0][0]
                assert len(inserted_data) == 2
                
                # Check first channel
                first_channel = inserted_data[0]
                assert first_channel['channel_id'] == 'UCabcdef123456789012345678'
                assert first_channel['channel_title'] == 'Electronics Academy'
                assert first_channel['custom_url'] == 'https://youtube.com/@ElectronicsAcademy'
                assert first_channel['discovery_method'] == 'google_pse'
                assert first_channel['search_query'] == 'Circuit design tutorials'
                assert first_channel['is_processed'] == False
                assert first_channel['api_verified'] == False
                
                # Check second channel (with temporary ID)
                second_channel = inserted_data[1]
                assert second_channel['channel_id'].startswith('temp_')
                assert second_channel['channel_title'] == 'Circuit Basics'
    
    @pytest.mark.asyncio
    async def test_quota_management(self, mock_env):
        """Test quota tracking and limits"""
        from lib.google_pse_service import googlePSE
        
        # Reset quota
        googlePSE.dailyQuotaUsed = 0
        
        # Check initial quota
        quota = googlePSE.getQuotaStatus()
        assert quota['used'] == 0
        assert quota['remaining'] == 100
        assert quota['total'] == 100
        
        # Mock a successful search
        with patch('lib.google_pse_service.fetch') as mock_fetch:
            mock_response = MagicMock()
            mock_response.ok = True
            mock_response.json = AsyncMock(return_value={'items': []})
            mock_fetch.return_value = mock_response
            
            # Perform search
            await googlePSE.searchYouTube("test query")
            
            # Check quota was incremented
            quota = googlePSE.getQuotaStatus()
            assert quota['used'] == 1
            assert quota['remaining'] == 99
        
        # Test quota exhaustion
        googlePSE.dailyQuotaUsed = 100
        result = await googlePSE.searchYouTube("test query")
        assert result['error'] == 'Google PSE daily quota exceeded (100/100). Try again tomorrow.'
        assert result['results'] == []
    
    @pytest.mark.asyncio
    async def test_duplicate_channel_detection(self, mock_env, mock_supabase_client):
        """Test that duplicate channels are not re-inserted"""
        from app.api.google_pse.search.route import POST
        from next.server import NextRequest
        
        # Configure mock to return existing channels
        mock_supabase_client.from_.return_value.select.return_value.in_.return_value.execute.return_value = MagicMock(
            data=[
                {'channel_url': 'https://youtube.com/@ElectronicsAcademy'},
                {'channel_url': 'https://youtube.com/@CircuitBasics'}
            ]
        )
        
        # Create mock request
        mock_request = MagicMock(spec=NextRequest)
        mock_request.json = AsyncMock(return_value={'query': 'Circuit design'})
        
        # Mock PSE service to return channels
        with patch('lib.google_pse_service.googlePSE.searchYouTube') as mock_search:
            mock_search.return_value = {
                'results': [
                    {
                        'channelName': 'Electronics Academy',
                        'channelUrl': 'https://youtube.com/@ElectronicsAcademy',
                        'channelId': 'UCabc123',
                        'confidence': 'high',
                        'source': 'channel'
                    },
                    {
                        'channelName': 'Circuit Basics',
                        'channelUrl': 'https://youtube.com/@CircuitBasics',
                        'channelId': '',
                        'confidence': 'medium',
                        'source': 'channel'
                    },
                    {
                        'channelName': 'New Channel',
                        'channelUrl': 'https://youtube.com/@NewChannel',
                        'channelId': '',
                        'confidence': 'medium',
                        'source': 'channel'
                    }
                ],
                'totalResults': 50
            }
            
            with patch('app.api.google_pse.search.route.supabase', mock_supabase_client):
                response = await POST(mock_request)
                result = await response.json()
                
                # Verify response
                assert result['channelsFound'] == 3
                assert result['channelsAdded'] == 1  # Only new channel
                assert result['duplicates'] == 2
                
                # Verify only new channel was inserted
                insert_call = mock_supabase_client.from_.return_value.insert
                inserted_data = insert_call.call_args[0][0]
                assert len(inserted_data) == 1
                assert inserted_data[0]['channel_title'] == 'New Channel'
    
    @pytest.mark.asyncio
    async def test_error_handling(self, mock_env):
        """Test various error scenarios"""
        from app.api.google_pse.search.route import POST
        from next.server import NextRequest
        
        # Test missing query
        mock_request = MagicMock(spec=NextRequest)
        mock_request.json = AsyncMock(return_value={})
        
        response = await POST(mock_request)
        result = await response.json()
        assert response.status == 400
        assert result['error'] == 'Query is required'
        
        # Test invalid query type
        mock_request.json = AsyncMock(return_value={'query': 123})
        response = await POST(mock_request)
        result = await response.json()
        assert response.status == 400
        assert result['error'] == 'Query is required'
        
        # Test API error
        with patch('lib.google_pse_service.googlePSE.searchYouTube') as mock_search:
            mock_search.return_value = {
                'results': [],
                'totalResults': 0,
                'error': 'API rate limit exceeded'
            }
            
            mock_request.json = AsyncMock(return_value={'query': 'test'})
            response = await POST(mock_request)
            result = await response.json()
            assert response.status == 400
            assert result['error'] == 'API rate limit exceeded'
    
    @pytest.mark.asyncio
    async def test_mock_data_when_not_configured(self, monkeypatch):
        """Test that mock data is returned when PSE is not configured"""
        # Clear PSE configuration
        monkeypatch.delenv('GOOGLE_PSE_API_KEY', raising=False)
        monkeypatch.delenv('GOOGLE_PSE_ENGINE_ID', raising=False)
        
        from app.api.google_pse.search.route import POST
        from next.server import NextRequest
        
        mock_request = MagicMock(spec=NextRequest)
        mock_request.json = AsyncMock(return_value={'query': 'Circuit design'})
        
        with patch('lib.google_pse_service.googlePSE.isConfigured', return_value=False):
            response = await POST(mock_request)
            result = await response.json()
            
            assert result['success'] == True
            assert result['warning'] == 'Using mock data - Google PSE not configured'
            assert len(result['channels']) == 3
            assert result['channels'][0]['name'] == 'Circuit Design Tutorial Channel'
    
    @pytest.mark.asyncio
    async def test_channel_extraction_edge_cases(self, mock_env):
        """Test edge cases in channel extraction"""
        from lib.google_pse_service import GooglePSEService
        
        service = GooglePSEService()
        
        # Test video with missing channel info
        result1 = service.extractChannelFromResult({
            'link': 'https://www.youtube.com/watch?v=abc123',
            'title': 'Some Video',
            'snippet': 'A video without channel info',
            'pagemap': {}
        })
        assert result1 is None
        
        # Test channel with special characters in name
        result2 = service.extractChannelFromResult({
            'link': 'https://www.youtube.com/@Tech-Channel_123',
            'title': 'Tech Channel #123 - YouTube',
            'snippet': 'Tech tutorials and more'
        })
        assert result2 is not None
        assert result2['channelName'] == 'Tech Channel #123'
        assert result2['channelUrl'] == 'https://www.youtube.com/@Tech-Channel_123'
        
        # Test old-style user URL
        result3 = service.extractChannelFromResult({
            'link': 'https://www.youtube.com/user/OldStyleUser',
            'title': 'Old Style Channel - YouTube',
            'snippet': 'Legacy channel URL format'
        })
        assert result3 is not None
        assert result3['channelUrl'] == 'https://www.youtube.com/user/OldStyleUser'
        assert result3['confidence'] == 'medium'
    
    @pytest.mark.asyncio
    async def test_batch_search_functionality(self, mock_env):
        """Test batch search with multiple queries"""
        from lib.google_pse_service import googlePSE
        
        # Mock multiple searches
        with patch.object(googlePSE, 'searchYouTube') as mock_search:
            mock_search.side_effect = [
                {'results': [{'channelName': 'Channel1', 'channelUrl': 'url1'}], 'totalResults': 10},
                {'results': [{'channelName': 'Channel2', 'channelUrl': 'url2'}], 'totalResults': 20},
                {'results': [{'channelName': 'Channel1', 'channelUrl': 'url1'}], 'totalResults': 15},  # Duplicate
            ]
            
            result = await googlePSE.batchSearchYouTube(
                ['query1', 'query2', 'query3'],
                {'dedupeChannels': True}
            )
            
            assert result['totalSearches'] == 3
            assert result['totalResults'] == 45
            assert len(result['channels']) == 2  # Deduped
            assert result['errors'] == []


if __name__ == '__main__':
    pytest.main([__file__, '-v', '-s'])