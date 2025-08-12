"""
Performance tests for orchestrator latency
"""

import pytest
import asyncio
import time
from statistics import mean, stdev
from typing import List, Dict, Any
from unittest.mock import AsyncMock, MagicMock
import sys
import os

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))))

# Import mocks
from tests.mocks.mock_responses_api import MockResponsesAPI
from tests.mocks.mock_tool_responses import MockToolResponses
from tests.mocks.mock_budget_scenarios import BudgetUsageSimulator, MockBudgetScenarios


class LatencyMeasurer:
    """Utility class for measuring latencies"""
    
    def __init__(self):
        self.measurements = {
            'orchestrator_overhead': [],
            'tool_call': [],
            'model_switch': [],
            'state_compaction': [],
            'budget_check': []
        }
    
    async def measure_async(self, operation_name: str, operation):
        """Measure async operation latency"""
        start = time.perf_counter()
        result = await operation()
        latency = (time.perf_counter() - start) * 1000  # Convert to milliseconds
        self.measurements[operation_name].append(latency)
        return result
    
    def measure_sync(self, operation_name: str, operation):
        """Measure sync operation latency"""
        start = time.perf_counter()
        result = operation()
        latency = (time.perf_counter() - start) * 1000  # Convert to milliseconds
        self.measurements[operation_name].append(latency)
        return result
    
    def get_stats(self, operation_name: str) -> Dict[str, float]:
        """Get statistics for an operation"""
        values = self.measurements[operation_name]
        if not values:
            return {'mean': 0, 'stdev': 0, 'min': 0, 'max': 0, 'p95': 0, 'p99': 0}
        
        sorted_values = sorted(values)
        return {
            'mean': mean(values),
            'stdev': stdev(values) if len(values) > 1 else 0,
            'min': min(values),
            'max': max(values),
            'p95': sorted_values[int(len(values) * 0.95)] if len(values) > 1 else values[0],
            'p99': sorted_values[int(len(values) * 0.99)] if len(values) > 1 else values[0],
            'count': len(values)
        }


class MockOrchestrator:
    """Mock orchestrator for performance testing"""
    
    def __init__(self):
        self.api = MockResponsesAPI('normal')
        self.tools = MockToolResponses('success')
        self.budget = BudgetUsageSimulator(MockBudgetScenarios.standard())
        self.state = {'toolCalls': [], 'patterns': [], 'hypothesis': None}
        self.model = 'gpt-5'
    
    async def execute_tool(self, tool_name: str, params: Dict[str, Any]):
        """Execute a tool with latency simulation"""
        # Simulate network latency (5-50ms)
        await asyncio.sleep(0.005 + (0.045 * (hash(tool_name) % 10) / 10))
        return self.tools.get_response(tool_name, params)
    
    def check_budget(self, operation: str, cost: float = 0.01) -> bool:
        """Check budget with realistic computation"""
        result = self.budget.simulate_tool_call(operation, tokens=1000, cost=cost)
        return result['allowed']
    
    def compact_state(self) -> Dict[str, Any]:
        """Compact state for model switch"""
        # Simulate state compaction work
        compacted = {
            'toolCalls': self.state['toolCalls'][-10:],  # Keep last 10
            'patterns': self.state['patterns'][:3],  # Keep top 3
            'hypothesis': self.state['hypothesis']
        }
        # Simulate serialization overhead
        import json
        serialized = json.dumps(compacted)
        return json.loads(serialized)
    
    async def switch_model(self, from_model: str, to_model: str):
        """Switch models with state passing"""
        # Compact state
        compacted = self.compact_state()
        
        # Simulate API call to create new session
        await asyncio.sleep(0.01)  # 10ms API latency
        
        # Update model
        self.model = to_model
        
        # Return new session ID (mock)
        return f"session_{to_model}_{time.time()}"


