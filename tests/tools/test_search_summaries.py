"""
Tests for search_summaries tool
"""

import pytest
from unittest.mock import Mock, patch, AsyncMock
import json
import numpy as np

class TestSearchSummaries:
    """Test suite for search_summaries tool"""
    
    @pytest.fixture
    def mock_embedding(self):
        """Mock OpenAI embedding for summaries"""
        return np.random.rand(512).tolist()  # 512D embedding
    
    @pytest.fixture
    def sample_summary_results(self):
        """Sample Pinecone search results from llm-summaries namespace"""
        return [
            {
                'id': 'video_1',
                'score': 0.85,  # High conceptual match
                'metadata': {
                    'title': 'Advanced React Patterns',
                    'summary': 'Deep dive into React hooks, context, and performance optimization',
                    'channel_id': 'channel_123',
                    'topic_niche': 'web-development',
                    'temporal_performance_score': 4.2,
                    'published_at': '2025-01-10T00:00:00Z',
                    'is_short': False
                }
            },
            {
                'id': 'video_2',
                'score': 0.65,  # Medium conceptual match
                'metadata': {
                    'title': 'State Management in Modern Apps',
                    'summary': 'Exploring Redux, MobX, and Zustand for state management',
                    'channel_id': 'channel_456',
                    'topic_niche': 'web-development',
                    'temporal_performance_score': 2.8,
                    'published_at': '2025-01-08T00:00:00Z',
                    'is_short': False
                }
            },
            {
                'id': 'video_3',
                'score': 0.45,  # Above threshold for summaries (0.4)
                'metadata': {
                    'title': 'JavaScript Fundamentals',
                    'summary': 'Basic concepts of JavaScript programming',
                    'channel_id': 'channel_789',
                    'topic_niche': 'programming',
                    'temporal_performance_score': 1.5,
                    'published_at': '2025-01-05T00:00:00Z',
                    'is_short': False
                }
            },
            {
                'id': 'video_4',
                'score': 0.35,  # Below threshold
                'metadata': {
                    'title': 'Cooking Tutorial',
                    'summary': 'How to make pasta from scratch',
                    'channel_id': 'channel_cooking',
                    'topic_niche': 'cooking',
                    'temporal_performance_score': 1.0
                }
            }
        ]
    
    @pytest.mark.asyncio
    async def test_basic_summary_search(self, mock_openai, mock_pinecone, mock_embedding, sample_summary_results):
        """Test basic conceptual search on summaries"""
        # Mock OpenAI embedding
        mock_openai.embeddings.create.return_value = Mock(
            data=[Mock(embedding=mock_embedding)]
        )
        
        # Mock Pinecone namespace and search
        mock_namespace = Mock()
        mock_namespace.query.return_value = Mock(matches=sample_summary_results)
        mock_index = Mock()
        mock_index.namespace.return_value = mock_namespace
        mock_pinecone.index.return_value = mock_index
        
        from app.api.tools.search_summaries.route import searchSummariesHandler
        
        result = await searchSummariesHandler({
            'query': 'advanced state management patterns in React'
        })
        
        assert result['success'] == True
        assert result['data']['query'] == 'advanced state management patterns in React'
        # Should filter out scores < 0.4
        assert len(result['data']['results']) == 3
        assert result['data']['total_results'] == 3
        # Verify all scores above threshold (0.4 for summaries)
        for r in result['data']['results']:
            assert r['similarity_score'] >= 0.4
    
    @pytest.mark.asyncio
    async def test_lower_similarity_threshold(self, mock_openai, mock_pinecone, mock_embedding):
        """Test that summaries use lower threshold (0.4) than titles (0.5)"""
        mock_openai.embeddings.create.return_value = Mock(
            data=[Mock(embedding=mock_embedding)]
        )
        
        low_score_results = [
            {
                'id': 'video_1',
                'score': 0.42,  # Above 0.4 but below 0.5
                'metadata': {'title': 'Conceptually Related'}
            }
        ]
        
        mock_namespace = Mock()
        mock_namespace.query.return_value = Mock(matches=low_score_results)
        mock_index = Mock()
        mock_index.namespace.return_value = mock_namespace
        mock_pinecone.index.return_value = mock_index
        
        from app.api.tools.search_summaries.route import searchSummariesHandler
        
        result = await searchSummariesHandler({
            'query': 'abstract concepts',
            'min_score': 0.4  # Default for summaries
        })
        
        assert result['success'] == True
        assert len(result['data']['results']) == 1
        assert result['data']['results'][0]['similarity_score'] == 0.42
    
    @pytest.mark.asyncio
    async def test_llm_summaries_namespace(self, mock_openai, mock_pinecone, mock_embedding):
        """Test that search uses the llm-summaries namespace"""
        mock_openai.embeddings.create.return_value = Mock(
            data=[Mock(embedding=mock_embedding)]
        )
        
        mock_namespace = Mock()
        mock_namespace.query.return_value = Mock(matches=[])
        mock_index = Mock()
        mock_index.namespace.return_value = mock_namespace
        mock_pinecone.index.return_value = mock_index
        
        from app.api.tools.search_summaries.route import searchSummariesHandler
        
        await searchSummariesHandler({
            'query': 'test query'
        })
        
        # Verify namespace was called with 'llm-summaries'
        mock_index.namespace.assert_called_with('llm-summaries')
    
    @pytest.mark.asyncio
    async def test_enrich_with_actual_summaries(self, mock_openai, mock_pinecone, mock_supabase, mock_embedding):
        """Test enriching results with actual summaries from analyses table"""
        mock_openai.embeddings.create.return_value = Mock(
            data=[Mock(embedding=mock_embedding)]
        )
        
        basic_results = [
            {
                'id': 'video_1',
                'score': 0.7,
                'metadata': {
                    'title': 'Video Title',
                    'summary': 'Basic metadata summary'
                }
            }
        ]
        
        mock_namespace = Mock()
        mock_namespace.query.return_value = Mock(matches=basic_results)
        mock_index = Mock()
        mock_index.namespace.return_value = mock_namespace
        mock_pinecone.index.return_value = mock_index
        
        # Mock video details
        mock_supabase.from_('videos').select().in_().execute.return_value = Mock(
            data=[
                {
                    'id': 'video_1',
                    'title': 'Enriched Title',
                    'channel_name': 'Test Channel',
                    'view_count': 250000
                }
            ]
        )
        
        # Mock actual summary from analyses
        mock_supabase.from_('analyses').select().in_().execute.return_value = Mock(
            data=[
                {
                    'video_id': 'video_1',
                    'summary': 'This is the detailed AI-generated summary from the analyses table'
                }
            ]
        )
        
        from app.api.tools.search_summaries.route import searchSummariesHandler
        
        result = await searchSummariesHandler(
            {'query': 'test'},
            {'enrichMetadata': True}
        )
        
        assert result['success'] == True
        enriched = result['data']['results'][0]['metadata']
        # Should have enriched data
        assert enriched['channel_name'] == 'Test Channel'
        assert enriched['view_count'] == 250000
        # Should have actual summary from analyses table
        assert 'detailed AI-generated summary' in enriched['summary']
    
    @pytest.mark.asyncio
    async def test_filter_by_niches(self, mock_openai, mock_pinecone, mock_embedding):
        """Test filtering summaries by topic niches"""
        mock_openai.embeddings.create.return_value = Mock(
            data=[Mock(embedding=mock_embedding)]
        )
        
        web_dev_results = [
            {
                'id': 'video_1',
                'score': 0.6,
                'metadata': {
                    'topic_niche': 'web-development',
                    'summary': 'React and Vue comparison'
                }
            }
        ]
        
        mock_namespace = Mock()
        mock_namespace.query.return_value = Mock(matches=web_dev_results)
        mock_index = Mock()
        mock_index.namespace.return_value = mock_namespace
        mock_pinecone.index.return_value = mock_index
        
        from app.api.tools.search_summaries.route import searchSummariesHandler
        
        result = await searchSummariesHandler({
            'query': 'frontend frameworks',
            'filters': {
                'niches': ['web-development', 'frontend']
            }
        })
        
        assert result['success'] == True
        for r in result['data']['results']:
            assert r['metadata']['topic_niche'] in ['web-development', 'frontend']
    
    @pytest.mark.asyncio
    async def test_filter_by_tps_range(self, mock_openai, mock_pinecone, mock_embedding):
        """Test filtering by temporal performance score"""
        mock_openai.embeddings.create.return_value = Mock(
            data=[Mock(embedding=mock_embedding)]
        )
        
        high_perf_results = [
            {
                'id': 'video_viral',
                'score': 0.55,
                'metadata': {
                    'temporal_performance_score': 8.5,
                    'summary': 'Viral content strategy'
                }
            }
        ]
        
        mock_namespace = Mock()
        mock_namespace.query.return_value = Mock(matches=high_perf_results)
        mock_index = Mock()
        mock_index.namespace.return_value = mock_namespace
        mock_pinecone.index.return_value = mock_index
        
        from app.api.tools.search_summaries.route import searchSummariesHandler
        
        result = await searchSummariesHandler({
            'query': 'viral content',
            'filters': {
                'minTPS': 5.0,
                'maxTPS': 10.0
            }
        })
        
        assert result['success'] == True
        for r in result['data']['results']:
            tps = r['metadata']['temporal_performance_score']
            assert 5.0 <= tps <= 10.0
    
    @pytest.mark.asyncio
    async def test_abstract_conceptual_queries(self, mock_openai, mock_pinecone, mock_embedding):
        """Test that summaries handle abstract/conceptual queries well"""
        mock_openai.embeddings.create.return_value = Mock(
            data=[Mock(embedding=mock_embedding)]
        )
        
        conceptual_results = [
            {
                'id': 'video_1',
                'score': 0.6,
                'metadata': {
                    'summary': 'Discussion of software architecture principles and design patterns'
                }
            },
            {
                'id': 'video_2',
                'score': 0.55,
                'metadata': {
                    'summary': 'Clean code practices and maintainability'
                }
            }
        ]
        
        mock_namespace = Mock()
        mock_namespace.query.return_value = Mock(matches=conceptual_results)
        mock_index = Mock()
        mock_index.namespace.return_value = mock_namespace
        mock_pinecone.index.return_value = mock_index
        
        from app.api.tools.search_summaries.route import searchSummariesHandler
        
        result = await searchSummariesHandler({
            'query': 'best practices for scalable software development'  # Abstract query
        })
        
        assert result['success'] == True
        assert len(result['data']['results']) == 2
        # Summaries should capture conceptual matches
        for r in result['data']['results']:
            assert 'software' in r['metadata']['summary'].lower() or \
                   'code' in r['metadata']['summary'].lower()
    
    @pytest.mark.asyncio
    async def test_date_range_filtering(self, mock_openai, mock_pinecone, mock_embedding):
        """Test filtering summaries by date range"""
        mock_openai.embeddings.create.return_value = Mock(
            data=[Mock(embedding=mock_embedding)]
        )
        
        recent_results = [
            {
                'id': 'recent_video',
                'score': 0.5,
                'metadata': {
                    'published_at': '2025-01-10T00:00:00Z',
                    'summary': 'Recent trends in AI'
                }
            }
        ]
        
        mock_namespace = Mock()
        mock_namespace.query.return_value = Mock(matches=recent_results)
        mock_index = Mock()
        mock_index.namespace.return_value = mock_namespace
        mock_pinecone.index.return_value = mock_index
        
        from app.api.tools.search_summaries.route import searchSummariesHandler
        from datetime import datetime
        
        result = await searchSummariesHandler({
            'query': 'AI trends',
            'filters': {
                'dateRange': {
                    'start': datetime(2025, 1, 1),
                    'end': datetime(2025, 1, 31)
                }
            }
        })
        
        assert result['success'] == True
        for r in result['data']['results']:
            pub_date = r['metadata']['published_at']
            assert '2025-01' in pub_date
    
    @pytest.mark.asyncio
    async def test_top_k_limit(self, mock_openai, mock_pinecone, mock_embedding):
        """Test limiting number of summary results"""
        mock_openai.embeddings.create.return_value = Mock(
            data=[Mock(embedding=mock_embedding)]
        )
        
        many_results = [
            {'id': f'video_{i}', 'score': 0.8 - i*0.05, 'metadata': {'summary': f'Summary {i}'}}
            for i in range(20)
        ]
        
        mock_namespace = Mock()
        mock_namespace.query.return_value = Mock(matches=many_results)
        mock_index = Mock()
        mock_index.namespace.return_value = mock_namespace
        mock_pinecone.index.return_value = mock_index
        
        from app.api.tools.search_summaries.route import searchSummariesHandler
        
        result = await searchSummariesHandler({
            'query': 'test',
            'top_k': 3
        })
        
        assert result['success'] == True
        assert len(result['data']['results']) <= 3
    
    @pytest.mark.asyncio
    async def test_empty_query_error(self):
        """Test that empty query returns error"""
        from app.api.tools.search_summaries.route import searchSummariesHandler
        
        result = await searchSummariesHandler({
            'query': '   '  # Whitespace only
        })
        
        assert result['success'] == False
        assert result['error']['code'] == 'INVALID_PARAMS'
        assert 'query is required' in result['error']['message']
    
    @pytest.mark.asyncio
    async def test_exclude_shorts(self, mock_openai, mock_pinecone, mock_embedding):
        """Test excluding shorts from summary search"""
        mock_openai.embeddings.create.return_value = Mock(
            data=[Mock(embedding=mock_embedding)]
        )
        
        long_form_results = [
            {
                'id': 'long_video',
                'score': 0.6,
                'metadata': {
                    'is_short': False,
                    'summary': 'In-depth analysis'
                }
            }
        ]
        
        mock_namespace = Mock()
        mock_namespace.query.return_value = Mock(matches=long_form_results)
        mock_index = Mock()
        mock_index.namespace.return_value = mock_namespace
        mock_pinecone.index.return_value = mock_index
        
        from app.api.tools.search_summaries.route import searchSummariesHandler
        
        result = await searchSummariesHandler({
            'query': 'analysis',
            'filters': {
                'excludeShorts': True
            }
        })
        
        assert result['success'] == True
        for r in result['data']['results']:
            assert r['metadata'].get('is_short', False) == False
    
    @pytest.mark.asyncio
    async def test_caching_behavior(self, mock_openai, mock_pinecone, mock_embedding):
        """Test that summary searches are cached"""
        mock_openai.embeddings.create.return_value = Mock(
            data=[Mock(embedding=mock_embedding)]
        )
        
        results = [{'id': 'v1', 'score': 0.7, 'metadata': {'summary': 'Test'}}]
        
        mock_namespace = Mock()
        mock_namespace.query.return_value = Mock(matches=results)
        mock_index = Mock()
        mock_index.namespace.return_value = mock_namespace
        mock_pinecone.index.return_value = mock_index
        
        from app.api.tools.search_summaries.route import searchSummariesHandler
        
        context = {'requestId': 'test-cache'}
        
        # First call
        result1 = await searchSummariesHandler({'query': 'test concepts'}, context)
        # Second call should use cache
        result2 = await searchSummariesHandler({'query': 'test concepts'}, context)
        
        assert result1['success'] == True
        assert result2['success'] == True
        assert result1['data'] == result2['data']
        if 'metadata' in result2:
            assert result2['metadata'].get('cached') == True
    
    @pytest.mark.asyncio
    async def test_error_handling_pinecone(self, mock_openai, mock_pinecone, mock_embedding):
        """Test handling Pinecone connection errors"""
        mock_openai.embeddings.create.return_value = Mock(
            data=[Mock(embedding=mock_embedding)]
        )
        
        mock_namespace = Mock()
        mock_namespace.query.side_effect = Exception("Pinecone namespace error")
        mock_index = Mock()
        mock_index.namespace.return_value = mock_namespace
        mock_pinecone.index.return_value = mock_index
        
        from app.api.tools.search_summaries.route import searchSummariesHandler
        
        result = await searchSummariesHandler({
            'query': 'test'
        })
        
        assert result['success'] == False
        assert result['error']['code'] in ['PINECONE_ERROR', 'SEARCH_ERROR']
        assert result['error']['retryable'] == True