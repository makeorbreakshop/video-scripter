"""
Unit tests for get_video_bundle tool handler
Tests the handler function directly without HTTP layer
"""

import pytest
from unittest.mock import Mock, patch, MagicMock
import sys
import os

# Add project root to path for imports
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../..')))

@pytest.mark.asyncio
class TestGetVideoBundleHandler:
    """Unit tests for get_video_bundle handler"""
    
    @patch('app.api.tools.get-video-bundle.route.supabase')
    async def test_valid_video_returns_bundle(self, mock_supabase, sample_video_data):
        """Test that valid video ID returns complete bundle"""
        # Import here to avoid import errors before patching
        from app.api.tools.get_video_bundle.route import getVideoBundleHandler
        
        # Setup mock responses
        mock_supabase.from_.return_value.select.return_value.eq.return_value.single.return_value = {
            'data': sample_video_data,
            'error': None
        }
        
        # Mock analysis data
        mock_supabase.from_.return_value.select.return_value.eq.return_value.single.return_value = {
            'data': {'summary': 'Test summary of the video content'},
            'error': None
        }
        
        # Call handler
        result = await getVideoBundleHandler({'video_id': 'test_video_123'})
        
        # Assertions
        assert result['success'] == True
        assert result['data']['id'] == 'test_video_123'
        assert result['data']['temporal_performance_score'] == 3.5
        assert result['data']['channel_baseline_at_publish'] == 500000
        assert 'thumbnail_url' in result['data']
        assert 'summary' in result['data']
    
    @patch('app.api.tools.get-video-bundle.route.supabase')
    async def test_missing_video_id_returns_error(self, mock_supabase):
        """Test that missing video_id returns error"""
        from app.api.tools.get_video_bundle.route import getVideoBundleHandler
        
        # Call handler without video_id
        result = await getVideoBundleHandler({})
        
        # Assertions
        assert result['success'] == False
        assert result['error']['code'] == 'INVALID_PARAMS'
        assert 'video_id is required' in result['error']['message']
    
    @patch('app.api.tools.get-video-bundle.route.supabase')
    async def test_video_not_found_returns_error(self, mock_supabase):
        """Test that non-existent video returns appropriate error"""
        from app.api.tools.get_video_bundle.route import getVideoBundleHandler
        
        # Setup mock to return no data
        mock_supabase.from_.return_value.select.return_value.eq.return_value.single.return_value = {
            'data': None,
            'error': {'message': 'Video not found'}
        }
        
        # Call handler
        result = await getVideoBundleHandler({'video_id': 'non_existent'})
        
        # Assertions
        assert result['success'] == False
        assert result['error']['code'] == 'VIDEO_NOT_FOUND'
        assert 'not found' in result['error']['message'].lower()
    
    @patch('app.api.tools.get-video-bundle.route.supabase')
    async def test_calculates_tps_when_missing(self, mock_supabase):
        """Test that TPS is calculated when missing"""
        from app.api.tools.get_video_bundle.route import getVideoBundleHandler
        
        # Video data with null TPS
        video_data = {
            'id': 'test_video',
            'title': 'Test Video',
            'channel_id': 'test_channel',
            'channel_name': 'Test Channel',
            'view_count': 1000000,
            'published_at': '2025-01-01T00:00:00Z',
            'temporal_performance_score': None,  # Missing TPS
            'channel_baseline_at_publish': 200000,
            'is_short': False,
            'format_type': 'Tutorial',
            'topic_niche': 'Tech',
            'thumbnail_url': 'https://example.com/thumb.jpg'
        }
        
        mock_supabase.from_.return_value.select.return_value.eq.return_value.single.return_value = {
            'data': video_data,
            'error': None
        }
        
        # Call handler
        result = await getVideoBundleHandler({'video_id': 'test_video'})
        
        # Assertions
        assert result['success'] == True
        # TPS should be calculated as 1000000 / 200000 = 5.0
        assert result['data']['temporal_performance_score'] == 5.0
    
    @patch('app.api.tools.get-video-bundle.route.supabase')
    async def test_uses_default_baseline_when_missing(self, mock_supabase):
        """Test that default baseline is used when missing"""
        from app.api.tools.get_video_bundle.route import getVideoBundleHandler
        
        # Video data with null baseline
        video_data = {
            'id': 'test_video',
            'title': 'Test Video',
            'channel_id': 'test_channel',
            'channel_name': 'Test Channel',
            'view_count': 500000,
            'published_at': '2025-01-01T00:00:00Z',
            'temporal_performance_score': None,
            'channel_baseline_at_publish': None,  # Missing baseline
            'is_short': False
        }
        
        mock_supabase.from_.return_value.select.return_value.eq.return_value.single.return_value = {
            'data': video_data,
            'error': None
        }
        
        # Call handler
        result = await getVideoBundleHandler({'video_id': 'test_video'})
        
        # Assertions
        assert result['success'] == True
        assert result['data']['channel_baseline_at_publish'] == 1.0
    
    @patch('app.api.tools.get-video-bundle.route.supabase')
    async def test_database_error_handling(self, mock_supabase):
        """Test graceful handling of database errors"""
        from app.api.tools.get_video_bundle.route import getVideoBundleHandler
        
        # Setup mock to raise exception
        mock_supabase.from_.side_effect = Exception("Database connection failed")
        
        # Call handler
        result = await getVideoBundleHandler({'video_id': 'test_video'})
        
        # Assertions
        assert result['success'] == False
        assert result['error']['code'] == 'DATABASE_ERROR'
        assert result['error']['retryable'] == True
        assert 'Failed to fetch video data' in result['error']['message']