"""
Shared pytest fixtures for Agentic Mode testing
"""

import pytest
import asyncio
from typing import Dict, Any
from unittest.mock import Mock, AsyncMock, patch
import os
import json

# Set test environment
os.environ['NODE_ENV'] = 'test'
os.environ['TESTING'] = 'true'

@pytest.fixture
def mock_supabase():
    """Mock Supabase client for testing"""
    with patch('lib.supabase.createClient') as mock_client:
        client = Mock()
        
        # Mock common database operations
        client.from_ = Mock(return_value=client)
        client.select = Mock(return_value=client)
        client.insert = Mock(return_value=client)
        client.update = Mock(return_value=client)
        client.delete = Mock(return_value=client)
        client.eq = Mock(return_value=client)
        client.gte = Mock(return_value=client)
        client.lte = Mock(return_value=client)
        client.order = Mock(return_value=client)
        client.limit = Mock(return_value=client)
        client.single = Mock(return_value=client)
        
        # Default execute response
        client.execute = Mock(return_value={
            'data': [],
            'error': None
        })
        
        mock_client.return_value = client
        yield client

@pytest.fixture
def mock_pinecone():
    """Mock Pinecone client for testing"""
    with patch('pinecone.Pinecone') as mock_pinecone:
        index = Mock()
        
        # Mock vector operations
        index.query = Mock(return_value={
            'matches': [
                {'id': 'video1', 'score': 0.95},
                {'id': 'video2', 'score': 0.85}
            ]
        })
        index.upsert = Mock(return_value={'upserted_count': 1})
        
        client = Mock()
        client.Index = Mock(return_value=index)
        
        mock_pinecone.return_value = client
        yield index

@pytest.fixture
def mock_openai():
    """Mock OpenAI client for testing"""
    with patch('openai.OpenAI') as mock_openai:
        client = Mock()
        
        # Mock embeddings
        client.embeddings.create = Mock(return_value=Mock(
            data=[Mock(embedding=[0.1] * 512)]
        ))
        
        # Mock chat completions
        client.chat.completions.create = Mock(return_value=Mock(
            choices=[Mock(message=Mock(content="Test response"))],
            usage=Mock(total_tokens=100)
        ))
        
        # Mock responses API (for agentic mode)
        client.responses.create = AsyncMock(return_value=Mock(
            id='resp_123',
            output="Test agentic response",
            tool_calls=[],
            usage=Mock(total_tokens=150)
        ))
        
        mock_openai.return_value = client
        yield client

@pytest.fixture
def sample_video_data():
    """Sample video data for testing"""
    return {
        'id': 'test_video_123',
        'title': 'Building a Cheap, Fun Project Car in 48 Hours',
        'channel_id': 'test_channel_456',
        'channel_name': 'Speeed',
        'view_count': 2000000,
        'published_at': '2025-01-01T00:00:00Z',
        'temporal_performance_score': 3.5,
        'channel_baseline_at_publish': 500000,
        'is_short': False,
        'format_type': 'Build/Project',
        'topic_niche': 'Automotive',
        'thumbnail_url': 'https://example.com/thumb.jpg',
        'summary': 'In this video, we build a cheap project car...'
    }

@pytest.fixture
def sample_channel_data():
    """Sample channel data for testing"""
    return {
        'channel_id': 'test_channel_456',
        'channel_name': 'Speeed',
        'videos': [
            {'id': 'v1', 'view_count': 500000, 'published_at': '2024-12-15T00:00:00Z'},
            {'id': 'v2', 'view_count': 450000, 'published_at': '2024-12-10T00:00:00Z'},
            {'id': 'v3', 'view_count': 600000, 'published_at': '2024-12-05T00:00:00Z'},
        ]
    }

@pytest.fixture
def mock_redis():
    """Mock Redis client for caching tests"""
    with patch('redis.Redis') as mock_redis:
        client = Mock()
        
        # In-memory cache for testing
        cache = {}
        
        client.get = Mock(side_effect=lambda k: cache.get(k))
        client.set = Mock(side_effect=lambda k, v, ex=None: cache.update({k: v}))
        client.delete = Mock(side_effect=lambda k: cache.pop(k, None))
        client.exists = Mock(side_effect=lambda k: k in cache)
        
        mock_redis.return_value = client
        yield client

@pytest.fixture
async def async_client():
    """Async HTTP client for API testing"""
    from httpx import AsyncClient
    
    # You'll need to import your Next.js app here
    # For now, using a mock base URL
    async with AsyncClient(base_url="http://localhost:3000") as client:
        yield client

@pytest.fixture
def mock_tool_registry():
    """Mock tool registry for orchestrator tests"""
    return {
        'get_video_bundle': {
            'description': 'Fetch comprehensive video data',
            'handler': AsyncMock(return_value={'success': True}),
            'parallel_safe': True
        },
        'search_titles': {
            'description': 'Semantic search on titles',
            'handler': AsyncMock(return_value={'matches': []}),
            'parallel_safe': True
        }
    }

@pytest.fixture(autouse=True)
def reset_singletons():
    """Reset any singleton instances between tests"""
    # Add any singleton resets here
    yield
    # Cleanup after test

@pytest.fixture
def mock_env_vars(monkeypatch):
    """Set test environment variables"""
    test_vars = {
        'SUPABASE_URL': 'https://test.supabase.co',
        'SUPABASE_ANON_KEY': 'test_anon_key',
        'SUPABASE_SERVICE_ROLE_KEY': 'test_service_key',
        'OPENAI_API_KEY': 'test_openai_key',
        'PINECONE_API_KEY': 'test_pinecone_key',
        'PINECONE_INDEX_NAME': 'test-index',
        'REDIS_URL': 'redis://localhost:6379/0'
    }
    
    for key, value in test_vars.items():
        monkeypatch.setenv(key, value)
    
    return test_vars

# Async test support
@pytest.fixture(scope="session")
def event_loop():
    """Create an event loop for async tests"""
    loop = asyncio.get_event_loop_policy().new_event_loop()
    yield loop
    loop.close()