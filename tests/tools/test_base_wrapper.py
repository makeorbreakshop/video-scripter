"""
Tests for base tool wrapper functionality
"""

import pytest
import asyncio
from unittest.mock import Mock, AsyncMock, patch
import time
import sys
import os

# Add project root to path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../..')))

from lib.tools.base_wrapper import (
    wrapTool,
    MemoryCache,
    SimpleLogger,
    createToolContext,
    executeParallel
)

class TestMemoryCache:
    """Test the in-memory cache implementation"""
    
    @pytest.mark.asyncio
    async def test_cache_set_and_get(self):
        """Test basic cache set and get operations"""
        cache = MemoryCache()
        
        await cache.set('test_key', {'data': 'test_value'}, ttl=5)
        result = await cache.get('test_key')
        
        assert result == {'data': 'test_value'}
    
    @pytest.mark.asyncio
    async def test_cache_expiry(self):
        """Test that cache entries expire after TTL"""
        cache = MemoryCache()
        
        await cache.set('test_key', 'test_value', ttl=0.1)  # 100ms TTL
        
        # Should exist immediately
        assert await cache.exists('test_key') == True
        
        # Wait for expiry
        await asyncio.sleep(0.2)
        
        # Should be expired
        assert await cache.exists('test_key') == False
        assert await cache.get('test_key') == None
    
    @pytest.mark.asyncio
    async def test_cache_delete(self):
        """Test cache deletion"""
        cache = MemoryCache()
        
        await cache.set('test_key', 'test_value')
        assert await cache.exists('test_key') == True
        
        await cache.delete('test_key')
        assert await cache.exists('test_key') == False
    
    def test_cache_cleanup(self):
        """Test that cleanup removes expired entries"""
        cache = MemoryCache()
        
        # Add entries with past expiry
        cache.cache['expired1'] = {'value': 'data', 'expiry': time.time() - 1}
        cache.cache['expired2'] = {'value': 'data', 'expiry': time.time() - 1}
        cache.cache['valid'] = {'value': 'data', 'expiry': time.time() + 100}
        
        assert len(cache.cache) == 3
        
        cache.cleanup()
        
        assert len(cache.cache) == 1
        assert 'valid' in cache.cache


class TestWrapTool:
    """Test the tool wrapper functionality"""
    
    @pytest.mark.asyncio
    async def test_successful_execution(self):
        """Test successful tool execution"""
        # Create a mock handler
        async def mock_handler(params, context):
            return {
                'success': True,
                'data': {'result': params['input'] * 2}
            }
        
        # Wrap the handler
        wrapped = wrapTool({
            'name': 'test_tool',
            'description': 'Test tool',
            'parameters': {},
            'handler': mock_handler,
            'parallelSafe': True
        })
        
        # Execute
        result = await wrapped({'input': 5})
        
        assert result['success'] == True
        assert result['data']['result'] == 10
        assert result['metadata']['cached'] == False
        assert result['metadata']['source'] == 'handler'
    
    @pytest.mark.asyncio
    async def test_caching_behavior(self):
        """Test that caching prevents duplicate executions"""
        call_count = 0
        
        async def mock_handler(params, context):
            nonlocal call_count
            call_count += 1
            return {
                'success': True,
                'data': {'count': call_count}
            }
        
        # Create a shared context with cache
        context = createToolContext()
        
        # Wrap with caching
        wrapped = wrapTool({
            'name': 'cached_tool',
            'description': 'Cached test tool',
            'parameters': {},
            'handler': mock_handler,
            'cacheTTL': 5
        })
        
        # First call - should execute handler
        result1 = await wrapped({'input': 'test'}, context)
        assert result1['data']['count'] == 1
        assert result1['metadata']['cached'] == False
        
        # Second call with same context - should use cache
        result2 = await wrapped({'input': 'test'}, context)
        assert result2['data']['count'] == 1  # Same as first
        assert result2['metadata']['cached'] == True
        assert call_count == 1  # Handler called only once
    
    @pytest.mark.asyncio
    async def test_retry_on_failure(self):
        """Test retry logic on failures"""
        attempt_count = 0
        
        async def flaky_handler(params, context):
            nonlocal attempt_count
            attempt_count += 1
            
            if attempt_count < 3:
                raise Exception("Temporary failure")
            
            return {
                'success': True,
                'data': {'attempts': attempt_count}
            }
        
        # Wrap with retry config
        wrapped = wrapTool({
            'name': 'flaky_tool',
            'description': 'Flaky test tool',
            'parameters': {},
            'handler': flaky_handler,
            'retryConfig': {
                'maxRetries': 3,
                'backoffMs': 10
            }
        })
        
        # Should succeed after retries
        result = await wrapped({})
        assert result['success'] == True
        assert result['data']['attempts'] == 3
        assert attempt_count == 3
    
    @pytest.mark.asyncio
    async def test_timeout_handling(self):
        """Test that timeouts are properly enforced"""
        async def slow_handler(params, context):
            await asyncio.sleep(1)  # Sleep for 1 second
            return {'success': True, 'data': 'done'}
        
        # Wrap with short timeout (in seconds for Python)
        wrapped = wrapTool({
            'name': 'slow_tool',
            'description': 'Slow test tool',
            'parameters': {},
            'handler': slow_handler,
            'timeout': 0.1,  # 100ms timeout (in seconds)
            'retryConfig': {'maxRetries': 1}  # Don't retry
        })
        
        # Should timeout
        result = await wrapped({})
        assert result['success'] == False
        assert 'timeout' in result['error']['message'].lower()
    
    @pytest.mark.asyncio
    async def test_error_handling(self):
        """Test proper error handling and formatting"""
        async def error_handler(params, context):
            raise ValueError("Invalid input provided")
        
        wrapped = wrapTool({
            'name': 'error_tool',
            'description': 'Error test tool',
            'parameters': {},
            'handler': error_handler,
            'retryConfig': {'maxRetries': 1}
        })
        
        result = await wrapped({})
        assert result['success'] == False
        assert result['error']['code'] == 'TOOL_ERROR'
        assert 'Invalid input provided' in result['error']['message']
        assert result['error']['retryable'] == False


