"""
Performance tests for memory usage and leak detection
"""

import pytest
import asyncio
import gc
import tracemalloc
import psutil
import os
import json
from typing import List, Dict, Any
from dataclasses import dataclass
import sys

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))))

# Import mocks
from tests.mocks.mock_responses_api import MockResponsesAPI
from tests.mocks.mock_tool_responses import MockToolResponses
from tests.mocks.mock_budget_scenarios import BudgetUsageSimulator, MockBudgetScenarios


@dataclass
class MemorySnapshot:
    """Memory usage snapshot"""
    timestamp: float
    rss: int  # Resident Set Size in bytes
    vms: int  # Virtual Memory Size in bytes
    available: int  # Available system memory
    percent: float  # Memory usage percentage
    
    @property
    def rss_mb(self) -> float:
        """RSS in megabytes"""
        return self.rss / (1024 * 1024)
    
    @property
    def vms_mb(self) -> float:
        """VMS in megabytes"""
        return self.vms / (1024 * 1024)


class MemoryMonitor:
    """Monitor memory usage during tests"""
    
    def __init__(self):
        self.process = psutil.Process(os.getpid())
        self.snapshots = []
        self.baseline = None
    
    def take_snapshot(self, label: str = "") -> MemorySnapshot:
        """Take a memory snapshot"""
        gc.collect()  # Force garbage collection
        
        mem_info = self.process.memory_info()
        mem_percent = self.process.memory_percent()
        available = psutil.virtual_memory().available
        
        snapshot = MemorySnapshot(
            timestamp=asyncio.get_event_loop().time(),
            rss=mem_info.rss,
            vms=mem_info.vms,
            available=available,
            percent=mem_percent
        )
        
        self.snapshots.append((label, snapshot))
        
        if self.baseline is None:
            self.baseline = snapshot
        
        return snapshot
    
    def get_memory_growth(self) -> float:
        """Get memory growth since baseline in MB"""
        if not self.snapshots or self.baseline is None:
            return 0
        
        latest = self.snapshots[-1][1]
        return (latest.rss - self.baseline.rss) / (1024 * 1024)
    
    def check_for_leak(self, threshold_mb: float = 100) -> bool:
        """Check if memory growth exceeds threshold"""
        growth = self.get_memory_growth()
        return growth > threshold_mb
    
    def get_summary(self) -> Dict[str, Any]:
        """Get memory usage summary"""
        if not self.snapshots:
            return {}
        
        rss_values = [s.rss_mb for _, s in self.snapshots]
        
        return {
            'baseline_mb': self.baseline.rss_mb if self.baseline else 0,
            'final_mb': rss_values[-1],
            'peak_mb': max(rss_values),
            'growth_mb': self.get_memory_growth(),
            'num_snapshots': len(self.snapshots)
        }


class MockSessionState:
    """Mock session state that can grow in size"""
    
    def __init__(self, size_kb: int = 10):
        """Initialize with specified size in KB"""
        self.data = {
            'video_context': {},
            'hypothesis': None,
            'search_results': [],
            'validation_results': [],
            'patterns': [],
            'tool_calls': [],
            'errors': []
        }
        
        # Add padding to reach desired size
        padding_size = max(0, size_kb * 1024 - len(json.dumps(self.data)))
        self.data['padding'] = 'x' * padding_size
    
    def add_tool_call(self, tool_name: str, result_size_kb: int = 1):
        """Add a tool call with result"""
        result = {
            'tool': tool_name,
            'timestamp': asyncio.get_event_loop().time(),
            'result': 'x' * (result_size_kb * 1024)
        }
        self.data['tool_calls'].append(result)
    
    def add_pattern(self, pattern_size_kb: int = 5):
        """Add a pattern discovery"""
        pattern = {
            'id': len(self.data['patterns']),
            'confidence': 0.85,
            'evidence': 'x' * (pattern_size_kb * 1024)
        }
        self.data['patterns'].append(pattern)
    
    def compact(self, keep_tools: int = 10, keep_patterns: int = 3):
        """Compact state to reduce size"""
        self.data['tool_calls'] = self.data['tool_calls'][-keep_tools:]
        self.data['patterns'] = self.data['patterns'][:keep_patterns]
        
        # Clear some data
        if 'padding' in self.data:
            self.data['padding'] = 'x' * 1024  # Keep only 1KB
    
    def get_size(self) -> int:
        """Get current size in bytes"""
        return len(json.dumps(self.data))
    
    def get_size_mb(self) -> float:
        """Get current size in MB"""
        return self.get_size() / (1024 * 1024)


