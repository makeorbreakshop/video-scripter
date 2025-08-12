"""
Integration tests for tool orchestration
"""

import pytest
from unittest.mock import Mock, AsyncMock, patch
import asyncio
from typing import List, Dict, Any
import sys
import os

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))))

from lib.orchestrator.tool_registry import ToolRegistryImpl
from lib.orchestrator.budget_tracker import BudgetTrackerImpl
from lib.orchestrator.session_manager import SessionManagerImpl
from types.orchestrator import (
    ToolDefinition,
    ToolCall,
    OrchestratorConfig,
    BudgetCaps
)


class TestToolOrchestration:
    """Test tool orchestration behaviors"""
    
    @pytest.fixture
    def registry(self):
        """Create tool registry with test tools"""
        registry = ToolRegistryImpl()
        
        # Register test tools
        registry.register({
            'name': 'tool_a',
            'description': 'Test tool A',
            'parameters': {'param1': 'string'},
            'handler': AsyncMock(return_value={'result': 'a'}),
            'category': 'test',
            'parallelSafe': True,
            'estimatedCost': 0.01,
            'estimatedTokens': 100
        })
        
        registry.register({
            'name': 'tool_b',
            'description': 'Test tool B',
            'parameters': {'param2': 'number'},
            'handler': AsyncMock(return_value={'result': 'b'}),
            'category': 'test',
            'parallelSafe': True,
            'estimatedCost': 0.02,
            'estimatedTokens': 200
        })
        
        registry.register({
            'name': 'tool_c',
            'description': 'Test tool C - depends on A',
            'parameters': {'param3': 'boolean'},
            'handler': AsyncMock(return_value={'result': 'c'}),
            'category': 'test',
            'parallelSafe': False,  # Not parallel safe
            'estimatedCost': 0.03,
            'estimatedTokens': 300
        })
        
        return registry
    
    @pytest.fixture
    def budget_tracker(self):
        """Create budget tracker"""
        return BudgetTrackerImpl()
    
    @pytest.fixture
    def session_manager(self):
        """Create session manager"""
        return SessionManagerImpl()
    
    @pytest.mark.asyncio
    async def test_sequential_tool_execution(self, registry, budget_tracker):
        """Test sequential execution of tools"""
        # Execute tools in sequence
        tool_a = registry.get('tool_a')
        tool_b = registry.get('tool_b')
        tool_c = registry.get('tool_c')
        
        results = []
        
        # Execute tool A
        if budget_tracker.canExecute('tool_a', 100):
            result_a = await tool_a['handler']({'param1': 'test'})
            results.append(result_a)
            budget_tracker.recordToolCall('tool_a', 100, 0.01)
        
        # Execute tool B
        if budget_tracker.canExecute('tool_b', 200):
            result_b = await tool_b['handler']({'param2': 42})
            results.append(result_b)
            budget_tracker.recordToolCall('tool_b', 200, 0.02)
        
        # Execute tool C (depends on A)
        if budget_tracker.canExecute('tool_c', 300):
            result_c = await tool_c['handler']({
                'param3': True,
                'input_from_a': results[0]['result']
            })
            results.append(result_c)
            budget_tracker.recordToolCall('tool_c', 300, 0.03)
        
        # Verify all tools executed
        assert len(results) == 3
        assert results[0]['result'] == 'a'
        assert results[1]['result'] == 'b'
        assert results[2]['result'] == 'c'
        
        # Verify budget tracking
        usage = budget_tracker.getUsage()
        assert usage.toolCalls == 3
        assert usage.tokens == 600
        assert usage.costs.total == 0.06
    
    @pytest.mark.asyncio
    async def test_parallel_tool_execution(self, registry, budget_tracker):
        """Test parallel execution of safe tools"""
        # Get parallel-safe tools
        tool_a = registry.get('tool_a')
        tool_b = registry.get('tool_b')
        
        # Check budget for both
        can_execute_a = budget_tracker.canExecute('tool_a', 100)
        can_execute_b = budget_tracker.canExecute('tool_b', 200)
        
        assert can_execute_a and can_execute_b
        
        # Execute in parallel
        results = await asyncio.gather(
            tool_a['handler']({'param1': 'test'}),
            tool_b['handler']({'param2': 42})
        )
        
        # Record usage
        budget_tracker.recordToolCall('tool_a', 100, 0.01)
        budget_tracker.recordToolCall('tool_b', 200, 0.02)
        
        # Verify results
        assert len(results) == 2
        assert results[0]['result'] == 'a'
        assert results[1]['result'] == 'b'
        
        # Verify parallel-safe tools identified correctly
        parallel_safe = registry.getParallelSafe()
        assert len(parallel_safe) == 2
        assert all(tool['name'] in ['tool_a', 'tool_b'] for tool in parallel_safe)
    
    @pytest.mark.asyncio
    async def test_tool_dependency_resolution(self, registry, budget_tracker):
        """Test handling of tool dependencies"""
        # Tool C depends on Tool A
        tool_a = registry.get('tool_a')
        tool_c = registry.get('tool_c')
        
        # Execute tool A first
        result_a = await tool_a['handler']({'param1': 'test'})
        budget_tracker.recordToolCall('tool_a', 100, 0.01)
        
        # Use result from A in tool C
        result_c = await tool_c['handler']({
            'param3': True,
            'dependency': result_a['result']
        })
        budget_tracker.recordToolCall('tool_c', 300, 0.03)
        
        # Verify dependency chain
        assert result_c is not None
        assert tool_a['handler'].called
        assert tool_c['handler'].called
        
        # Verify C was called with A's result
        call_args = tool_c['handler'].call_args[0][0]
        assert 'dependency' in call_args
        assert call_args['dependency'] == 'a'
    
    @pytest.mark.asyncio
    async def test_budget_enforcement_during_orchestration(self, registry, budget_tracker):
        """Test that budget limits are enforced during orchestration"""
        # Set tight budget
        budget_tracker.initialize({
            'maxFanouts': 1,
            'maxValidations': 1,
            'maxCandidates': 10,
            'maxTokens': 250,  # Only enough for tools A and B
            'maxDurationMs': 60000,
            'maxToolCalls': 2  # Only 2 calls allowed
        })
        
        results = []
        tools_executed = []
        
        # Try to execute 3 tools
        for tool_name in ['tool_a', 'tool_b', 'tool_c']:
            tool = registry.get(tool_name)
            if budget_tracker.canExecute(tool_name, tool['estimatedTokens']):
                result = await tool['handler']({})
                results.append(result)
                tools_executed.append(tool_name)
                budget_tracker.recordToolCall(
                    tool_name,
                    tool['estimatedTokens'],
                    tool['estimatedCost']
                )
        
        # Only first 2 should execute due to budget
        assert len(results) == 2
        assert len(tools_executed) == 2
        assert 'tool_a' in tools_executed
        assert 'tool_b' in tools_executed
        assert 'tool_c' not in tools_executed
        
        # Verify budget exceeded
        assert budget_tracker.isExceeded()
    
    @pytest.mark.asyncio
    async def test_error_handling_in_orchestration(self, registry, budget_tracker):
        """Test error handling during tool orchestration"""
        # Register a failing tool
        failing_tool = {
            'name': 'tool_fail',
            'description': 'Tool that fails',
            'parameters': {},
            'handler': AsyncMock(side_effect=Exception("Tool failure")),
            'category': 'test',
            'parallelSafe': True,
            'estimatedCost': 0.01,
            'estimatedTokens': 100
        }
        registry.register(failing_tool)
        
        # Try to execute failing tool
        tool = registry.get('tool_fail')
        
        with pytest.raises(Exception) as exc_info:
            await tool['handler']({})
        
        assert str(exc_info.value) == "Tool failure"
        
        # Other tools should still be executable
        tool_a = registry.get('tool_a')
        result_a = await tool_a['handler']({'param1': 'test'})
        assert result_a['result'] == 'a'
    
    @pytest.mark.asyncio
    async def test_caching_prevents_duplicate_calls(self, registry, session_manager):
        """Test that caching prevents duplicate tool calls"""
        # Create session with caching enabled
        session_id = session_manager.createSession('test-video', {
            'budgetCaps': {
                'maxFanouts': 2,
                'maxValidations': 10,
                'maxCandidates': 120,
                'maxTokens': 100000,
                'maxDurationMs': 60000,
                'maxToolCalls': 50
            }
        })
        
        # Mock tool with caching
        cached_tool = {
            'name': 'cached_tool',
            'description': 'Tool with caching',
            'parameters': {'key': 'string'},
            'handler': AsyncMock(return_value={'data': 'cached'}),
            'category': 'test',
            'parallelSafe': True,
            'estimatedCost': 0.01,
            'estimatedTokens': 100,
            'cacheable': True,
            'cacheKey': lambda params: f"cache_{params.get('key')}"
        }
        registry.register(cached_tool)
        
        tool = registry.get('cached_tool')
        
        # First call
        result1 = await tool['handler']({'key': 'test'})
        session_manager.recordToolCall(session_id, {
            'id': 'call1',
            'toolName': 'cached_tool',
            'params': {'key': 'test'},
            'status': 'success',
            'startTime': None,
            'endTime': None,
            'result': result1,
            'error': None
        })
        
        # Second call with same params (should be cached)
        state = session_manager.getState(session_id)
        cached_result = next(
            (tc['result'] for tc in state.toolCalls 
             if tc['toolName'] == 'cached_tool' and tc['params'].get('key') == 'test'),
            None
        )
        
        # Should find cached result
        assert cached_result is not None
        assert cached_result['data'] == 'cached'
        
        # Handler should only be called once
        assert tool['handler'].call_count == 1
    
    @pytest.mark.asyncio
    async def test_state_tracking_across_tools(self, registry, session_manager):
        """Test that state is properly tracked across tool calls"""
        # Create session
        session_id = session_manager.createSession('test-video', {
            'budgetCaps': {
                'maxFanouts': 2,
                'maxValidations': 10,
                'maxCandidates': 120,
                'maxTokens': 100000,
                'maxDurationMs': 60000,
                'maxToolCalls': 50
            }
        })
        
        # Execute multiple tools and track state
        tool_a = registry.get('tool_a')
        tool_b = registry.get('tool_b')
        
        # Execute tool A
        result_a = await tool_a['handler']({'param1': 'test'})
        session_manager.recordToolCall(session_id, {
            'id': 'call_a',
            'toolName': 'tool_a',
            'params': {'param1': 'test'},
            'status': 'success',
            'startTime': None,
            'endTime': None,
            'result': result_a,
            'error': None
        })
        
        # Update hypothesis based on tool A
        session_manager.updateHypothesis(session_id, {
            'statement': 'Test hypothesis from tool A',
            'confidence': 0.7,
            'supportingEvidence': [result_a['result']]
        })
        
        # Execute tool B
        result_b = await tool_b['handler']({'param2': 42})
        session_manager.recordToolCall(session_id, {
            'id': 'call_b',
            'toolName': 'tool_b',
            'params': {'param2': 42},
            'status': 'success',
            'startTime': None,
            'endTime': None,
            'result': result_b,
            'error': None
        })
        
        # Get final state
        state = session_manager.getState(session_id)
        
        # Verify state tracking
        assert len(state.toolCalls) == 2
        assert state.hypothesis is not None
        assert state.hypothesis['confidence'] == 0.7
        assert 'a' in state.hypothesis['supportingEvidence']
        
        # Verify tool call history
        tool_names = [tc['toolName'] for tc in state.toolCalls]
        assert 'tool_a' in tool_names
        assert 'tool_b' in tool_names


if __name__ == '__main__':
    pytest.main([__file__, '-v'])