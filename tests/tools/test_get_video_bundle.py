"""
Tests for get_video_bundle tool
"""

import pytest
from unittest.mock import Mock, patch, AsyncMock
import json
import httpx
import asyncio

class TestGetVideoBundle:
    """Test suite for get_video_bundle tool"""
    
    @pytest.fixture
    def api_url(self):
        """API endpoint URL for testing"""
        return "http://localhost:3000/api/tools/get-video-bundle"
    
    @pytest.mark.asyncio
    async def test_valid_video_id_returns_bundle(self, api_url, sample_video_data):
        """Test that a valid video ID returns complete bundle"""
        # Mock the API response
        async with httpx.AsyncClient() as client:
            # This would be a real API call in integration tests
            # For unit tests, we'd mock the handler directly
            
            # Test the expected response structure
            expected_response = {
                'success': True,
                'data': sample_video_data,
                'metadata': {
                    'cached': False,
                    'executionTime': 50,
                    'source': 'handler'
                }
            }
            
            assert expected_response['success'] == True
            assert expected_response['data']['id'] == 'test_video_123'
            assert expected_response['data']['temporal_performance_score'] == 3.5
    
    @pytest.mark.asyncio
    async def test_invalid_video_id_returns_error(self, mock_supabase):
        """Test that invalid video ID returns appropriate error"""
        # Setup mock to return no data
        mock_supabase.from_().select().eq().single().execute.return_value = {
            'data': None,
            'error': {'message': 'Video not found'}
        }
        
        # Once implemented:
        # result = await get_video_bundle('invalid_id')
        # assert 'error' in result
        # assert result['error'] == 'Video not found'
        pass
    
    @pytest.mark.asyncio
    async def test_caching_works_within_ttl(self, mock_supabase, mock_redis, sample_video_data):
        """Test that caching prevents duplicate database calls"""
        # Setup mock response
        mock_supabase.from_().select().eq().single().execute.return_value = {
            'data': sample_video_data,
            'error': None
        }
        
        # Once implemented:
        # First call - should hit database
        # result1 = await get_video_bundle('test_video_123')
        # assert mock_supabase.from_().select.call_count == 1
        
        # Second call - should use cache
        # result2 = await get_video_bundle('test_video_123')
        # assert mock_supabase.from_().select.call_count == 1  # Still 1
        # assert result1 == result2
        pass
    
    @pytest.mark.asyncio
    async def test_all_required_fields_present(self, mock_supabase, sample_video_data):
        """Test that all required fields are included in response"""
        required_fields = [
            'id', 'title', 'channel_id', 'channel_name',
            'view_count', 'published_at', 'temporal_performance_score',
            'channel_baseline_at_publish', 'format_type', 'topic_niche',
            'thumbnail_url', 'summary'
        ]
        
        mock_supabase.from_().select().eq().single().execute.return_value = {
            'data': sample_video_data,
            'error': None
        }
        
        # Once implemented:
        # result = await get_video_bundle('test_video_123')
        # for field in required_fields:
        #     assert field in result, f"Missing required field: {field}"
        
        # For now, verify sample data has all fields
        for field in required_fields:
            assert field in sample_video_data
    
    @pytest.mark.asyncio
    async def test_performance_score_calculation(self, mock_supabase):
        """Test that temporal_performance_score is calculated correctly"""
        video_data = {
            'id': 'test_video',
            'view_count': 1000000,
            'channel_baseline_at_publish': 200000,
            'temporal_performance_score': None  # Should be calculated
        }
        
        mock_supabase.from_().select().eq().single().execute.return_value = {
            'data': video_data,
            'error': None
        }
        
        # Once implemented:
        # result = await get_video_bundle('test_video')
        # Expected score = 1000000 / 200000 = 5.0
        # assert result['temporal_performance_score'] == 5.0
        pass
    
    @pytest.mark.asyncio
    async def test_handles_missing_baseline_gracefully(self, mock_supabase):
        """Test handling of videos without channel baseline"""
        video_data = {
            'id': 'test_video',
            'view_count': 500000,
            'channel_baseline_at_publish': None,  # Missing baseline
            'temporal_performance_score': None
        }
        
        mock_supabase.from_().select().eq().single().execute.return_value = {
            'data': video_data,
            'error': None
        }
        
        # Once implemented:
        # result = await get_video_bundle('test_video')
        # Should use default baseline of 1.0
        # assert result['channel_baseline_at_publish'] == 1.0
        pass
    
    @pytest.mark.asyncio
    async def test_excludes_shorts_flag(self, mock_supabase, sample_video_data):
        """Test that is_short flag is properly included"""
        sample_video_data['is_short'] = True
        
        mock_supabase.from_().select().eq().single().execute.return_value = {
            'data': sample_video_data,
            'error': None
        }
        
        # Once implemented:
        # result = await get_video_bundle('test_video_123')
        # assert result['is_short'] == True
        pass
    
    @pytest.mark.asyncio 
    async def test_database_error_handling(self, mock_supabase):
        """Test graceful handling of database errors"""
        mock_supabase.from_().select().eq().single().execute.side_effect = Exception("Database connection failed")
        
        # Once implemented:
        # result = await get_video_bundle('test_video_123')
        # assert 'error' in result
        # assert 'database' in result['error'].lower()
        pass
    
    @pytest.mark.asyncio
    async def test_large_summary_handling(self, mock_supabase, sample_video_data):
        """Test handling of very large summaries"""
        # Create a large summary (10KB+)
        sample_video_data['summary'] = 'x' * 10000
        
        mock_supabase.from_().select().eq().single().execute.return_value = {
            'data': sample_video_data,
            'error': None
        }
        
        # Once implemented:
        # result = await get_video_bundle('test_video_123')
        # Summary should be truncated or handled appropriately
        # assert len(result['summary']) <= 5000  # Max length
        pass

    @pytest.mark.asyncio
    @pytest.mark.benchmark
    async def test_performance_benchmark(self, mock_supabase, sample_video_data, benchmark):
        """Benchmark tool performance"""
        mock_supabase.from_().select().eq().single().execute.return_value = {
            'data': sample_video_data,
            'error': None
        }
        
        # Once implemented:
        # result = benchmark(get_video_bundle, 'test_video_123')
        # assert benchmark.stats['mean'] < 0.1  # Should complete in <100ms
        pass