class TestMemoryUsage:
    """Test memory usage characteristics"""
    
    @pytest.fixture
    def monitor(self):
        """Create memory monitor"""
        return MemoryMonitor()
    
    @pytest.mark.asyncio
    async def test_memory_leak_detection(self, monitor):
        """Test for memory leaks in repeated operations"""
        monitor.take_snapshot("baseline")
        
        # Create and destroy many objects
        for iteration in range(100):
            # Create session states
            states = []
            for i in range(10):
                state = MockSessionState(size_kb=100)  # 100KB each
                state.add_tool_call(f"tool_{i}", result_size_kb=10)
                state.add_pattern(pattern_size_kb=5)
                states.append(state)
            
            # Create API clients
            apis = []
            for i in range(5):
                api = MockResponsesAPI('normal')
                apis.append(api)
            
            # Create tool responses
            tools = []
            for i in range(5):
                tool = MockToolResponses('success')
                tools.append(tool)
            
            # Clear references
            states.clear()
            apis.clear()
            tools.clear()
            
            # Force garbage collection every 10 iterations
            if iteration % 10 == 0:
                gc.collect()
                monitor.take_snapshot(f"iteration_{iteration}")
        
        # Final cleanup
        gc.collect()
        monitor.take_snapshot("final")
        
        # Check for memory leak
        summary = monitor.get_summary()
        growth = summary['growth_mb']
        
        print(f"\nMemory Leak Test:")
        print(f"  Baseline: {summary['baseline_mb']:.2f} MB")
        print(f"  Final: {summary['final_mb']:.2f} MB")
        print(f"  Growth: {growth:.2f} MB")
        print(f"  Peak: {summary['peak_mb']:.2f} MB")
        
        # Assert no significant leak (allow up to 50MB growth)
        assert growth < 50, f"Memory leak detected: {growth:.2f} MB growth"
    
    @pytest.mark.asyncio
    async def test_state_size_limits(self, monitor):
        """Test state size growth and limits"""
        monitor.take_snapshot("baseline")
        
        # Create progressively larger states
        state_sizes = []
        
        for size_kb in [10, 50, 100, 500, 1000, 5000]:
            state = MockSessionState(size_kb=size_kb)
            
            # Add many tool calls
            for i in range(100):
                state.add_tool_call(f"tool_{i}", result_size_kb=1)
            
            # Add many patterns
            for i in range(50):
                state.add_pattern(pattern_size_kb=2)
            
            size_before = state.get_size_mb()
            
            # Test compaction
            state.compact(keep_tools=10, keep_patterns=3)
            
            size_after = state.get_size_mb()
            
            state_sizes.append({
                'initial_kb': size_kb,
                'before_compact_mb': size_before,
                'after_compact_mb': size_after,
                'reduction_pct': (1 - size_after/size_before) * 100 if size_before > 0 else 0
            })
            
            del state
            gc.collect()
        
        monitor.take_snapshot("after_states")
        
        print(f"\nState Size Limits Test:")
        for info in state_sizes:
            print(f"  {info['initial_kb']}KB initial:")
            print(f"    Before compact: {info['before_compact_mb']:.2f} MB")
            print(f"    After compact: {info['after_compact_mb']:.2f} MB")
            print(f"    Reduction: {info['reduction_pct']:.1f}%")
        
        # Compaction should significantly reduce size
        for info in state_sizes:
            assert info['reduction_pct'] > 50, "Compaction should reduce size by >50%"
        
        # Memory should be released after deletion
        summary = monitor.get_summary()
        assert summary['growth_mb'] < 100, "Memory not properly released"
    
    @pytest.mark.asyncio
    async def test_cache_memory_usage(self, monitor):
        """Test memory usage of caching layer"""
        monitor.take_snapshot("baseline")
        
        # Simulate cache with different sizes
        cache = {}
        cache_configs = [
            {'entries': 100, 'entry_size_kb': 10},
            {'entries': 1000, 'entry_size_kb': 5},
            {'entries': 10000, 'entry_size_kb': 1}
        ]
        
        for config in cache_configs:
            cache.clear()
            monitor.take_snapshot(f"before_{config['entries']}_entries")
            
            # Fill cache
            for i in range(config['entries']):
                key = f"tool_result_{i}"
                value = 'x' * (config['entry_size_kb'] * 1024)
                cache[key] = {
                    'result': value,
                    'timestamp': asyncio.get_event_loop().time(),
                    'ttl': 300  # 5 minutes
                }
            
            monitor.take_snapshot(f"after_{config['entries']}_entries")
            
            # Calculate cache size
            cache_size_mb = sum(
                len(str(k)) + len(str(v)) for k, v in cache.items()
            ) / (1024 * 1024)
            
            print(f"\nCache with {config['entries']} entries ({config['entry_size_kb']}KB each):")
            print(f"  Theoretical size: {config['entries'] * config['entry_size_kb'] / 1024:.2f} MB")
            print(f"  Actual size: {cache_size_mb:.2f} MB")
            
            # Test cache eviction (remove old entries)
            if len(cache) > 1000:
                # Keep only newest 1000
                sorted_keys = sorted(cache.keys(), 
                                   key=lambda k: cache[k]['timestamp'], 
                                   reverse=True)
                for key in sorted_keys[1000:]:
                    del cache[key]
                
                monitor.take_snapshot(f"after_eviction_{config['entries']}")
        
        # Clear cache
        cache.clear()
        gc.collect()
        monitor.take_snapshot("after_cache_clear")
        
        summary = monitor.get_summary()
        print(f"\nCache Memory Summary:")
        print(f"  Peak usage: {summary['peak_mb']:.2f} MB")
        print(f"  Final usage: {summary['final_mb']:.2f} MB")
        print(f"  Growth: {summary['growth_mb']:.2f} MB")
        
        # Memory should be released after cache clear
        assert summary['growth_mb'] < 50, "Cache memory not properly released"
    
    @pytest.mark.asyncio
    async def test_concurrent_session_memory(self, monitor):
        """Test memory usage with concurrent sessions"""
        monitor.take_snapshot("baseline")
        
        # Create multiple concurrent sessions
        sessions = {}
        
        async def create_session(session_id: str, size_kb: int):
            """Create and populate a session"""
            state = MockSessionState(size_kb=size_kb)
            
            # Simulate session activity
            for i in range(20):
                state.add_tool_call(f"tool_{i}", result_size_kb=2)
                await asyncio.sleep(0.001)  # Yield control
            
            sessions[session_id] = state
            return state
        
        # Test different concurrency levels
        for concurrent_count in [10, 50, 100]:
            sessions.clear()
            gc.collect()
            
            monitor.take_snapshot(f"before_{concurrent_count}_sessions")
            
            # Create sessions concurrently
            tasks = []
            for i in range(concurrent_count):
                session_id = f"session_{i}"
                size_kb = 50  # 50KB per session
                tasks.append(create_session(session_id, size_kb))
            
            await asyncio.gather(*tasks)
            
            monitor.take_snapshot(f"after_{concurrent_count}_sessions")
            
            # Calculate total session memory
            total_size_mb = sum(s.get_size_mb() for s in sessions.values())
            
            print(f"\n{concurrent_count} Concurrent Sessions:")
            print(f"  Total session data: {total_size_mb:.2f} MB")
            print(f"  Average per session: {total_size_mb/concurrent_count:.3f} MB")
            
            # Compact all sessions
            for session in sessions.values():
                session.compact()
            
            monitor.take_snapshot(f"after_compact_{concurrent_count}")
            
            compacted_size_mb = sum(s.get_size_mb() for s in sessions.values())
            print(f"  After compaction: {compacted_size_mb:.2f} MB")
            print(f"  Reduction: {(1 - compacted_size_mb/total_size_mb) * 100:.1f}%")
        
        # Clear all sessions
        sessions.clear()
        gc.collect()
        monitor.take_snapshot("final")
        
        summary = monitor.get_summary()
        
        # Memory should scale linearly with sessions
        # Allow 1MB overhead per 10 sessions
        max_expected_growth = 100 * 0.05 + 10  # 100 sessions * 50KB + 10MB overhead
        assert summary['growth_mb'] < max_expected_growth, \
            f"Excessive memory usage: {summary['growth_mb']:.2f} MB"
    
    @pytest.mark.asyncio
    async def test_memory_under_pressure(self, monitor):
        """Test behavior when memory is constrained"""
        monitor.take_snapshot("baseline")
        
        # Get current memory usage
        mem = psutil.virtual_memory()
        available_mb = mem.available / (1024 * 1024)
        
        print(f"\nMemory Pressure Test:")
        print(f"  Available memory: {available_mb:.2f} MB")
        
        # Try to allocate progressively more memory
        allocations = []
        allocation_size_mb = 10
        max_allocations = min(50, int(available_mb / allocation_size_mb / 2))  # Use up to 50% of available
        
        for i in range(max_allocations):
            try:
                # Allocate memory
                data = 'x' * (allocation_size_mb * 1024 * 1024)
                allocations.append(data)
                
                if i % 10 == 0:
                    monitor.take_snapshot(f"allocation_{i}")
                    mem = psutil.virtual_memory()
                    print(f"  After {i+1} allocations: {mem.percent:.1f}% memory used")
                
                # Check if we should stop
                if mem.percent > 80:
                    print(f"  Stopping at {mem.percent:.1f}% memory usage")
                    break
                    
            except MemoryError:
                print(f"  MemoryError after {i} allocations")
                break
        
        # Test compaction under pressure
        state = MockSessionState(size_kb=1000)  # 1MB state
        for i in range(100):
            state.add_tool_call(f"tool_{i}", result_size_kb=10)
        
        size_before = state.get_size_mb()
        state.compact()
        size_after = state.get_size_mb()
        
        print(f"  State compaction under pressure:")
        print(f"    Before: {size_before:.2f} MB")
        print(f"    After: {size_after:.2f} MB")
        
        # Clear allocations
        allocations.clear()
        del state
        gc.collect()
        
        monitor.take_snapshot("after_release")
        
        # Memory should be released
        mem = psutil.virtual_memory()
        print(f"  Final memory usage: {mem.percent:.1f}%")
        
        # Compaction should still work under pressure
        assert size_after < size_before * 0.5, "Compaction failed under memory pressure"
    
    @pytest.mark.asyncio
    async def test_tracemalloc_top_consumers(self, monitor):
        """Use tracemalloc to identify top memory consumers"""
        tracemalloc.start()
        
        # Create various objects
        sessions = []
        for i in range(20):
            state = MockSessionState(size_kb=100)
            for j in range(50):
                state.add_tool_call(f"tool_{j}", result_size_kb=5)
            sessions.append(state)
        
        apis = [MockResponsesAPI('normal') for _ in range(10)]
        tools = [MockToolResponses('success') for _ in range(10)]
        
        # Take snapshot
        snapshot = tracemalloc.take_snapshot()
        top_stats = snapshot.statistics('lineno')
        
        print(f"\nTop 10 Memory Consumers:")
        for stat in top_stats[:10]:
            print(f"  {stat.filename}:{stat.lineno}")
            print(f"    Size: {stat.size / 1024 / 1024:.2f} MB")
            print(f"    Count: {stat.count}")
        
        # Get total
        total = sum(stat.size for stat in top_stats)
        print(f"\nTotal allocated: {total / 1024 / 1024:.2f} MB")
        
        tracemalloc.stop()
        
        # Clear everything
        sessions.clear()
        apis.clear()
        tools.clear()
        gc.collect()


if __name__ == '__main__':
    pytest.main([__file__, '-v', '-s'])