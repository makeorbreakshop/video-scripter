"""
Tests for search_thumbs tool (visual similarity search)
"""

import pytest
from unittest.mock import Mock, patch, AsyncMock
import json
import numpy as np

class TestSearchThumbs:
    """Test suite for search_thumbs tool"""
    
    @pytest.fixture
    def mock_clip_embedding(self):
        """Mock CLIP embedding (768D for ViT-L-14)"""
        return np.random.rand(768).tolist()
    
    @pytest.fixture
    def sample_visual_results(self):
        """Sample Pinecone results for visual search"""
        return [
            {
                'id': 'video_1',
                'score': 0.92,  # High visual similarity
                'metadata': {
                    'title': 'DIY Woodworking Project',
                    'thumbnail_url': 'https://example.com/thumb1.jpg',
                    'channel_id': 'channel_diy',
                    'topic_niche': 'crafts',
                    'temporal_performance_score': 3.5,
                    'published_at': '2025-01-10T00:00:00Z',
                    'is_short': False
                }
            },
            {
                'id': 'video_2',
                'score': 0.78,  # Medium visual similarity
                'metadata': {
                    'title': 'Building a Bookshelf',
                    'thumbnail_url': 'https://example.com/thumb2.jpg',
                    'channel_id': 'channel_make',
                    'topic_niche': 'crafts',
                    'temporal_performance_score': 2.1,
                    'published_at': '2025-01-08T00:00:00Z',
                    'is_short': False
                }
            },
            {
                'id': 'video_3',
                'score': 0.65,  # Just above threshold
                'metadata': {
                    'title': 'Home Improvement Tips',
                    'thumbnail_url': 'https://example.com/thumb3.jpg',
                    'channel_id': 'channel_home',
                    'topic_niche': 'home',
                    'temporal_performance_score': 1.8
                }
            },
            {
                'id': 'video_4',
                'score': 0.55,  # Below threshold (0.6)
                'metadata': {
                    'title': 'Cooking Recipe',
                    'thumbnail_url': 'https://example.com/thumb4.jpg',
                    'channel_id': 'channel_food',
                    'topic_niche': 'cooking'
                }
            }
        ]
    
    @pytest.mark.asyncio
    async def test_text_query_visual_search(self, mock_replicate, mock_pinecone, mock_clip_embedding, sample_visual_results):
        """Test visual search with text query"""
        # Mock Replicate CLIP embedding
        mock_replicate.run.return_value = mock_clip_embedding
        
        # Mock Pinecone search
        mock_index = Mock()
        mock_index.query.return_value = Mock(matches=sample_visual_results)
        mock_pinecone.index.return_value = mock_index
        
        from app.api.tools.search_thumbs.route import searchThumbsHandler
        
        result = await searchThumbsHandler({
            'query': 'woodworking tools on workbench',
            'query_type': 'text'
        })
        
        assert result['success'] == True
        assert result['data']['query'] == 'woodworking tools on workbench'
        # Should filter out scores < 0.6
        assert len(result['data']['results']) == 3
        assert result['data']['total_results'] == 3
        # Verify all above threshold
        for r in result['data']['results']:
            assert r['similarity_score'] >= 0.6
    
    @pytest.mark.asyncio
    async def test_image_url_query(self, mock_replicate, mock_pinecone, mock_clip_embedding):
        """Test visual search with image URL"""
        mock_replicate.run.return_value = mock_clip_embedding
        
        results = [
            {
                'id': 'similar_video',
                'score': 0.88,
                'metadata': {
                    'title': 'Visually Similar Content',
                    'thumbnail_url': 'https://example.com/similar.jpg'
                }
            }
        ]
        
        mock_index = Mock()
        mock_index.query.return_value = Mock(matches=results)
        mock_pinecone.index.return_value = mock_index
        
        from app.api.tools.search_thumbs.route import searchThumbsHandler
        
        result = await searchThumbsHandler({
            'query': 'https://example.com/reference-image.jpg',
            'query_type': 'image'
        })
        
        assert result['success'] == True
        # Verify Replicate was called with image mode
        mock_replicate.run.assert_called()
        call_args = mock_replicate.run.call_args[0][1]['input']
        assert call_args['mode'] == 'embedding'
        assert call_args['image'] == 'https://example.com/reference-image.jpg'
        assert 'text' not in call_args
    
    @pytest.mark.asyncio
    async def test_multiple_queries(self, mock_replicate, mock_pinecone, mock_clip_embedding):
        """Test visual search with multiple queries (batch)"""
        # Return different embeddings for each query
        mock_replicate.run.side_effect = [
            mock_clip_embedding,
            np.random.rand(768).tolist(),
            np.random.rand(768).tolist()
        ]
        
        # Different results for each embedding
        mock_index = Mock()
        mock_index.query.side_effect = [
            Mock(matches=[{'id': 'v1', 'score': 0.8, 'metadata': {}}]),
            Mock(matches=[{'id': 'v2', 'score': 0.75, 'metadata': {}}]),
            Mock(matches=[{'id': 'v3', 'score': 0.7, 'metadata': {}}])
        ]
        mock_pinecone.index.return_value = mock_index
        
        from app.api.tools.search_thumbs.route import searchThumbsHandler
        
        result = await searchThumbsHandler({
            'query': ['red sports car', 'blue ocean sunset', 'mountain landscape'],
            'query_type': 'text'
        })
        
        assert result['success'] == True
        # Should have aggregated results
        assert len(result['data']['results']) >= 1
        # Replicate should be called 3 times
        assert mock_replicate.run.call_count == 3
    
    @pytest.mark.asyncio
    async def test_higher_similarity_threshold(self, mock_replicate, mock_pinecone, mock_clip_embedding, sample_visual_results):
        """Test that visual search uses higher threshold (0.6) than text (0.5)"""
        mock_replicate.run.return_value = mock_clip_embedding
        
        mock_index = Mock()
        mock_index.query.return_value = Mock(matches=sample_visual_results)
        mock_pinecone.index.return_value = mock_index
        
        from app.api.tools.search_thumbs.route import searchThumbsHandler
        
        result = await searchThumbsHandler({
            'query': 'test visual',
            'min_score': 0.6  # Default for visual
        })
        
        assert result['success'] == True
        # Video 4 with score 0.55 should be filtered out
        filtered_ids = [r['video_id'] for r in result['data']['results']]
        assert 'video_4' not in filtered_ids
        # All results should be >= 0.6
        for r in result['data']['results']:
            assert r['similarity_score'] >= 0.6
    
    @pytest.mark.asyncio
    async def test_filter_by_niches(self, mock_replicate, mock_pinecone, mock_clip_embedding):
        """Test filtering visual results by topic niches"""
        mock_replicate.run.return_value = mock_clip_embedding
        
        crafts_results = [
            {
                'id': 'craft_video',
                'score': 0.75,
                'metadata': {
                    'topic_niche': 'crafts',
                    'thumbnail_url': 'https://example.com/craft.jpg'
                }
            }
        ]
        
        mock_index = Mock()
        mock_index.query.return_value = Mock(matches=crafts_results)
        mock_pinecone.index.return_value = mock_index
        
        from app.api.tools.search_thumbs.route import searchThumbsHandler
        
        result = await searchThumbsHandler({
            'query': 'DIY project',
            'filters': {
                'niches': ['crafts', 'diy']
            }
        })
        
        assert result['success'] == True
        for r in result['data']['results']:
            assert r['metadata']['topic_niche'] in ['crafts', 'diy']
    
    @pytest.mark.asyncio
    async def test_filter_by_tps(self, mock_replicate, mock_pinecone, mock_clip_embedding):
        """Test filtering by temporal performance score"""
        mock_replicate.run.return_value = mock_clip_embedding
        
        high_perf_results = [
            {
                'id': 'viral_thumb',
                'score': 0.82,
                'metadata': {
                    'temporal_performance_score': 12.5,
                    'thumbnail_url': 'https://example.com/viral.jpg'
                }
            }
        ]
        
        mock_index = Mock()
        mock_index.query.return_value = Mock(matches=high_perf_results)
        mock_pinecone.index.return_value = mock_index
        
        from app.api.tools.search_thumbs.route import searchThumbsHandler
        
        result = await searchThumbsHandler({
            'query': 'viral thumbnail style',
            'filters': {
                'minTPS': 10.0
            }
        })
        
        assert result['success'] == True
        for r in result['data']['results']:
            assert r['metadata']['temporal_performance_score'] >= 10.0
    
    @pytest.mark.asyncio
    async def test_exclude_shorts(self, mock_replicate, mock_pinecone, mock_clip_embedding):
        """Test excluding shorts from visual search"""
        mock_replicate.run.return_value = mock_clip_embedding
        
        long_form_results = [
            {
                'id': 'long_video',
                'score': 0.7,
                'metadata': {
                    'is_short': False,
                    'thumbnail_url': 'https://example.com/long.jpg'
                }
            }
        ]
        
        mock_index = Mock()
        mock_index.query.return_value = Mock(matches=long_form_results)
        mock_pinecone.index.return_value = mock_index
        
        from app.api.tools.search_thumbs.route import searchThumbsHandler
        
        result = await searchThumbsHandler({
            'query': 'tutorial thumbnail',
            'filters': {
                'excludeShorts': True
            }
        })
        
        assert result['success'] == True
        for r in result['data']['results']:
            assert r['metadata'].get('is_short', False) == False
    
    @pytest.mark.asyncio
    async def test_date_range_filtering(self, mock_replicate, mock_pinecone, mock_clip_embedding):
        """Test filtering by publish date"""
        mock_replicate.run.return_value = mock_clip_embedding
        
        recent_results = [
            {
                'id': 'recent_video',
                'score': 0.68,
                'metadata': {
                    'published_at': '2025-01-12T00:00:00Z',
                    'thumbnail_url': 'https://example.com/recent.jpg'
                }
            }
        ]
        
        mock_index = Mock()
        mock_index.query.return_value = Mock(matches=recent_results)
        mock_pinecone.index.return_value = mock_index
        
        from app.api.tools.search_thumbs.route import searchThumbsHandler
        from datetime import datetime
        
        result = await searchThumbsHandler({
            'query': 'recent trends',
            'filters': {
                'dateRange': {
                    'start': datetime(2025, 1, 10),
                    'end': datetime(2025, 1, 15)
                }
            }
        })
        
        assert result['success'] == True
        for r in result['data']['results']:
            pub_date = r['metadata']['published_at']
            assert '2025-01-1' in pub_date
    
    @pytest.mark.asyncio
    async def test_top_k_limit(self, mock_replicate, mock_pinecone, mock_clip_embedding):
        """Test limiting number of visual results"""
        mock_replicate.run.return_value = mock_clip_embedding
        
        many_results = [
            {'id': f'video_{i}', 'score': 0.9 - i*0.02, 'metadata': {'thumbnail_url': f'url_{i}'}}
            for i in range(30)
        ]
        
        mock_index = Mock()
        mock_index.query.return_value = Mock(matches=many_results)
        mock_pinecone.index.return_value = mock_index
        
        from app.api.tools.search_thumbs.route import searchThumbsHandler
        
        result = await searchThumbsHandler({
            'query': 'test',
            'top_k': 5
        })
        
        assert result['success'] == True
        assert len(result['data']['results']) <= 5
    
    @pytest.mark.asyncio
    async def test_empty_query_error(self):
        """Test that empty query returns error"""
        from app.api.tools.search_thumbs.route import searchThumbsHandler
        
        result = await searchThumbsHandler({
            'query': []  # Empty array
        })
        
        assert result['success'] == False
        assert result['error']['code'] == 'INVALID_PARAMS'
        assert 'query is required' in result['error']['message']
    
    @pytest.mark.asyncio
    async def test_metadata_enrichment(self, mock_replicate, mock_pinecone, mock_supabase, mock_clip_embedding):
        """Test enriching visual results with additional metadata"""
        mock_replicate.run.return_value = mock_clip_embedding
        
        basic_results = [
            {'id': 'video_1', 'score': 0.75, 'metadata': {'thumbnail_url': 'url1'}}
        ]
        
        mock_index = Mock()
        mock_index.query.return_value = Mock(matches=basic_results)
        mock_pinecone.index.return_value = mock_index
        
        # Mock enriched data
        mock_supabase.from_().select().in_().execute.return_value = Mock(
            data=[
                {
                    'id': 'video_1',
                    'title': 'Enriched Title',
                    'channel_name': 'Popular Channel',
                    'view_count': 500000,
                    'format_type': 'tutorial',
                    'topic_niche': 'education'
                }
            ]
        )
        
        from app.api.tools.search_thumbs.route import searchThumbsHandler
        
        result = await searchThumbsHandler(
            {'query': 'test'},
            {'enrichMetadata': True}
        )
        
        assert result['success'] == True
        enriched = result['data']['results'][0]['metadata']
        assert enriched['channel_name'] == 'Popular Channel'
        assert enriched['view_count'] == 500000
        assert enriched['format_type'] == 'tutorial'
    
    @pytest.mark.asyncio
    async def test_clip_embedding_error(self, mock_replicate):
        """Test handling CLIP embedding generation errors"""
        mock_replicate.run.side_effect = Exception("Replicate API error")
        
        from app.api.tools.search_thumbs.route import searchThumbsHandler
        
        result = await searchThumbsHandler({
            'query': 'test visual'
        })
        
        assert result['success'] == False
        assert result['error']['code'] in ['EMBEDDING_ERROR', 'REPLICATE_ERROR']
        assert result['error']['retryable'] == True
    
    @pytest.mark.asyncio
    async def test_pinecone_error(self, mock_replicate, mock_pinecone, mock_clip_embedding):
        """Test handling Pinecone errors"""
        mock_replicate.run.return_value = mock_clip_embedding
        
        mock_index = Mock()
        mock_index.query.side_effect = Exception("Pinecone connection failed")
        mock_pinecone.index.return_value = mock_index
        
        from app.api.tools.search_thumbs.route import searchThumbsHandler
        
        result = await searchThumbsHandler({
            'query': 'test'
        })
        
        assert result['success'] == False
        assert result['error']['code'] in ['PINECONE_ERROR', 'SEARCH_ERROR']
        assert result['error']['retryable'] == True
    
    @pytest.mark.asyncio
    async def test_rate_limit_handling(self, mock_replicate):
        """Test handling rate limit errors from Replicate"""
        mock_replicate.run.side_effect = Exception("Rate limit exceeded")
        
        from app.api.tools.search_thumbs.route import searchThumbsHandler
        
        result = await searchThumbsHandler({
            'query': 'test'
        })
        
        assert result['success'] == False
        assert result['error']['code'] == 'RATE_LIMIT'
        assert result['error']['retryable'] == True
    
    @pytest.mark.asyncio
    async def test_result_aggregation_multiple_queries(self, mock_replicate, mock_pinecone):
        """Test that multiple queries aggregate results properly"""
        # Different embeddings for each query
        mock_replicate.run.side_effect = [
            np.random.rand(768).tolist(),
            np.random.rand(768).tolist()
        ]
        
        # Same video appears in both results with different scores
        mock_index = Mock()
        mock_index.query.side_effect = [
            Mock(matches=[
                {'id': 'video_1', 'score': 0.7, 'metadata': {}},
                {'id': 'video_2', 'score': 0.65, 'metadata': {}}
            ]),
            Mock(matches=[
                {'id': 'video_1', 'score': 0.8, 'metadata': {}},  # Higher score
                {'id': 'video_3', 'score': 0.62, 'metadata': {}}
            ])
        ]
        mock_pinecone.index.return_value = mock_index
        
        from app.api.tools.search_thumbs.route import searchThumbsHandler
        
        result = await searchThumbsHandler({
            'query': ['query1', 'query2']
        })
        
        assert result['success'] == True
        # Should have 3 unique videos
        video_ids = [r['video_id'] for r in result['data']['results']]
        assert len(set(video_ids)) == len(video_ids)  # All unique
        # video_1 should have the higher score (0.8)
        video_1_result = next(r for r in result['data']['results'] if r['video_id'] == 'video_1')
        assert video_1_result['similarity_score'] == 0.8
    
    @pytest.mark.asyncio
    async def test_caching_visual_search(self, mock_replicate, mock_pinecone, mock_clip_embedding):
        """Test that visual searches are cached"""
        mock_replicate.run.return_value = mock_clip_embedding
        
        results = [{'id': 'v1', 'score': 0.85, 'metadata': {}}]
        mock_index = Mock()
        mock_index.query.return_value = Mock(matches=results)
        mock_pinecone.index.return_value = mock_index
        
        from app.api.tools.search_thumbs.route import searchThumbsHandler
        
        context = {'requestId': 'visual-cache-test'}
        
        # First call
        result1 = await searchThumbsHandler({'query': 'red car'}, context)
        # Second call should use cache
        result2 = await searchThumbsHandler({'query': 'red car'}, context)
        
        assert result1['success'] == True
        assert result2['success'] == True
        assert result1['data'] == result2['data']
        # Should only call Replicate once
        assert mock_replicate.run.call_count == 1
        if 'metadata' in result2:
            assert result2['metadata'].get('cached') == True