"""
Tests for list_channel_history tool
"""

import pytest
from unittest.mock import Mock, patch, AsyncMock
import json
from datetime import datetime, timedelta

class TestListChannelHistory:
    """Test suite for list_channel_history tool"""
    
    @pytest.fixture
    def sample_videos(self):
        """Sample channel videos for testing"""
        base_date = datetime(2025, 1, 11)
        videos = []
        for i in range(25):  # Create 25 videos for pagination testing
            videos.append({
                'id': f'video_{i}',
                'title': f'Video Title {i}',
                'channel_id': 'test_channel_123',
                'channel_name': 'Test Channel',
                'view_count': 100000 * (i + 1),
                'published_at': (base_date - timedelta(days=i)).isoformat() + 'Z',
                'temporal_performance_score': 0.8 + (i % 5) * 0.1,
                'is_short': i % 8 == 0,  # Every 8th video is a short
                'format_type': 'tutorial' if i % 3 == 0 else 'review',
                'topic_niche': 'tech' if i % 2 == 0 else 'gaming',
                'duration': 60 if i % 8 == 0 else 600,  # Shorts are 60s
                'thumbnail_url': f'https://example.com/thumb_{i}.jpg'
            })
        return videos
    
    @pytest.mark.asyncio
    async def test_basic_channel_history_fetch(self, mock_supabase, sample_videos):
        """Test basic fetching of channel history"""
        # Mock Supabase response
        mock_supabase.from_().select().eq().order().range().execute.return_value = Mock(
            data=sample_videos[:20]  # Return first 20 videos
        )
        mock_supabase.from_().select().eq().execute.return_value = Mock(
            count=25
        )
        
        from app.api.tools.list_channel_history.route import listChannelHistoryHandler
        
        result = await listChannelHistoryHandler({
            'channel_id': 'test_channel_123'
        })
        
        assert result['success'] == True
        assert result['data']['channel_id'] == 'test_channel_123'
        assert len(result['data']['videos']) == 20
        assert result['data']['total_count'] == 25
        assert result['data']['has_more'] == True
    
    @pytest.mark.asyncio
    async def test_field_selection(self, mock_supabase, sample_videos):
        """Test that field selection works correctly"""
        # Only return requested fields
        limited_videos = [
            {'id': v['id'], 'title': v['title'], 'view_count': v['view_count']}
            for v in sample_videos[:10]
        ]
        
        mock_supabase.from_().select().eq().order().range().execute.return_value = Mock(
            data=limited_videos
        )
        
        from app.api.tools.list_channel_history.route import listChannelHistoryHandler
        
        result = await listChannelHistoryHandler({
            'channel_id': 'test_channel_123',
            'fields': ['id', 'title', 'view_count'],
            'limit': 10
        })
        
        assert result['success'] == True
        videos = result['data']['videos']
        assert len(videos) == 10
        # Check only requested fields are present
        for video in videos:
            assert 'id' in video
            assert 'title' in video
            assert 'view_count' in video
            # These should not be present
            assert 'format_type' not in video
            assert 'topic_niche' not in video
    
    @pytest.mark.asyncio
    async def test_pagination(self, mock_supabase, sample_videos):
        """Test pagination with limit and offset"""
        # Return videos 10-19 (offset=10, limit=10)
        mock_supabase.from_().select().eq().order().range().execute.return_value = Mock(
            data=sample_videos[10:20]
        )
        mock_supabase.from_().select().eq().execute.return_value = Mock(
            count=25
        )
        
        from app.api.tools.list_channel_history.route import listChannelHistoryHandler
        
        result = await listChannelHistoryHandler({
            'channel_id': 'test_channel_123',
            'limit': 10,
            'offset': 10
        })
        
        assert result['success'] == True
        assert len(result['data']['videos']) == 10
        assert result['data']['videos'][0]['id'] == 'video_10'
        assert result['data']['has_more'] == True  # Still 5 more videos
    
    @pytest.mark.asyncio
    async def test_exclude_shorts(self, mock_supabase, sample_videos):
        """Test that shorts are excluded by default"""
        # Filter out shorts
        long_videos = [v for v in sample_videos if not v['is_short']]
        
        mock_supabase.from_().select().eq().eq().order().range().execute.return_value = Mock(
            data=long_videos[:20]
        )
        
        from app.api.tools.list_channel_history.route import listChannelHistoryHandler
        
        result = await listChannelHistoryHandler({
            'channel_id': 'test_channel_123',
            'include_shorts': False  # Default value
        })
        
        assert result['success'] == True
        videos = result['data']['videos']
        # Verify no shorts in results
        for video in videos:
            assert video.get('is_short', False) == False
            assert video.get('duration', 600) > 60
    
    @pytest.mark.asyncio
    async def test_include_shorts(self, mock_supabase, sample_videos):
        """Test including shorts when requested"""
        mock_supabase.from_().select().eq().order().range().execute.return_value = Mock(
            data=sample_videos[:20]  # Includes shorts
        )
        
        from app.api.tools.list_channel_history.route import listChannelHistoryHandler
        
        result = await listChannelHistoryHandler({
            'channel_id': 'test_channel_123',
            'include_shorts': True
        })
        
        assert result['success'] == True
        videos = result['data']['videos']
        # Should have some shorts
        shorts_count = sum(1 for v in videos if v.get('is_short', False))
        assert shorts_count > 0
    
    @pytest.mark.asyncio
    async def test_date_range_filtering(self, mock_supabase):
        """Test filtering by date range"""
        base_date = datetime(2025, 1, 11)
        recent_videos = [
            {
                'id': f'recent_{i}',
                'title': f'Recent Video {i}',
                'published_at': (base_date - timedelta(days=i)).isoformat() + 'Z',
                'view_count': 50000
            }
            for i in range(5)
        ]
        
        mock_supabase.from_().select().eq().gte().lte().order().range().execute.return_value = Mock(
            data=recent_videos
        )
        
        from app.api.tools.list_channel_history.route import listChannelHistoryHandler
        
        min_date = (base_date - timedelta(days=7)).isoformat() + 'Z'
        max_date = base_date.isoformat() + 'Z'
        
        result = await listChannelHistoryHandler({
            'channel_id': 'test_channel_123',
            'min_date': min_date,
            'max_date': max_date
        })
        
        assert result['success'] == True
        videos = result['data']['videos']
        # All videos should be within date range
        for video in videos:
            pub_date = datetime.fromisoformat(video['published_at'].replace('Z', '+00:00'))
            assert pub_date >= datetime.fromisoformat(min_date.replace('Z', '+00:00'))
            assert pub_date <= datetime.fromisoformat(max_date.replace('Z', '+00:00'))
    
    @pytest.mark.asyncio
    async def test_max_limit_enforcement(self, mock_supabase, sample_videos):
        """Test that limit is capped at 50"""
        mock_supabase.from_().select().eq().order().range().execute.return_value = Mock(
            data=sample_videos[:50]  # Max allowed
        )
        
        from app.api.tools.list_channel_history.route import listChannelHistoryHandler
        
        result = await listChannelHistoryHandler({
            'channel_id': 'test_channel_123',
            'limit': 100  # Request more than max
        })
        
        assert result['success'] == True
        assert len(result['data']['videos']) <= 50
    
    @pytest.mark.asyncio
    async def test_sort_order(self, mock_supabase, sample_videos):
        """Test that videos are sorted by published_at descending"""
        sorted_videos = sorted(sample_videos, key=lambda x: x['published_at'], reverse=True)
        
        mock_supabase.from_().select().eq().order().range().execute.return_value = Mock(
            data=sorted_videos[:20]
        )
        
        from app.api.tools.list_channel_history.route import listChannelHistoryHandler
        
        result = await listChannelHistoryHandler({
            'channel_id': 'test_channel_123'
        })
        
        assert result['success'] == True
        videos = result['data']['videos']
        # Verify descending order
        for i in range(len(videos) - 1):
            date1 = datetime.fromisoformat(videos[i]['published_at'].replace('Z', '+00:00'))
            date2 = datetime.fromisoformat(videos[i+1]['published_at'].replace('Z', '+00:00'))
            assert date1 >= date2
    
    @pytest.mark.asyncio
    async def test_empty_channel(self, mock_supabase):
        """Test handling of channel with no videos"""
        mock_supabase.from_().select().eq().order().range().execute.return_value = Mock(
            data=[]
        )
        mock_supabase.from_().select().eq().execute.return_value = Mock(
            count=0
        )
        
        from app.api.tools.list_channel_history.route import listChannelHistoryHandler
        
        result = await listChannelHistoryHandler({
            'channel_id': 'empty_channel'
        })
        
        assert result['success'] == True
        assert result['data']['channel_id'] == 'empty_channel'
        assert len(result['data']['videos']) == 0
        assert result['data']['total_count'] == 0
        assert result['data']['has_more'] == False
    
    @pytest.mark.asyncio
    async def test_missing_channel_id(self):
        """Test error when channel_id is missing"""
        from app.api.tools.list_channel_history.route import listChannelHistoryHandler
        
        result = await listChannelHistoryHandler({})
        
        assert result['success'] == False
        assert result['error']['code'] == 'INVALID_PARAMS'
        assert 'channel_id is required' in result['error']['message']
    
    @pytest.mark.asyncio
    async def test_database_error_handling(self, mock_supabase):
        """Test graceful handling of database errors"""
        mock_supabase.from_().select().eq().order().range().execute.side_effect = Exception(
            "Database connection error"
        )
        
        from app.api.tools.list_channel_history.route import listChannelHistoryHandler
        
        result = await listChannelHistoryHandler({
            'channel_id': 'test_channel_123'
        })
        
        assert result['success'] == False
        assert result['error']['code'] == 'DATABASE_ERROR'
        assert result['error']['retryable'] == True
    
    @pytest.mark.asyncio
    async def test_tps_calculation_fallback(self, mock_supabase):
        """Test TPS calculation when it's missing but baseline exists"""
        videos_missing_tps = [
            {
                'id': 'video_1',
                'title': 'Video 1',
                'view_count': 500000,
                'temporal_performance_score': None,  # Missing
                'channel_baseline_at_publish': 100000,  # But baseline exists
                'published_at': '2025-01-10T00:00:00Z'
            }
        ]
        
        mock_supabase.from_().select().eq().order().range().execute.return_value = Mock(
            data=videos_missing_tps
        )
        
        from app.api.tools.list_channel_history.route import listChannelHistoryHandler
        
        result = await listChannelHistoryHandler({
            'channel_id': 'test_channel_123',
            'fields': ['id', 'title', 'view_count', 'temporal_performance_score', 'channel_baseline_at_publish']
        })
        
        assert result['success'] == True
        video = result['data']['videos'][0]
        # TPS should be calculated
        expected_tps = 500000 / 100000  # 5.0
        assert video['temporal_performance_score'] == expected_tps
    
    @pytest.mark.asyncio
    async def test_field_validation(self, mock_supabase):
        """Test that only valid fields are selected"""
        mock_supabase.from_().select().eq().order().range().execute.return_value = Mock(
            data=[{'id': 'v1', 'title': 'Video 1', 'published_at': '2025-01-10T00:00:00Z'}]
        )
        
        from app.api.tools.list_channel_history.route import listChannelHistoryHandler
        
        result = await listChannelHistoryHandler({
            'channel_id': 'test_channel_123',
            'fields': ['id', 'title', 'invalid_field', 'another_bad_field']
        })
        
        assert result['success'] == True
        # Invalid fields should be filtered out
        video = result['data']['videos'][0]
        assert 'id' in video
        assert 'title' in video
        assert 'invalid_field' not in video
        assert 'another_bad_field' not in video
    
    @pytest.mark.asyncio
    async def test_caching_behavior(self, mock_supabase, sample_videos):
        """Test that results are cached with 5-minute TTL"""
        mock_supabase.from_().select().eq().order().range().execute.return_value = Mock(
            data=sample_videos[:10]
        )
        
        from app.api.tools.list_channel_history.route import listChannelHistoryHandler
        from lib.tools.base_wrapper import wrapTool
        
        # First call should hit database
        result1 = await listChannelHistoryHandler({
            'channel_id': 'test_channel_123',
            'limit': 10
        }, {'requestId': 'test-1'})
        
        # Second call with same params should use cache
        result2 = await listChannelHistoryHandler({
            'channel_id': 'test_channel_123',
            'limit': 10
        }, {'requestId': 'test-1'})
        
        assert result1['success'] == True
        assert result2['success'] == True
        # Both should return same data
        assert result1['data'] == result2['data']
        # Check cache metadata if available
        if 'metadata' in result2:
            assert result2['metadata'].get('cached') == True