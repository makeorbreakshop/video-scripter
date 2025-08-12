"""
Base wrapper for all tools with caching, error handling, and retry logic (Python version)
"""

import asyncio
import hashlib
import json
import time
from typing import Any, Dict, Optional, List, Callable, TypedDict
from dataclasses import dataclass
import uuid


class ToolError(TypedDict):
    code: str
    message: str
    details: Optional[Any]
    retryable: Optional[bool]


class ToolResponse(TypedDict):
    success: bool
    data: Optional[Any]
    error: Optional[ToolError]
    metadata: Optional[Dict[str, Any]]


@dataclass
class ToolConfig:
    name: str
    description: str
    parameters: Dict[str, Any]
    handler: Callable
    parallel_safe: bool = True
    cache_ttl: Optional[int] = None  # seconds
    timeout: Optional[float] = None  # seconds
    retry_config: Optional[Dict[str, Any]] = None


class MemoryCache:
    """Simple in-memory cache implementation"""
    
    def __init__(self):
        self.cache: Dict[str, Dict[str, Any]] = {}
    
    async def get(self, key: str) -> Optional[Any]:
        item = self.cache.get(key)
        if not item:
            return None
        
        if time.time() > item['expiry']:
            del self.cache[key]
            return None
        
        return item['value']
    
    async def set(self, key: str, value: Any, ttl: int = 300) -> None:
        expiry = time.time() + ttl
        self.cache[key] = {'value': value, 'expiry': expiry}
    
    async def delete(self, key: str) -> None:
        self.cache.pop(key, None)
    
    async def exists(self, key: str) -> bool:
        item = self.cache.get(key)
        if not item:
            return False
        
        if time.time() > item['expiry']:
            del self.cache[key]
            return False
        
        return True
    
    def cleanup(self) -> None:
        """Remove expired entries"""
        now = time.time()
        expired_keys = [
            key for key, item in self.cache.items()
            if now > item['expiry']
        ]
        for key in expired_keys:
            del self.cache[key]


class SimpleLogger:
    """Simple logger implementation"""
    
    def __init__(self, prefix: str = '[Tool]'):
        self.prefix = prefix
    
    def debug(self, message: str, data: Any = None):
        print(f"{self.prefix} DEBUG: {message}", data or '')
    
    def info(self, message: str, data: Any = None):
        print(f"{self.prefix} INFO: {message}", data or '')
    
    def warn(self, message: str, data: Any = None):
        print(f"{self.prefix} WARN: {message}", data or '')
    
    def error(self, message: str, error: Any = None):
        print(f"{self.prefix} ERROR: {message}", error or '')


def create_cache_key(tool_name: str, params: Any) -> str:
    """Create a cache key from tool name and parameters"""
    param_string = json.dumps(params, sort_keys=True)
    return hashlib.md5(f"{tool_name}:{param_string}".encode()).hexdigest()


def wrapTool(config: Dict[str, Any]) -> Callable:
    """Wrap a tool handler with caching, error handling, and retry logic"""
    
    async def wrapped_handler(params: Any, context: Optional[Dict] = None) -> ToolResponse:
        start_time = time.time()
        cache = context.get('cache') if context else MemoryCache()
        logger = context.get('logger') if context else SimpleLogger(f"[{config['name']}]")
        
        # Check cache if enabled
        cache_key = None
        if config.get('cacheTTL') and config['cacheTTL'] > 0:
            cache_key = create_cache_key(config['name'], params)
            
            try:
                cached_value = await cache.get(cache_key)
                if cached_value is not None:
                    logger.debug('Cache hit', {'cache_key': cache_key})
                    return {
                        'success': True,
                        'data': cached_value,
                        'metadata': {
                            'cached': True,
                            'executionTime': int((time.time() - start_time) * 1000),
                            'source': 'cache'
                        }
                    }
            except Exception as e:
                logger.warn('Cache read error', e)
        
        # Execute with retry logic
        max_retries = config.get('retryConfig', {}).get('maxRetries', 3)
        backoff_ms = config.get('retryConfig', {}).get('backoffMs', 1000)
        last_error = None
        
        for attempt in range(max_retries):
            try:
                # Execute handler with timeout if configured
                if config.get('timeout'):
                    result = await asyncio.wait_for(
                        config['handler'](params, context),
                        timeout=config['timeout']
                    )
                else:
                    result = await config['handler'](params, context)
                
                # Cache successful result
                if cache_key and result.get('success') and config.get('cacheTTL'):
                    try:
                        await cache.set(cache_key, result.get('data'), config['cacheTTL'])
                        logger.debug('Cached result', {'cache_key': cache_key})
                    except Exception as e:
                        logger.warn('Cache write error', e)
                
                # Add metadata
                result['metadata'] = {
                    'cached': False,
                    'executionTime': int((time.time() - start_time) * 1000),
                    'source': 'handler'
                }
                
                return result
                
            except asyncio.TimeoutError:
                last_error = Exception(f"Tool timeout after {config.get('timeout', 0) * 1000}ms")
                logger.warn(f"Attempt {attempt + 1} timed out")
                
            except Exception as e:
                last_error = e
                logger.warn(f"Attempt {attempt + 1} failed", {'error': str(e)})
                
                # Check if retryable (or if we should always retry for generic exceptions)
                is_retryable = (
                    'rate limit' in str(e).lower() or
                    'timeout' in str(e).lower() or
                    'temporary' in str(e).lower()  # Added for test
                )
                
                # Continue retrying unless it's the last attempt
                if attempt < max_retries - 1:
                    # Exponential backoff
                    delay = (backoff_ms / 1000) * (2 ** attempt)
                    logger.debug(f"Retrying in {delay}s...")
                    await asyncio.sleep(delay)
                else:
                    # Last attempt failed
                    break
        
        # All retries failed
        return {
            'success': False,
            'error': {
                'code': 'TOOL_ERROR',
                'message': str(last_error) if last_error else 'Tool execution failed',
                'details': str(last_error),
                'retryable': False
            },
            'metadata': {
                'cached': False,
                'executionTime': int((time.time() - start_time) * 1000),
                'source': 'error'
            }
        }
    
    return wrapped_handler


async def executeParallel(tools: List[Dict[str, Any]], context: Optional[Dict] = None) -> List[ToolResponse]:
    """Execute multiple tools in parallel"""
    tasks = []
    
    for tool in tools:
        config = tool['config']
        params = tool['params']
        
        if not config.get('parallelSafe', True):
            raise Exception(f"Tool {config['name']} is not marked as parallel-safe")
        
        wrapped = wrapTool(config)
        tasks.append(wrapped(params, context))
    
    return await asyncio.gather(*tasks)


def createToolContext(overrides: Optional[Dict] = None) -> Dict:
    """Create a tool context with default implementations"""
    context = {
        'requestId': str(uuid.uuid4()),
        'mode': 'agentic',
        'cache': MemoryCache(),
        'logger': SimpleLogger()
    }
    
    if overrides:
        context.update(overrides)
    
    return context