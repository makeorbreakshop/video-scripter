"""
Tests for search_titles tool
"""

import pytest
from unittest.mock import Mock, patch, AsyncMock
import json
import numpy as np

class TestSearchTitles:
    """Test suite for search_titles tool"""
    
    @pytest.fixture
    def mock_embedding(self):
        """Mock OpenAI embedding"""
        return np.random.rand(512).tolist()  # 512D embedding
    
    @pytest.fixture
    def sample_search_results(self):
        """Sample Pinecone search results"""
        return [
            {
                'id': 'video_1',
                'score': 0.95,
                'metadata': {
                    'title': 'How to Build a React App',
                    'channel_id': 'channel_123',
                    'topic_niche': 'web-development',
                    'temporal_performance_score': 2.5,
                    'published_at': '2025-01-10T00:00:00Z',
                    'is_short': False
                }
            },
            {
                'id': 'video_2',
                'score': 0.85,
                'metadata': {
                    'title': 'React Tutorial for Beginners',
                    'channel_id': 'channel_456',
                    'topic_niche': 'web-development',
                    'temporal_performance_score': 1.8,
                    'published_at': '2025-01-08T00:00:00Z',
                    'is_short': False
                }
            },
            {
                'id': 'video_3',
                'score': 0.75,
                'metadata': {
                    'title': 'Building Modern Web Apps',
                    'channel_id': 'channel_789',
                    'topic_niche': 'web-development',
                    'temporal_performance_score': 3.2,
                    'published_at': '2025-01-05T00:00:00Z',
                    'is_short': False
                }
            },
            {
                'id': 'video_4',
                'score': 0.45,  # Below threshold
                'metadata': {
                    'title': 'Introduction to Programming',
                    'channel_id': 'channel_101',
                    'topic_niche': 'programming',
                    'temporal_performance_score': 1.0,
                    'published_at': '2025-01-01T00:00:00Z',
                    'is_short': False
                }
            }
        ]
    
    @pytest.mark.asyncio
    async def test_basic_title_search(self, mock_openai, mock_pinecone, mock_embedding, sample_search_results):
        """Test basic semantic search on titles"""
        # Mock OpenAI embedding
        mock_openai.embeddings.create.return_value = Mock(
            data=[Mock(embedding=mock_embedding)]
        )
        
        # Mock Pinecone search
        mock_index = Mock()
        mock_index.query.return_value = Mock(matches=sample_search_results)
        mock_pinecone.index.return_value = mock_index
        
        from app.api.tools.search_titles.route import searchTitlesHandler
        
        result = await searchTitlesHandler({
            'query': 'React tutorial'
        })
        
        assert result['success'] == True
        assert result['data']['query'] == 'React tutorial'
        # Should filter out score < 0.5
        assert len(result['data']['results']) == 3
        assert result['data']['total_results'] == 3
        # Verify scores are above threshold
        for r in result['data']['results']:
            assert r['similarity_score'] >= 0.5
    
    @pytest.mark.asyncio
    async def test_empty_query_error(self):
        """Test that empty query returns error"""
        from app.api.tools.search_titles.route import searchTitlesHandler
        
        result = await searchTitlesHandler({
            'query': ''
        })
        
        assert result['success'] == False
        assert result['error']['code'] == 'INVALID_PARAMS'
        assert 'query is required' in result['error']['message']
    
    @pytest.mark.asyncio
    async def test_filter_by_niches(self, mock_openai, mock_pinecone, mock_embedding, sample_search_results):
        """Test filtering by topic niches"""
        mock_openai.embeddings.create.return_value = Mock(
            data=[Mock(embedding=mock_embedding)]
        )
        
        mock_index = Mock()
        # Pinecone will handle the filtering
        mock_index.query.return_value = Mock(matches=sample_search_results[:2])
        mock_pinecone.index.return_value = mock_index
        
        from app.api.tools.search_titles.route import searchTitlesHandler
        
        result = await searchTitlesHandler({
            'query': 'React tutorial',
            'filters': {
                'niches': ['web-development']
            }
        })
        
        assert result['success'] == True
        # All results should be from web-development niche
        for r in result['data']['results']:
            assert r['metadata']['topic_niche'] == 'web-development'
    
    @pytest.mark.asyncio
    async def test_filter_by_channels(self, mock_openai, mock_pinecone, mock_embedding):
        """Test filtering by channel IDs"""
        mock_openai.embeddings.create.return_value = Mock(
            data=[Mock(embedding=mock_embedding)]
        )
        
        filtered_results = [
            {
                'id': 'video_1',
                'score': 0.9,
                'metadata': {
                    'title': 'Video from Channel 123',
                    'channel_id': 'channel_123'
                }
            }
        ]
        
        mock_index = Mock()
        mock_index.query.return_value = Mock(matches=filtered_results)
        mock_pinecone.index.return_value = mock_index
        
        from app.api.tools.search_titles.route import searchTitlesHandler
        
        result = await searchTitlesHandler({
            'query': 'tutorial',
            'filters': {
                'channels': ['channel_123', 'channel_456']
            }
        })
        
        assert result['success'] == True
        # Verify filter was applied
        for r in result['data']['results']:
            assert r['metadata']['channel_id'] in ['channel_123', 'channel_456']
    
    @pytest.mark.asyncio
    async def test_filter_by_date_range(self, mock_openai, mock_pinecone, mock_embedding):
        """Test filtering by date range"""
        mock_openai.embeddings.create.return_value = Mock(
            data=[Mock(embedding=mock_embedding)]
        )
        
        recent_results = [
            {
                'id': 'video_recent',
                'score': 0.8,
                'metadata': {
                    'title': 'Recent Video',
                    'published_at': '2025-01-10T00:00:00Z'
                }
            }
        ]
        
        mock_index = Mock()
        mock_index.query.return_value = Mock(matches=recent_results)
        mock_pinecone.index.return_value = mock_index
        
        from app.api.tools.search_titles.route import searchTitlesHandler
        from datetime import datetime
        
        result = await searchTitlesHandler({
            'query': 'tutorial',
            'filters': {
                'dateRange': {
                    'start': datetime(2025, 1, 5),
                    'end': datetime(2025, 1, 15)
                }
            }
        })
        
        assert result['success'] == True
        # All results should be within date range
        for r in result['data']['results']:
            pub_date = r['metadata']['published_at']
            assert '2025-01-05' <= pub_date <= '2025-01-15'
    
    @pytest.mark.asyncio
    async def test_filter_by_tps_range(self, mock_openai, mock_pinecone, mock_embedding):
        """Test filtering by temporal performance score range"""
        mock_openai.embeddings.create.return_value = Mock(
            data=[Mock(embedding=mock_embedding)]
        )
        
        high_perf_results = [
            {
                'id': 'video_high',
                'score': 0.85,
                'metadata': {
                    'title': 'High Performance Video',
                    'temporal_performance_score': 5.2
                }
            },
            {
                'id': 'video_medium',
                'score': 0.75,
                'metadata': {
                    'title': 'Medium Performance Video',
                    'temporal_performance_score': 2.5
                }
            }
        ]
        
        mock_index = Mock()
        mock_index.query.return_value = Mock(matches=high_perf_results)
        mock_pinecone.index.return_value = mock_index
        
        from app.api.tools.search_titles.route import searchTitlesHandler
        
        result = await searchTitlesHandler({
            'query': 'tutorial',
            'filters': {
                'minTPS': 2.0,
                'maxTPS': 6.0
            }
        })
        
        assert result['success'] == True
        # All results should be within TPS range
        for r in result['data']['results']:
            tps = r['metadata']['temporal_performance_score']
            assert 2.0 <= tps <= 6.0
    
    @pytest.mark.asyncio
    async def test_exclude_shorts(self, mock_openai, mock_pinecone, mock_embedding):
        """Test that shorts are excluded by default"""
        mock_openai.embeddings.create.return_value = Mock(
            data=[Mock(embedding=mock_embedding)]
        )
        
        mixed_results = [
            {
                'id': 'video_long',
                'score': 0.9,
                'metadata': {
                    'title': 'Long Video',
                    'is_short': False
                }
            },
            {
                'id': 'video_short',
                'score': 0.85,
                'metadata': {
                    'title': 'Short Video',
                    'is_short': True
                }
            }
        ]
        
        mock_index = Mock()
        # Pinecone should filter out shorts
        mock_index.query.return_value = Mock(matches=[mixed_results[0]])
        mock_pinecone.index.return_value = mock_index
        
        from app.api.tools.search_titles.route import searchTitlesHandler
        
        result = await searchTitlesHandler({
            'query': 'tutorial',
            'filters': {
                'excludeShorts': True  # Default
            }
        })
        
        assert result['success'] == True
        # No shorts in results
        for r in result['data']['results']:
            assert r['metadata'].get('is_short', False) == False
    
    @pytest.mark.asyncio
    async def test_custom_similarity_threshold(self, mock_openai, mock_pinecone, mock_embedding, sample_search_results):
        """Test custom minimum similarity score"""
        mock_openai.embeddings.create.return_value = Mock(
            data=[Mock(embedding=mock_embedding)]
        )
        
        mock_index = Mock()
        mock_index.query.return_value = Mock(matches=sample_search_results)
        mock_pinecone.index.return_value = mock_index
        
        from app.api.tools.search_titles.route import searchTitlesHandler
        
        result = await searchTitlesHandler({
            'query': 'React tutorial',
            'min_score': 0.8  # Higher threshold
        })
        
        assert result['success'] == True
        # Only high-scoring results
        assert len(result['data']['results']) == 2  # Only scores >= 0.8
        for r in result['data']['results']:
            assert r['similarity_score'] >= 0.8
    
    @pytest.mark.asyncio
    async def test_top_k_limit(self, mock_openai, mock_pinecone, mock_embedding):
        """Test limiting number of results"""
        mock_openai.embeddings.create.return_value = Mock(
            data=[Mock(embedding=mock_embedding)]
        )
        
        many_results = [
            {'id': f'video_{i}', 'score': 0.9 - i*0.05, 'metadata': {'title': f'Video {i}'}}
            for i in range(20)
        ]
        
        mock_index = Mock()
        mock_index.query.return_value = Mock(matches=many_results)
        mock_pinecone.index.return_value = mock_index
        
        from app.api.tools.search_titles.route import searchTitlesHandler
        
        result = await searchTitlesHandler({
            'query': 'tutorial',
            'top_k': 5
        })
        
        assert result['success'] == True
        assert len(result['data']['results']) <= 5
    
    @pytest.mark.asyncio
    async def test_metadata_enrichment(self, mock_openai, mock_pinecone, mock_supabase, mock_embedding):
        """Test enriching results with additional metadata from Supabase"""
        mock_openai.embeddings.create.return_value = Mock(
            data=[Mock(embedding=mock_embedding)]
        )
        
        basic_results = [
            {'id': 'video_1', 'score': 0.9, 'metadata': {'title': 'Basic Title'}}
        ]
        
        mock_index = Mock()
        mock_index.query.return_value = Mock(matches=basic_results)
        mock_pinecone.index.return_value = mock_index
        
        # Mock Supabase enrichment
        mock_supabase.from_().select().in_().execute.return_value = Mock(
            data=[
                {
                    'id': 'video_1',
                    'title': 'Enriched Title',
                    'channel_name': 'Test Channel',
                    'view_count': 100000,
                    'published_at': '2025-01-10T00:00:00Z'
                }
            ]
        )
        
        from app.api.tools.search_titles.route import searchTitlesHandler
        
        result = await searchTitlesHandler(
            {'query': 'tutorial'},
            {'enrichMetadata': True}
        )
        
        assert result['success'] == True
        enriched = result['data']['results'][0]['metadata']
        assert enriched['channel_name'] == 'Test Channel'
        assert enriched['view_count'] == 100000
    
    @pytest.mark.asyncio
    async def test_embedding_error_handling(self, mock_openai):
        """Test handling of OpenAI embedding errors"""
        mock_openai.embeddings.create.side_effect = Exception("OpenAI API error")
        
        from app.api.tools.search_titles.route import searchTitlesHandler
        
        result = await searchTitlesHandler({
            'query': 'tutorial'
        })
        
        assert result['success'] == False
        assert result['error']['code'] in ['EMBEDDING_ERROR', 'SEARCH_ERROR']
        assert result['error']['retryable'] == True
    
    @pytest.mark.asyncio
    async def test_pinecone_error_handling(self, mock_openai, mock_pinecone, mock_embedding):
        """Test handling of Pinecone errors"""
        mock_openai.embeddings.create.return_value = Mock(
            data=[Mock(embedding=mock_embedding)]
        )
        
        mock_index = Mock()
        mock_index.query.side_effect = Exception("Pinecone connection error")
        mock_pinecone.index.return_value = mock_index
        
        from app.api.tools.search_titles.route import searchTitlesHandler
        
        result = await searchTitlesHandler({
            'query': 'tutorial'
        })
        
        assert result['success'] == False
        assert result['error']['code'] in ['PINECONE_ERROR', 'SEARCH_ERROR']
        assert result['error']['retryable'] == True
    
    @pytest.mark.asyncio
    async def test_rate_limit_error(self, mock_openai):
        """Test handling of rate limit errors"""
        mock_openai.embeddings.create.side_effect = Exception("Rate limit exceeded")
        
        from app.api.tools.search_titles.route import searchTitlesHandler
        
        result = await searchTitlesHandler({
            'query': 'tutorial'
        })
        
        assert result['success'] == False
        assert result['error']['code'] == 'RATE_LIMIT'
        assert result['error']['retryable'] == True
    
    @pytest.mark.asyncio
    async def test_caching_same_query(self, mock_openai, mock_pinecone, mock_embedding, sample_search_results):
        """Test that identical queries use cache"""
        mock_openai.embeddings.create.return_value = Mock(
            data=[Mock(embedding=mock_embedding)]
        )
        
        mock_index = Mock()
        mock_index.query.return_value = Mock(matches=sample_search_results[:2])
        mock_pinecone.index.return_value = mock_index
        
        from app.api.tools.search_titles.route import searchTitlesHandler
        
        context = {'requestId': 'test-123'}
        
        # First call
        result1 = await searchTitlesHandler({'query': 'React tutorial'}, context)
        
        # Second call with same query
        result2 = await searchTitlesHandler({'query': 'React tutorial'}, context)
        
        assert result1['success'] == True
        assert result2['success'] == True
        # Results should be identical
        assert result1['data'] == result2['data']
        # Second call should be cached
        if 'metadata' in result2:
            assert result2['metadata'].get('cached') == True
    
    @pytest.mark.asyncio
    async def test_no_results_found(self, mock_openai, mock_pinecone, mock_embedding):
        """Test handling when no results match criteria"""
        mock_openai.embeddings.create.return_value = Mock(
            data=[Mock(embedding=mock_embedding)]
        )
        
        mock_index = Mock()
        mock_index.query.return_value = Mock(matches=[])
        mock_pinecone.index.return_value = mock_index
        
        from app.api.tools.search_titles.route import searchTitlesHandler
        
        result = await searchTitlesHandler({
            'query': 'very specific query with no matches'
        })
        
        assert result['success'] == True
        assert len(result['data']['results']) == 0
        assert result['data']['total_results'] == 0