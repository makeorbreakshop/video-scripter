"""
Integration tests for fallback behavior from agentic to classic mode
"""

import pytest
from unittest.mock import Mock, AsyncMock, patch
import asyncio
from datetime import datetime, timedelta
import sys
import os

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))))

from lib.orchestrator.mode_selector import ModeSelector
from lib.orchestrator.session_manager import SessionManagerImpl
from lib.orchestrator.budget_tracker import BudgetTrackerImpl
from types.orchestrator import AnalysisMode


class TestFallbackBehavior:
    """Test fallback from agentic to classic mode"""
    
    @pytest.fixture
    def mode_selector(self):
        """Create mode selector"""
        return ModeSelector()
    
    @pytest.fixture
    def session_manager(self):
        """Create session manager"""
        return SessionManagerImpl()
    
    @pytest.fixture
    def budget_tracker(self):
        """Create budget tracker"""
        return BudgetTrackerImpl()
    
    @pytest.mark.asyncio
    async def test_agentic_failure_triggers_classic(self, mode_selector, session_manager):
        """Test that agentic failures trigger classic fallback"""
        # Create agentic session
        session_id = session_manager.createSession('test-video', {
            'budgetCaps': {
                'maxFanouts': 2,
                'maxValidations': 10,
                'maxCandidates': 120,
                'maxTokens': 100000,
                'maxDurationMs': 60000,
                'maxToolCalls': 50
            },
            'mode': 'agentic'
        })
        
        # Simulate multiple errors in agentic mode
        for i in range(3):
            session_manager.recordError(session_id, {
                'timestamp': datetime.now(),
                'error': f'Tool execution failed {i}',
                'context': 'agentic_analysis',
                'recoverable': False
            })
        
        # Check if fallback should trigger
        state = session_manager.getState(session_id)
        should_fallback = mode_selector.shouldFallback(
            'agentic',
            elapsedMs=10000,
            tokensUsed=50000,
            errors=len(state.errors)
        )
        
        assert should_fallback is True
        
        # Record fallback
        mode_selector.recordSelection(
            {
                'videoHasHighTPS': True,
                'channelHasPatterns': True,
                'hasCompetitiveData': True,
                'hasSemanticClusters': True,
                'previousFailures': 3,
                'quotaAvailable': True
            },
            'agentic',
            'fallback'
        )
        
        # Verify fallback recorded
        stats = mode_selector.getPerformanceStats()
        recent = stats.recentSelections[-1]
        assert recent.result == 'fallback'
    
    @pytest.mark.asyncio
    async def test_partial_failure_recovery(self, session_manager, mode_selector):
        """Test recovery from partial failures"""
        # Create session
        session_id = session_manager.createSession('test-video', {
            'budgetCaps': {
                'maxFanouts': 2,
                'maxValidations': 10,
                'maxCandidates': 120,
                'maxTokens': 100000,
                'maxDurationMs': 60000,
                'maxToolCalls': 50
            },
            'mode': 'agentic'
        })
        
        # Partial success - some tools worked
        session_manager.recordToolCall(session_id, {
            'id': 'call_1',
            'toolName': 'get_video_bundle',
            'params': {'video_id': 'test'},
            'status': 'success',
            'startTime': datetime.now(),
            'endTime': datetime.now(),
            'result': {'title': 'Test Video'},
            'error': None
        })
        
        session_manager.recordToolCall(session_id, {
            'id': 'call_2',
            'toolName': 'search_titles',
            'params': {'query': 'test'},
            'status': 'error',
            'startTime': datetime.now(),
            'endTime': datetime.now(),
            'result': None,
            'error': 'Search failed'
        })
        
        # Add hypothesis before failure
        session_manager.updateHypothesis(session_id, {
            'statement': 'Partial hypothesis',
            'confidence': 0.5,
            'supportingEvidence': ['partial']
        })
        
        # Check if partial data can be recovered
        state = session_manager.getState(session_id)
        
        # Should have both successful and failed calls
        assert len(state.toolCalls) == 2
        successful = [tc for tc in state.toolCalls if tc['status'] == 'success']
        failed = [tc for tc in state.toolCalls if tc['status'] == 'error']
        
        assert len(successful) == 1
        assert len(failed) == 1
        
        # Hypothesis should be preserved
        assert state.hypothesis is not None
        assert state.hypothesis['statement'] == 'Partial hypothesis'
        
        # Decide on fallback
        should_fallback = mode_selector.shouldFallback(
            'agentic',
            elapsedMs=5000,
            tokensUsed=10000,
            errors=1
        )
        
        # One error shouldn't trigger fallback yet
        assert should_fallback is False
    
    @pytest.mark.asyncio
    async def test_timeout_fallback(self, mode_selector, session_manager):
        """Test fallback triggered by timeout"""
        # Create session
        session_id = session_manager.createSession('test-video', {
            'budgetCaps': {
                'maxFanouts': 2,
                'maxValidations': 10,
                'maxCandidates': 120,
                'maxTokens': 100000,
                'maxDurationMs': 60000,  # 60 second timeout
                'maxToolCalls': 50
            },
            'mode': 'agentic'
        })
        
        # Simulate long-running analysis
        start_time = datetime.now() - timedelta(seconds=65)  # Started 65 seconds ago
        session_manager.sessions[session_id]['startTime'] = start_time
        
        # Check if timeout should trigger fallback
        elapsed_ms = (datetime.now() - start_time).total_seconds() * 1000
        should_fallback = mode_selector.shouldFallback(
            'agentic',
            elapsedMs=elapsed_ms,
            tokensUsed=50000,
            errors=0
        )
        
        assert should_fallback is True
        assert elapsed_ms > 60000  # Exceeded timeout
    
    @pytest.mark.asyncio
    async def test_budget_exceeded_fallback(self, mode_selector, budget_tracker):
        """Test fallback when budget is exceeded"""
        # Use up most of the budget
        for i in range(45):  # 45 tool calls (near 50 limit)
            budget_tracker.recordToolCall(f'tool_{i}', 2000, 0.02)
        
        # Check if budget constraint should trigger fallback
        usage = budget_tracker.getUsage()
        should_fallback = mode_selector.shouldFallback(
            'agentic',
            elapsedMs=30000,
            tokensUsed=usage.tokens,
            errors=0
        )
        
        # High token usage should trigger fallback
        assert usage.tokens >= 80000
        assert should_fallback is True
    
    @pytest.mark.asyncio
    async def test_classic_mode_no_fallback(self, mode_selector):
        """Test that classic mode doesn't fallback"""
        # Classic mode should never fallback
        should_fallback = mode_selector.shouldFallback(
            'classic',
            elapsedMs=100000,  # Even with high time
            tokensUsed=90000,  # High tokens
            errors=5  # Multiple errors
        )
        
        assert should_fallback is False
    
    @pytest.mark.asyncio
    async def test_fallback_with_state_preservation(self, session_manager, mode_selector):
        """Test that state is preserved during fallback"""
        # Create agentic session with data
        session_id = session_manager.createSession('test-video', {
            'budgetCaps': {
                'maxFanouts': 2,
                'maxValidations': 10,
                'maxCandidates': 120,
                'maxTokens': 100000,
                'maxDurationMs': 60000,
                'maxToolCalls': 50
            },
            'mode': 'agentic'
        })
        
        # Add accumulated data
        session_manager.updateVideoContext(session_id, {
            'title': 'Test Video',
            'tps': 3.5,
            'channelName': 'Test Channel',
            'formatType': 'tutorial',
            'topicNiche': 'tech'
        })
        
        session_manager.updateHypothesis(session_id, {
            'statement': 'Agentic hypothesis',
            'confidence': 0.6,
            'supportingEvidence': ['evidence1']
        })
        
        session_manager.updateSearchResults(session_id, {
            'semanticNeighbors': ['video1', 'video2'],
            'competitiveSuccesses': ['video3'],
            'totalCandidates': 20
        })
        
        # Trigger errors for fallback
        for i in range(3):
            session_manager.recordError(session_id, {
                'timestamp': datetime.now(),
                'error': f'Error {i}',
                'context': 'validation',
                'recoverable': False
            })
        
        # Get state before fallback
        state_before = session_manager.getState(session_id)
        
        # Simulate fallback to classic
        fallback_session_id = session_manager.createSession('test-video', {
            'budgetCaps': {
                'maxFanouts': 2,
                'maxValidations': 10,
                'maxCandidates': 120,
                'maxTokens': 100000,
                'maxDurationMs': 60000,
                'maxToolCalls': 50
            },
            'mode': 'classic',
            'fallbackFrom': session_id
        })
        
        # Copy state to fallback session
        session_manager.sessions[fallback_session_id]['state'] = state_before.__dict__.copy() if hasattr(state_before, '__dict__') else {}
        session_manager.sessions[fallback_session_id]['state']['mode'] = 'classic'
        
        # Verify state preserved in fallback
        fallback_state = session_manager.getState(fallback_session_id)
        
        assert fallback_state.videoContext is not None
        assert fallback_state.videoContext['title'] == 'Test Video'
        assert fallback_state.hypothesis is not None
        assert fallback_state.hypothesis['statement'] == 'Agentic hypothesis'
        assert fallback_state.searchResults is not None
        assert len(fallback_state.searchResults['semanticNeighbors']) == 2
    
    @pytest.mark.asyncio
    async def test_fallback_performance_tracking(self, mode_selector):
        """Test that fallback performance is tracked"""
        # Record initial agentic attempt
        mode_selector.updatePerformance(
            'agentic',
            success=False,
            durationMs=45000,
            cost=0.40,
            patternQuality=0.3
        )
        
        # Record fallback to classic
        mode_selector.recordSelection(
            {
                'videoHasHighTPS': True,
                'channelHasPatterns': True,
                'hasCompetitiveData': True,
                'hasSemanticClusters': True,
                'previousFailures': 2,
                'quotaAvailable': True
            },
            'agentic',
            'fallback'
        )
        
        # Record classic success after fallback
        mode_selector.updatePerformance(
            'classic',
            success=True,
            durationMs=5000,
            cost=0.10,
            patternQuality=0.7
        )
        
        # Check performance stats
        stats = mode_selector.getPerformanceStats()
        
        # Agentic should show lower success rate
        assert stats.agentic.successRate < stats.classic.successRate
        
        # Recent selections should show fallback
        fallbacks = [s for s in stats.recentSelections if s.result == 'fallback']
        assert len(fallbacks) > 0
    
    @pytest.mark.asyncio
    async def test_repeated_fallback_affects_mode_selection(self, mode_selector):
        """Test that repeated fallbacks affect future mode selection"""
        # Record multiple fallbacks
        for i in range(5):
            mode_selector.recordSelection(
                {
                    'videoHasHighTPS': True,
                    'channelHasPatterns': True,
                    'hasCompetitiveData': True,
                    'hasSemanticClusters': True,
                    'previousFailures': 2,
                    'quotaAvailable': True
                },
                'agentic',
                'fallback'
            )
            
            # Update performance to reflect failures
            mode_selector.updatePerformance(
                'agentic',
                success=False,
                durationMs=50000,
                cost=0.45,
                patternQuality=0.2
            )
        
        # Now try to select mode for similar video
        result = mode_selector.selectMode({
            'videoHasHighTPS': True,
            'channelHasPatterns': True,
            'hasCompetitiveData': True,
            'hasSemanticClusters': True,
            'previousFailures': 0,  # Fresh attempt
            'quotaAvailable': True
        })
        
        # Despite good factors, history should influence decision
        # May still select agentic but with lower confidence
        if result.mode == 'agentic':
            assert result.confidence < 0.5  # Low confidence
            assert result.fallbackRecommended is True
        else:
            # Or might select classic due to poor history
            assert result.mode == 'classic'


if __name__ == '__main__':
    pytest.main([__file__, '-v'])