class TestExecuteParallel:
    """Test parallel tool execution"""
    
    @pytest.mark.asyncio
    async def test_parallel_execution(self):
        """Test that tools execute in parallel"""
        start_time = time.time()
        
        async def slow_handler(params, context):
            await asyncio.sleep(0.1)  # 100ms
            return {'success': True, 'data': params['id']}
        
        # Create multiple tool configs
        tools = [
            {
                'config': {
                    'name': f'tool_{i}',
                    'description': f'Tool {i}',
                    'parameters': {},
                    'handler': slow_handler,
                    'parallelSafe': True
                },
                'params': {'id': i}
            }
            for i in range(3)
        ]
        
        # Execute in parallel
        results = await executeParallel(tools)
        
        elapsed = time.time() - start_time
        
        # Should complete in ~100ms, not 300ms
        assert elapsed < 0.2
        assert len(results) == 3
        assert all(r['success'] for r in results)
    
    @pytest.mark.asyncio
    async def test_parallel_safety_check(self):
        """Test that non-parallel-safe tools are rejected"""
        async def handler(params, context):
            return {'success': True}
        
        tools = [{
            'config': {
                'name': 'unsafe_tool',
                'description': 'Not parallel safe',
                'parameters': {},
                'handler': handler,
                'parallelSafe': False  # Not parallel safe
            },
            'params': {}
        }]
        
        with pytest.raises(Exception) as exc_info:
            await executeParallel(tools)
        
        assert 'not marked as parallel-safe' in str(exc_info.value)


class TestToolContext:
    """Test tool context creation"""
    
    def test_context_creation_with_defaults(self):
        """Test that context is created with defaults"""
        context = createToolContext()
        
        assert context['requestId'] is not None
        assert context['mode'] == 'agentic'
        assert context['cache'] is not None
        assert context['logger'] is not None
    
    def test_context_creation_with_overrides(self):
        """Test that context overrides work"""
        custom_cache = MemoryCache()
        custom_logger = SimpleLogger('[Custom]')
        
        context = createToolContext({
            'requestId': 'custom-123',
            'mode': 'classic',
            'cache': custom_cache,
            'logger': custom_logger
        })
        
        assert context['requestId'] == 'custom-123'
        assert context['mode'] == 'classic'
        assert context['cache'] == custom_cache
        assert context['logger'] == custom_logger