class TestOrchestratorLatency:
    """Test orchestrator latency characteristics"""
    
    @pytest.fixture
    def measurer(self):
        """Create latency measurer"""
        return LatencyMeasurer()
    
    @pytest.fixture
    def orchestrator(self):
        """Create mock orchestrator"""
        return MockOrchestrator()
    
    @pytest.mark.asyncio
    async def test_orchestrator_overhead(self, measurer, orchestrator):
        """Test orchestrator overhead without tool calls"""
        # Measure pure orchestrator overhead
        for _ in range(100):
            async def orchestrator_step():
                # Simulate orchestrator decision logic
                orchestrator.check_budget('overhead_test')
                await asyncio.sleep(0.001)  # 1ms processing
                return True
            
            await measurer.measure_async('orchestrator_overhead', orchestrator_step)
        
        stats = measurer.get_stats('orchestrator_overhead')
        
        # Assert reasonable overhead
        assert stats['mean'] < 10  # Less than 10ms average
        assert stats['p95'] < 20   # 95th percentile under 20ms
        assert stats['p99'] < 30   # 99th percentile under 30ms
        
        print(f"\nOrchestrator Overhead Stats: {stats}")
    
    @pytest.mark.asyncio
    async def test_tool_call_latency(self, measurer, orchestrator):
        """Test individual tool call latencies"""
        tools = [
            'get_video_bundle',
            'search_titles',
            'perf_snapshot',
            'calculate_pattern_significance'
        ]
        
        # Measure each tool multiple times
        for tool in tools:
            for _ in range(50):
                async def tool_call():
                    return await orchestrator.execute_tool(tool, {'test': 'param'})
                
                await measurer.measure_async('tool_call', tool_call)
        
        stats = measurer.get_stats('tool_call')
        
        # Assert reasonable tool latencies
        assert stats['mean'] < 100  # Less than 100ms average
        assert stats['p95'] < 200   # 95th percentile under 200ms
        assert stats['p99'] < 300   # 99th percentile under 300ms
        
        print(f"\nTool Call Latency Stats: {stats}")
    
    @pytest.mark.asyncio
    async def test_model_switch_latency(self, measurer, orchestrator):
        """Test model switching latency"""
        switches = [
            ('gpt-5', 'gpt-5-mini'),
            ('gpt-5-mini', 'gpt-5-nano'),
            ('gpt-5-nano', 'gpt-5')
        ]
        
        # Measure model switches
        for from_model, to_model in switches * 20:  # 60 switches total
            async def switch():
                return await orchestrator.switch_model(from_model, to_model)
            
            await measurer.measure_async('model_switch', switch)
        
        stats = measurer.get_stats('model_switch')
        
        # Assert reasonable switch latencies
        assert stats['mean'] < 50   # Less than 50ms average
        assert stats['p95'] < 100   # 95th percentile under 100ms
        assert stats['p99'] < 150   # 99th percentile under 150ms
        
        print(f"\nModel Switch Latency Stats: {stats}")
    
    @pytest.mark.asyncio
    async def test_state_compaction_latency(self, measurer, orchestrator):
        """Test state compaction performance"""
        # Build up state
        for i in range(100):
            orchestrator.state['toolCalls'].append({
                'tool': f'tool_{i}',
                'params': {'data': f'data_{i}' * 100},  # Some data
                'result': {'output': f'result_{i}' * 100}
            })
        
        for i in range(20):
            orchestrator.state['patterns'].append({
                'pattern': f'pattern_{i}',
                'confidence': 0.5 + i * 0.02,
                'evidence': [f'evidence_{j}' for j in range(10)]
            })
        
        # Measure compaction
        for _ in range(100):
            measurer.measure_sync('state_compaction', orchestrator.compact_state)
        
        stats = measurer.get_stats('state_compaction')
        
        # Assert reasonable compaction times
        assert stats['mean'] < 5    # Less than 5ms average
        assert stats['p95'] < 10    # 95th percentile under 10ms
        assert stats['p99'] < 15    # 99th percentile under 15ms
        
        print(f"\nState Compaction Latency Stats: {stats}")
    
    @pytest.mark.asyncio
    async def test_budget_check_latency(self, measurer, orchestrator):
        """Test budget checking performance"""
        # Measure budget checks
        for i in range(1000):
            operation = f'operation_{i % 10}'
            measurer.measure_sync('budget_check', 
                                lambda: orchestrator.check_budget(operation))
        
        stats = measurer.get_stats('budget_check')
        
        # Assert very fast budget checks
        assert stats['mean'] < 1    # Less than 1ms average
        assert stats['p95'] < 2     # 95th percentile under 2ms
        assert stats['p99'] < 3     # 99th percentile under 3ms
        
        print(f"\nBudget Check Latency Stats: {stats}")
    
    @pytest.mark.asyncio
    async def test_parallel_tool_execution(self, measurer, orchestrator):
        """Test parallel tool execution performance"""
        # Test different parallelism levels
        for parallel_count in [1, 3, 5, 10]:
            start = time.perf_counter()
            
            # Execute tools in parallel
            tasks = []
            for i in range(parallel_count):
                tool = ['search_titles', 'search_summaries', 'search_thumbs'][i % 3]
                tasks.append(orchestrator.execute_tool(tool, {'query': f'test_{i}'}))
            
            results = await asyncio.gather(*tasks)
            
            elapsed = (time.perf_counter() - start) * 1000
            
            # Parallel execution should be faster than sequential
            # Roughly: parallel_time ≈ max(individual_times) + overhead
            print(f"\nParallel execution of {parallel_count} tools: {elapsed:.2f}ms")
            
            # Assert reasonable parallel performance
            assert elapsed < parallel_count * 100  # Should be much less than sequential
    
    @pytest.mark.asyncio
    async def test_end_to_end_latency(self, measurer, orchestrator):
        """Test complete analysis flow latency"""
        start = time.perf_counter()
        
        # Phase 1: Context gathering (3 tools)
        context_tools = ['get_video_bundle', 'get_channel_baseline', 'list_channel_history']
        context_tasks = [orchestrator.execute_tool(t, {'id': 'test'}) for t in context_tools]
        await asyncio.gather(*context_tasks)
        
        # Model switch
        await orchestrator.switch_model('gpt-5', 'gpt-5-mini')
        
        # Phase 2: Search (3 parallel)
        search_tools = ['search_titles', 'search_summaries', 'search_thumbs']
        search_tasks = [orchestrator.execute_tool(t, {'query': 'test'}) for t in search_tools]
        await asyncio.gather(*search_tasks)
        
        # Phase 3: Validation
        await orchestrator.execute_tool('perf_snapshot', {'video_ids': ['v1', 'v2']})
        
        # Model switch back
        await orchestrator.switch_model('gpt-5-mini', 'gpt-5')
        
        # Phase 4: Analysis
        await orchestrator.execute_tool('calculate_pattern_significance', {'pattern': {}})
        
        total_latency = (time.perf_counter() - start) * 1000
        
        print(f"\nEnd-to-end analysis latency: {total_latency:.2f}ms")
        
        # Assert reasonable total time
        assert total_latency < 1000  # Under 1 second for mock flow


if __name__ == '__main__':
    pytest.main([__file__, '-v', '-s'])