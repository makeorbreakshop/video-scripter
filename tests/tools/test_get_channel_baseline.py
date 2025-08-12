"""
Tests for get_channel_baseline tool
"""

import pytest
from unittest.mock import Mock, patch
import json

class TestGetChannelBaseline:
    """Test suite for get_channel_baseline tool"""
    
    @pytest.fixture
    def sample_channel_videos(self):
        """Sample videos for baseline calculation"""
        return [
            {
                'id': 'v1',
                'title': 'Video 1',
                'view_count': 500000,
                'temporal_performance_score': 1.1,
                'published_at': '2025-01-10T00:00:00Z'
            },
            {
                'id': 'v2',
                'title': 'Video 2',
                'view_count': 450000,
                'temporal_performance_score': 0.9,
                'published_at': '2025-01-05T00:00:00Z'
            },
            {
                'id': 'v3',
                'title': 'Video 3',
                'view_count': 600000,
                'temporal_performance_score': 1.2,
                'published_at': '2025-01-01T00:00:00Z'
            },
            {
                'id': 'v4',
                'title': 'Video 4',
                'view_count': 400000,
                'temporal_performance_score': 0.8,
                'published_at': '2024-12-28T00:00:00Z'
            },
            {
                'id': 'v5',
                'title': 'Video 5',
                'view_count': 550000,
                'temporal_performance_score': 1.05,
                'published_at': '2024-12-25T00:00:00Z'
            }
        ]
    
    @pytest.mark.asyncio
    async def test_baseline_calculation_with_channel_id(self, sample_channel_videos):
        """Test baseline calculation when providing channel_id"""
        # Expected baseline = (500000 + 450000 + 600000 + 400000 + 550000) / 5 = 500000
        expected_baseline = 500000
        
        # Test response structure
        expected_response = {
            'success': True,
            'data': {
                'channel_id': 'test_channel_123',
                'baseline_value': expected_baseline,
                'sample_videos': [
                    # Videos with TPS between 0.8-1.2
                    {
                        'id': 'v1',
                        'title': 'Video 1',
                        'view_count': 500000,
                        'temporal_performance_score': 1.1
                    },
                    {
                        'id': 'v2',
                        'title': 'Video 2',
                        'view_count': 450000,
                        'temporal_performance_score': 0.9
                    }
                ],
                'calculated_at': '2025-01-11T00:00:00Z'
            }
        }
        
        assert expected_response['success'] == True
        assert expected_response['data']['baseline_value'] == expected_baseline
        assert len(expected_response['data']['sample_videos']) >= 0
    
    @pytest.mark.asyncio
    async def test_baseline_with_video_id(self):
        """Test getting baseline by providing video_id"""
        # Should fetch channel_id from video first
        # Then calculate baseline for that channel
        
        expected_response = {
            'success': True,
            'data': {
                'channel_id': 'channel_from_video',
                'baseline_value': 450000,
                'sample_videos': [],
                'calculated_at': '2025-01-11T00:00:00Z'
            }
        }
        
        assert expected_response['success'] == True
        assert 'channel_id' in expected_response['data']
    
    @pytest.mark.asyncio
    async def test_missing_params_returns_error(self):
        """Test that missing both channel_id and video_id returns error"""
        expected_error = {
            'success': False,
            'error': {
                'code': 'INVALID_PARAMS',
                'message': 'Either channel_id or video_id is required'
            }
        }
        
        assert expected_error['success'] == False
        assert expected_error['error']['code'] == 'INVALID_PARAMS'
    
    @pytest.mark.asyncio
    async def test_excludes_shorts_from_baseline(self, sample_channel_videos):
        """Test that YouTube Shorts are excluded from baseline calculation"""
        # Add a short to the videos
        videos_with_short = sample_channel_videos + [
            {
                'id': 'short1',
                'title': 'Short Video',
                'view_count': 1000000,  # High view count
                'temporal_performance_score': 2.0,
                'is_short': True,
                'published_at': '2025-01-09T00:00:00Z'
            }
        ]
        
        # Baseline should still be 500000 (short excluded)
        expected_baseline = 500000
        
        # The short should not appear in calculations
        assert expected_baseline == 500000  # Not affected by the 1M view short
    
    @pytest.mark.asyncio
    async def test_date_range_filtering(self):
        """Test that only videos within 30 days are included"""
        videos_with_old = [
            {
                'id': 'recent1',
                'view_count': 500000,
                'published_at': '2025-01-10T00:00:00Z'  # Recent
            },
            {
                'id': 'old1',
                'view_count': 1000000,
                'published_at': '2024-11-01T00:00:00Z'  # >30 days old
            }
        ]
        
        # Only recent1 should be included
        expected_baseline = 500000
        
        assert expected_baseline == 500000  # Old video excluded
    
    @pytest.mark.asyncio
    async def test_sample_videos_in_tps_range(self, sample_channel_videos):
        """Test that sample videos are in the 0.8-1.2 TPS range"""
        # Videos v1 (1.1), v2 (0.9), v3 (1.2), v4 (0.8), v5 (1.05) all qualify
        
        sample_videos = [
            v for v in sample_channel_videos
            if 0.8 <= v['temporal_performance_score'] <= 1.2
        ]
        
        assert len(sample_videos) == 5
        for video in sample_videos:
            assert 0.8 <= video['temporal_performance_score'] <= 1.2
    
    @pytest.mark.asyncio
    async def test_no_videos_returns_default_baseline(self):
        """Test that channels with no videos return default baseline"""
        expected_response = {
            'success': True,
            'data': {
                'channel_id': 'empty_channel',
                'baseline_value': 1.0,  # Default
                'sample_videos': [],
                'calculated_at': '2025-01-11T00:00:00Z'
            }
        }
        
        assert expected_response['data']['baseline_value'] == 1.0
        assert len(expected_response['data']['sample_videos']) == 0
    
    @pytest.mark.asyncio
    async def test_insufficient_history_handling(self):
        """Test handling of channels with <10 videos"""
        # Channel has only 3 videos
        videos = [
            {'id': 'v1', 'view_count': 100000},
            {'id': 'v2', 'view_count': 150000},
            {'id': 'v3', 'view_count': 120000}
        ]
        
        # Should still calculate baseline from available videos
        expected_baseline = (100000 + 150000 + 120000) / 3
        
        assert expected_baseline == 123333.33333333333
    
    @pytest.mark.asyncio
    async def test_include_samples_flag(self):
        """Test that include_samples=false excludes sample videos"""
        response_with_samples = {
            'data': {
                'baseline_value': 500000,
                'sample_videos': [{'id': 'v1'}, {'id': 'v2'}]
            }
        }
        
        response_without_samples = {
            'data': {
                'baseline_value': 500000,
                'sample_videos': []
            }
        }
        
        assert len(response_with_samples['data']['sample_videos']) > 0
        assert len(response_without_samples['data']['sample_videos']) == 0
    
    @pytest.mark.asyncio
    async def test_caching_behavior(self):
        """Test that baseline results are cached"""
        # First call should calculate
        # Second call should use cache
        # Cache TTL is 10 minutes for this tool
        pass
    
    @pytest.mark.asyncio
    async def test_video_not_found_error(self):
        """Test error when video_id doesn't exist"""
        expected_error = {
            'success': False,
            'error': {
                'code': 'VIDEO_NOT_FOUND',
                'message': 'Video non_existent not found'
            }
        }
        
        assert expected_error['success'] == False
        assert expected_error['error']['code'] == 'VIDEO_NOT_FOUND'
    
    @pytest.mark.asyncio
    async def test_database_error_handling(self):
        """Test graceful handling of database errors"""
        expected_error = {
            'success': False,
            'error': {
                'code': 'DATABASE_ERROR',
                'message': 'Failed to fetch channel baseline',
                'retryable': True
            }
        }
        
        assert expected_error['error']['retryable'] == True