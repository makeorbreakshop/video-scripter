"""
Performance tests for concurrent session handling
"""

import pytest
import asyncio
import time
import random
from typing import List, Dict, Any
from dataclasses import dataclass
from collections import defaultdict
from statistics import mean, stdev
import sys
import os

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))))

# Import mocks
from tests.mocks.mock_responses_api import MockResponsesAPI
from tests.mocks.mock_tool_responses import MockToolResponses
from tests.mocks.mock_budget_scenarios import BudgetUsageSimulator, MockBudgetScenarios


@dataclass
class SessionMetrics:
    """Metrics for a single session"""
    session_id: str
    start_time: float
    end_time: float = 0
    tool_calls: int = 0
    errors: int = 0
    model_switches: int = 0
    completed: bool = False
    
    @property
    def duration(self) -> float:
        """Get session duration in milliseconds"""
        if self.end_time:
            return (self.end_time - self.start_time) * 1000
        return 0
    
    @property
    def throughput(self) -> float:
        """Get tool calls per second"""
        if self.duration > 0:
            return self.tool_calls / (self.duration / 1000)
        return 0


class ConcurrentSessionManager:
    """Manage concurrent analysis sessions"""
    
    def __init__(self, max_sessions: int = 100):
        self.max_sessions = max_sessions
        self.active_sessions = {}
        self.completed_sessions = []
        self.api = MockResponsesAPI('normal')
        self.tools = MockToolResponses('success')
        self.lock = asyncio.Lock()
        self.semaphore = asyncio.Semaphore(max_sessions)
        
        # Resource tracking
        self.resource_usage = defaultdict(int)
        self.resource_contention = defaultdict(list)
    
    async def run_session(self, session_id: str, complexity: str = 'medium'):
        """Run a single analysis session"""
        async with self.semaphore:
            metrics = SessionMetrics(
                session_id=session_id,
                start_time=time.perf_counter()
            )
            
            async with self.lock:
                self.active_sessions[session_id] = metrics
            
            try:
                # Determine workload based on complexity
                if complexity == 'light':
                    tool_count = random.randint(3, 5)
                    model_switches = 1
                elif complexity == 'heavy':
                    tool_count = random.randint(15, 20)
                    model_switches = 3
                else:  # medium
                    tool_count = random.randint(8, 12)
                    model_switches = 2
                
                # Execute tools with realistic patterns
                for i in range(tool_count):
                    # Check resource contention
                    resource = f"tool_{i % 5}"
                    async with self.lock:
                        self.resource_usage[resource] += 1
                        if self.resource_usage[resource] > 5:
                            self.resource_contention[resource].append(time.perf_counter())
                    
                    # Simulate tool execution
                    await asyncio.sleep(random.uniform(0.01, 0.05))  # 10-50ms per tool
                    metrics.tool_calls += 1
                    
                    # Simulate model switch
                    if i > 0 and i % (tool_count // (model_switches + 1)) == 0:
                        await asyncio.sleep(0.02)  # 20ms for model switch
                        metrics.model_switches += 1
                    
                    # Simulate occasional errors (5% chance)
                    if random.random() < 0.05:
                        metrics.errors += 1
                    
                    async with self.lock:
                        self.resource_usage[resource] -= 1
                
                metrics.completed = True
                
            except Exception as e:
                metrics.errors += 1
                print(f"Session {session_id} failed: {e}")
            
            finally:
                metrics.end_time = time.perf_counter()
                async with self.lock:
                    del self.active_sessions[session_id]
                    self.completed_sessions.append(metrics)
            
            return metrics
    
    async def run_concurrent_sessions(self, count: int, complexity_mix: Dict[str, float] = None):
        """Run multiple sessions concurrently"""
        if complexity_mix is None:
            complexity_mix = {'light': 0.3, 'medium': 0.5, 'heavy': 0.2}
        
        tasks = []
        for i in range(count):
            # Determine complexity based on mix
            rand = random.random()
            if rand < complexity_mix['light']:
                complexity = 'light'
            elif rand < complexity_mix['light'] + complexity_mix['medium']:
                complexity = 'medium'
            else:
                complexity = 'heavy'
            
            session_id = f"session_{i}"
            tasks.append(self.run_session(session_id, complexity))
        
        # Add slight stagger to start times (more realistic)
        staggered_tasks = []
        for i, task in enumerate(tasks):
            async def staggered_start(t, delay):
                await asyncio.sleep(delay)
                return await t
            
            delay = i * 0.001  # 1ms stagger between starts
            staggered_tasks.append(staggered_start(task, delay))
        
        return await asyncio.gather(*staggered_tasks, return_exceptions=True)
    
    def get_metrics_summary(self) -> Dict[str, Any]:
        """Get summary of all session metrics"""
        if not self.completed_sessions:
            return {}
        
        durations = [s.duration for s in self.completed_sessions]
        throughputs = [s.throughput for s in self.completed_sessions if s.throughput > 0]
        error_rates = [s.errors / max(s.tool_calls, 1) for s in self.completed_sessions]
        
        return {
            'total_sessions': len(self.completed_sessions),
            'successful_sessions': sum(1 for s in self.completed_sessions if s.completed),
            'duration': {
                'mean': mean(durations),
                'stdev': stdev(durations) if len(durations) > 1 else 0,
                'min': min(durations),
                'max': max(durations)
            },
            'throughput': {
                'mean': mean(throughputs) if throughputs else 0,
                'stdev': stdev(throughputs) if len(throughputs) > 1 else 0,
                'min': min(throughputs) if throughputs else 0,
                'max': max(throughputs) if throughputs else 0
            },
            'error_rate': {
                'mean': mean(error_rates),
                'max': max(error_rates)
            },
            'resource_contention': {
                resource: len(contentions)
                for resource, contentions in self.resource_contention.items()
            }
        }


class TestConcurrentSessions:
    """Test concurrent session performance"""
    
    @pytest.mark.asyncio
    async def test_10_concurrent_users(self):
        """Test with 10 concurrent users"""
        manager = ConcurrentSessionManager(max_sessions=10)
        
        start = time.perf_counter()
        results = await manager.run_concurrent_sessions(10)
        elapsed = (time.perf_counter() - start) * 1000
        
        metrics = manager.get_metrics_summary()
        
        # Assert all sessions completed
        assert metrics['total_sessions'] == 10
        assert metrics['successful_sessions'] >= 9  # Allow 1 failure
        
        # Assert reasonable performance
        assert metrics['duration']['mean'] < 1000  # Average under 1 second
        assert metrics['throughput']['mean'] > 50  # At least 50 ops/sec
        assert metrics['error_rate']['mean'] < 0.1  # Less than 10% errors
        
        print(f"\n10 Concurrent Users:")
        print(f"  Total time: {elapsed:.2f}ms")
        print(f"  Average duration: {metrics['duration']['mean']:.2f}ms")
        print(f"  Average throughput: {metrics['throughput']['mean']:.2f} ops/sec")
        print(f"  Error rate: {metrics['error_rate']['mean']:.2%}")
    
    @pytest.mark.asyncio
    async def test_50_concurrent_users(self):
        """Test with 50 concurrent users"""
        manager = ConcurrentSessionManager(max_sessions=50)
        
        start = time.perf_counter()
        results = await manager.run_concurrent_sessions(50)
        elapsed = (time.perf_counter() - start) * 1000
        
        metrics = manager.get_metrics_summary()
        
        # Assert most sessions completed
        assert metrics['total_sessions'] == 50
        assert metrics['successful_sessions'] >= 45  # Allow 10% failure
        
        # Assert reasonable performance degradation
        assert metrics['duration']['mean'] < 2000  # Average under 2 seconds
        assert metrics['throughput']['mean'] > 25   # At least 25 ops/sec
        assert metrics['error_rate']['mean'] < 0.15  # Less than 15% errors
        
        print(f"\n50 Concurrent Users:")
        print(f"  Total time: {elapsed:.2f}ms")
        print(f"  Average duration: {metrics['duration']['mean']:.2f}ms")
        print(f"  Average throughput: {metrics['throughput']['mean']:.2f} ops/sec")
        print(f"  Error rate: {metrics['error_rate']['mean']:.2%}")
        print(f"  Resource contention: {metrics['resource_contention']}")
    
    @pytest.mark.asyncio
    async def test_resource_contention(self):
        """Test resource contention under load"""
        manager = ConcurrentSessionManager(max_sessions=20)
        
        # Run with heavy workload to induce contention
        results = await manager.run_concurrent_sessions(
            20, 
            complexity_mix={'light': 0.1, 'medium': 0.3, 'heavy': 0.6}
        )
        
        metrics = manager.get_metrics_summary()
        
        # Check for resource contention
        total_contention = sum(metrics['resource_contention'].values())
        
        print(f"\nResource Contention Test:")
        print(f"  Total contention events: {total_contention}")
        print(f"  Contention by resource: {metrics['resource_contention']}")
        
        # Some contention is expected under heavy load
        assert total_contention > 0  # Should see some contention
        assert total_contention < 100  # But not excessive
    
    @pytest.mark.asyncio
    async def test_mixed_workload_performance(self):
        """Test performance with mixed workload types"""
        manager = ConcurrentSessionManager(max_sessions=30)
        
        # Test different workload mixes
        workload_mixes = [
            {'light': 0.8, 'medium': 0.15, 'heavy': 0.05},  # Mostly light
            {'light': 0.2, 'medium': 0.6, 'heavy': 0.2},    # Balanced
            {'light': 0.05, 'medium': 0.15, 'heavy': 0.8}   # Mostly heavy
        ]
        
        for i, mix in enumerate(workload_mixes):
            manager.completed_sessions.clear()
            
            start = time.perf_counter()
            results = await manager.run_concurrent_sessions(30, mix)
            elapsed = (time.perf_counter() - start) * 1000
            
            metrics = manager.get_metrics_summary()
            
            print(f"\nWorkload Mix {i+1} (L:{mix['light']}, M:{mix['medium']}, H:{mix['heavy']}):")
            print(f"  Total time: {elapsed:.2f}ms")
            print(f"  Average duration: {metrics['duration']['mean']:.2f}ms")
            print(f"  Duration stdev: {metrics['duration']['stdev']:.2f}ms")
            print(f"  Throughput: {metrics['throughput']['mean']:.2f} ops/sec")
            
            # Heavy workloads should take longer
            if mix['heavy'] > 0.5:
                assert metrics['duration']['mean'] > 500
            elif mix['light'] > 0.5:
                assert metrics['duration']['mean'] < 500
    
    @pytest.mark.asyncio
    async def test_burst_traffic(self):
        """Test handling of burst traffic"""
        manager = ConcurrentSessionManager(max_sessions=100)
        
        # Simulate burst: many requests at once
        burst_size = 100
        
        start = time.perf_counter()
        
        # First burst
        results1 = await manager.run_concurrent_sessions(burst_size)
        
        # Brief pause
        await asyncio.sleep(0.1)
        
        # Second burst (while system might still be recovering)
        manager.completed_sessions.clear()
        results2 = await manager.run_concurrent_sessions(burst_size)
        
        elapsed = (time.perf_counter() - start) * 1000
        
        metrics = manager.get_metrics_summary()
        
        print(f"\nBurst Traffic Test (2x{burst_size} requests):")
        print(f"  Total time: {elapsed:.2f}ms")
        print(f"  Second burst performance:")
        print(f"    Average duration: {metrics['duration']['mean']:.2f}ms")
        print(f"    Success rate: {metrics['successful_sessions']/burst_size:.2%}")
        
        # System should handle bursts gracefully
        assert metrics['successful_sessions'] >= burst_size * 0.9  # 90% success
        assert elapsed < burst_size * 100  # Should complete in reasonable time
    
    @pytest.mark.asyncio
    async def test_gradual_load_increase(self):
        """Test system behavior under gradually increasing load"""
        manager = ConcurrentSessionManager(max_sessions=50)
        
        load_levels = [5, 10, 20, 30, 40, 50]
        performance_by_load = []
        
        for load in load_levels:
            manager.completed_sessions.clear()
            
            start = time.perf_counter()
            results = await manager.run_concurrent_sessions(load)
            elapsed = (time.perf_counter() - start) * 1000
            
            metrics = manager.get_metrics_summary()
            
            performance_by_load.append({
                'load': load,
                'elapsed': elapsed,
                'avg_duration': metrics['duration']['mean'],
                'throughput': metrics['throughput']['mean'],
                'error_rate': metrics['error_rate']['mean']
            })
            
            print(f"\nLoad level {load}:")
            print(f"  Total time: {elapsed:.2f}ms")
            print(f"  Avg duration: {metrics['duration']['mean']:.2f}ms")
            print(f"  Throughput: {metrics['throughput']['mean']:.2f} ops/sec")
        
        # Performance should degrade gracefully
        for i in range(1, len(performance_by_load)):
            prev = performance_by_load[i-1]
            curr = performance_by_load[i]
            
            # Duration should increase somewhat with load
            degradation = (curr['avg_duration'] - prev['avg_duration']) / prev['avg_duration']
            assert degradation < 0.5  # Less than 50% degradation per step
    
    @pytest.mark.asyncio
    async def test_long_running_sessions(self):
        """Test mix of short and long-running sessions"""
        
        class LongSessionManager(ConcurrentSessionManager):
            async def run_session(self, session_id: str, complexity: str = 'medium'):
                """Override to support long-running sessions"""
                if 'long' in session_id:
                    # Long session: many tools, slow processing
                    complexity = 'heavy'
                    await asyncio.sleep(random.uniform(0.5, 1.0))  # 500-1000ms
                
                return await super().run_session(session_id, complexity)
        
        manager = LongSessionManager(max_sessions=20)
        
        # Mix of short and long sessions
        tasks = []
        for i in range(20):
            if i % 5 == 0:
                session_id = f"long_session_{i}"
            else:
                session_id = f"session_{i}"
            tasks.append(manager.run_session(session_id))
        
        start = time.perf_counter()
        results = await asyncio.gather(*tasks, return_exceptions=True)
        elapsed = (time.perf_counter() - start) * 1000
        
        # Separate metrics for long and short sessions
        long_sessions = [s for s in manager.completed_sessions if 'long' in s.session_id]
        short_sessions = [s for s in manager.completed_sessions if 'long' not in s.session_id]
        
        print(f"\nMixed Session Duration Test:")
        print(f"  Total time: {elapsed:.2f}ms")
        print(f"  Long sessions: {len(long_sessions)}")
        print(f"  Short sessions: {len(short_sessions)}")
        
        if long_sessions:
            long_avg = mean([s.duration for s in long_sessions])
            print(f"  Long session avg: {long_avg:.2f}ms")
            assert long_avg > 500  # Long sessions should be long
        
        if short_sessions:
            short_avg = mean([s.duration for s in short_sessions])
            print(f"  Short session avg: {short_avg:.2f}ms")
            assert short_avg < 500  # Short sessions should be short


if __name__ == '__main__':
    pytest.main([__file__, '-v', '-s'])