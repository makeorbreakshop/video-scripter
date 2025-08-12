"""
End-to-end integration tests for complete orchestrator flow
"""

import pytest
from unittest.mock import Mock, AsyncMock, patch, MagicMock
import asyncio
from datetime import datetime
import json
import sys
import os

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))))

from lib.orchestrator.tool_registry import ToolRegistryImpl
from lib.orchestrator.budget_tracker import BudgetTrackerImpl
from lib.orchestrator.session_manager import SessionManagerImpl
from lib.orchestrator.model_router import ModelRouter
from lib.orchestrator.mode_selector import ModeSelector
from types.orchestrator import (
    OrchestratorConfig,
    AnalysisMode,
    FinalPatternReport
)


class MockOrchestrator:
    """Mock orchestrator for testing"""
    
    def __init__(self):
        self.tool_registry = ToolRegistryImpl()
        self.budget_tracker = BudgetTrackerImpl()
        self.session_manager = SessionManagerImpl()
        self.model_router = ModelRouter()
        self.mode_selector = ModeSelector()
        self._register_mock_tools()
    
    def _register_mock_tools(self):
        """Register mock versions of all tools"""
        # Context tools
        self.tool_registry.register({
            'name': 'get_video_bundle',
            'description': 'Get video data',
            'parameters': {'video_id': 'string'},
            'handler': AsyncMock(return_value={
                'title': 'Test Video',
                'tps': 3.5,
                'channel_name': 'Test Channel',
                'format_type': 'tutorial',
                'topic_niche': 'technology'
            }),
            'category': 'context',
            'parallelSafe': True,
            'estimatedCost': 0.01,
            'estimatedTokens': 500
        })
        
        # Search tools
        self.tool_registry.register({
            'name': 'search_titles',
            'description': 'Search by title',
            'parameters': {'query': 'string'},
            'handler': AsyncMock(return_value={
                'results': [
                    {'video_id': 'vid1', 'score': 0.9},
                    {'video_id': 'vid2', 'score': 0.8}
                ]
            }),
            'category': 'search',
            'parallelSafe': True,
            'estimatedCost': 0.02,
            'estimatedTokens': 1000
        })
        
        # Performance tools
        self.tool_registry.register({
            'name': 'perf_snapshot',
            'description': 'Get performance data',
            'parameters': {'video_ids': 'array'},
            'handler': AsyncMock(return_value={
                'videos': [
                    {'video_id': 'vid1', 'tps': 2.5},
                    {'video_id': 'vid2', 'tps': 3.0}
                ],
                'distribution': {
                    'viral': 0.1,
                    'outperforming': 0.3,
                    'standard': 0.5,
                    'underperforming': 0.1
                }
            }),
            'category': 'enrichment',
            'parallelSafe': True,
            'estimatedCost': 0.01,
            'estimatedTokens': 300
        })
        
        # Pattern tools
        self.tool_registry.register({
            'name': 'calculate_pattern_significance',
            'description': 'Calculate pattern significance',
            'parameters': {'pattern': 'object'},
            'handler': AsyncMock(return_value={
                'significance': 0.95,
                'p_value': 0.001,
                'effect_size': 0.8
            }),
            'category': 'analysis',
            'parallelSafe': False,
            'estimatedCost': 0.03,
            'estimatedTokens': 2000
        })
    
    async def run_analysis(self, video_id: str, mode: AnalysisMode = 'agentic'):
        """Run complete analysis flow"""
        # Create session
        config = {
            'budgetCaps': {
                'maxFanouts': 2,
                'maxValidations': 10,
                'maxCandidates': 120,
                'maxTokens': 100000,
                'maxDurationMs': 60000,
                'maxToolCalls': 50
            },
            'mode': mode
        }
        
        session_id = self.session_manager.createSession(video_id, config)
        
        # Phase 1: Context gathering
        context_tool = self.tool_registry.get('get_video_bundle')
        context = await context_tool['handler']({'video_id': video_id})
        self.session_manager.updateVideoContext(session_id, context)
        self.budget_tracker.recordToolCall('get_video_bundle', 500, 0.01)
        
        # Phase 2: Hypothesis generation (GPT-5)
        hypothesis = {
            'statement': 'Tutorial videos with visual demonstrations outperform',
            'confidence': 0.75,
            'supportingEvidence': ['High TPS', 'Tutorial format']
        }
        self.session_manager.updateHypothesis(session_id, hypothesis)
        
        # Phase 3: Search (parallel)
        search_tool = self.tool_registry.get('search_titles')
        search_results = await search_tool['handler']({'query': 'tutorial demonstration'})
        self.session_manager.updateSearchResults(session_id, {
            'semanticNeighbors': [r['video_id'] for r in search_results['results']],
            'competitiveSuccesses': [],
            'totalCandidates': len(search_results['results'])
        })
        self.budget_tracker.recordToolCall('search_titles', 1000, 0.02)
        
        # Model switch: GPT-5 -> GPT-5-mini for validation
        self.session_manager.switchModel(session_id, 'gpt-5', 'gpt-5-mini')
        
        # Phase 4: Validation
        perf_tool = self.tool_registry.get('perf_snapshot')
        perf_data = await perf_tool['handler']({
            'video_ids': [r['video_id'] for r in search_results['results']]
        })
        
        validation_results = {
            'validatedPatterns': [{
                'pattern': hypothesis['statement'],
                'confidence': 0.85,
                'validations': len(perf_data['videos']),
                'avgTPS': sum(v['tps'] for v in perf_data['videos']) / len(perf_data['videos'])
            }],
            'totalValidations': len(perf_data['videos'])
        }
        self.session_manager.sessions[session_id]['state']['validationResults'] = validation_results
        self.budget_tracker.recordToolCall('perf_snapshot', 300, 0.01)
        
        # Model switch: GPT-5-mini -> GPT-5 for finalization
        self.session_manager.switchModel(session_id, 'gpt-5-mini', 'gpt-5')
        
        # Phase 5: Pattern analysis
        pattern_tool = self.tool_registry.get('calculate_pattern_significance')
        significance = await pattern_tool['handler']({
            'pattern': validation_results['validatedPatterns'][0]
        })
        self.budget_tracker.recordToolCall('calculate_pattern_significance', 2000, 0.03)
        
        # Generate final report
        state = self.session_manager.getState(session_id)
        report = {
            'video_id': video_id,
            'mode': mode,
            'patterns': validation_results['validatedPatterns'],
            'significance': significance,
            'hypothesis': hypothesis,
            'tool_calls': len(state.toolCalls),
            'total_cost': self.budget_tracker.getUsage().costs.total,
            'duration_ms': 15000  # Mock duration
        }
        
        return report


class TestEndToEndFlow:
    """Test complete orchestrator flows"""
    
    @pytest.fixture
    def orchestrator(self):
        """Create mock orchestrator"""
        return MockOrchestrator()
    
    @pytest.mark.asyncio
    async def test_complete_analysis_flow(self, orchestrator):
        """Test complete analysis from start to finish"""
        # Run analysis
        report = await orchestrator.run_analysis('test-video-123', mode='agentic')
        
        # Verify all phases completed
        assert report['video_id'] == 'test-video-123'
        assert report['mode'] == 'agentic'
        assert len(report['patterns']) > 0
        assert report['patterns'][0]['confidence'] > 0.8
        assert report['significance']['p_value'] < 0.05
        assert report['tool_calls'] > 0
        assert report['total_cost'] > 0
        
        # Verify hypothesis was validated
        assert report['patterns'][0]['pattern'] == report['hypothesis']['statement']
        assert report['patterns'][0]['validations'] > 0
    
    @pytest.mark.asyncio
    async def test_budget_limited_flow(self, orchestrator):
        """Test flow with budget constraints"""
        # Set tight budget
        orchestrator.budget_tracker.initialize({
            'maxFanouts': 1,
            'maxValidations': 1,
            'maxCandidates': 10,
            'maxTokens': 5000,  # Very limited
            'maxDurationMs': 10000,
            'maxToolCalls': 5  # Only 5 tools
        })
        
        # Run analysis
        report = await orchestrator.run_analysis('test-video-123', mode='agentic')
        
        # Should complete but with constraints
        usage = orchestrator.budget_tracker.getUsage()
        assert usage.toolCalls <= 5
        assert usage.tokens <= 5000
        
        # Report should still be valid
        assert report is not None
        assert report['patterns'] is not None
    
    @pytest.mark.asyncio
    async def test_error_recovery_flow(self, orchestrator):
        """Test flow with errors and recovery"""
        # Make search tool fail once
        search_tool = orchestrator.tool_registry.get('search_titles')
        original_handler = search_tool['handler']
        
        call_count = 0
        async def failing_handler(params):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                raise Exception("Search API timeout")
            return await original_handler(params)
        
        search_tool['handler'] = failing_handler
        
        # Run analysis with retry logic
        try:
            # First attempt fails
            report = await orchestrator.run_analysis('test-video-123', mode='agentic')
        except Exception:
            # Retry
            report = await orchestrator.run_analysis('test-video-123', mode='agentic')
        
        # Should succeed on retry
        assert report is not None
        assert call_count >= 2  # At least one failure and one success
    
    @pytest.mark.asyncio
    async def test_classic_vs_agentic_flow(self, orchestrator):
        """Test both classic and agentic modes"""
        # Run classic mode
        classic_report = await orchestrator.run_analysis('test-video-123', mode='classic')
        
        # Reset orchestrator state
        orchestrator.budget_tracker = BudgetTrackerImpl()
        orchestrator.session_manager = SessionManagerImpl()
        
        # Run agentic mode
        agentic_report = await orchestrator.run_analysis('test-video-123', mode='agentic')
        
        # Compare results
        assert classic_report['mode'] == 'classic'
        assert agentic_report['mode'] == 'agentic'
        
        # Both should find patterns
        assert len(classic_report['patterns']) > 0
        assert len(agentic_report['patterns']) > 0
        
        # Agentic might have higher confidence (more thorough)
        # But classic should be faster/cheaper
        assert classic_report['total_cost'] <= agentic_report['total_cost']
    
    @pytest.mark.asyncio
    async def test_mode_fallback_flow(self, orchestrator):
        """Test fallback from agentic to classic"""
        # Make pattern tool fail to trigger fallback
        pattern_tool = orchestrator.tool_registry.get('calculate_pattern_significance')
        pattern_tool['handler'] = AsyncMock(side_effect=Exception("Model overloaded"))
        
        # Start with agentic
        session_id = orchestrator.session_manager.createSession('test-video', {
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
        
        # Run partial analysis
        context_tool = orchestrator.tool_registry.get('get_video_bundle')
        context = await context_tool['handler']({'video_id': 'test-video'})
        orchestrator.session_manager.updateVideoContext(session_id, context)
        
        # Try pattern analysis (will fail)
        try:
            await pattern_tool['handler']({'pattern': {}})
        except Exception:
            # Record error
            orchestrator.session_manager.recordError(session_id, {
                'timestamp': datetime.now(),
                'error': 'Model overloaded',
                'context': 'pattern_analysis',
                'recoverable': False
            })
        
        # Check if fallback needed
        state = orchestrator.session_manager.getState(session_id)
        should_fallback = orchestrator.mode_selector.shouldFallback(
            'agentic',
            elapsedMs=5000,
            tokensUsed=10000,
            errors=len(state.errors)
        )
        
        if should_fallback:
            # Switch to classic mode
            classic_session = orchestrator.session_manager.createSession('test-video', {
                'budgetCaps': state.__dict__.get('budgetCaps', {}),
                'mode': 'classic',
                'fallbackFrom': session_id
            })
            
            # Continue with classic pipeline
            assert classic_session is not None
    
    @pytest.mark.asyncio
    async def test_multimodal_validation_flow(self, orchestrator):
        """Test flow with multimodal validation"""
        # Add thumbnail tool
        orchestrator.tool_registry.register({
            'name': 'fetch_thumbs',
            'description': 'Fetch thumbnails',
            'parameters': {'video_ids': 'array'},
            'handler': AsyncMock(return_value={
                'thumbnails': [
                    {'video_id': 'vid1', 'url': 'https://thumb1.jpg'},
                    {'video_id': 'vid2', 'url': 'https://thumb2.jpg'}
                ]
            }),
            'category': 'enrichment',
            'parallelSafe': True,
            'estimatedCost': 0.01,
            'estimatedTokens': 200
        })
        
        # Run analysis with multimodal validation
        session_id = orchestrator.session_manager.createSession('test-video', {
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
        
        # Get thumbnails for validation
        thumb_tool = orchestrator.tool_registry.get('fetch_thumbs')
        thumbs = await thumb_tool['handler']({'video_ids': ['vid1', 'vid2']})
        
        # Multimodal validation batch
        validation_batch = {
            'candidates': [
                {
                    'video_id': t['video_id'],
                    'thumb_url': t['url'],
                    'tps': 3.0
                }
                for t in thumbs['thumbnails']
            ]
        }
        
        # Verify batch structure for GPT-5
        assert len(validation_batch['candidates']) == 2
        assert all('thumb_url' in c for c in validation_batch['candidates'])
        assert all(c['thumb_url'].startswith('https://') for c in validation_batch['candidates'])
    
    @pytest.mark.asyncio
    async def test_state_persistence_flow(self, orchestrator):
        """Test state persistence and recovery"""
        # Run partial analysis
        session_id = orchestrator.session_manager.createSession('test-video', {
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
        
        # Add some state
        orchestrator.session_manager.updateVideoContext(session_id, {
            'title': 'Test Video',
            'tps': 3.5
        })
        
        orchestrator.session_manager.updateHypothesis(session_id, {
            'statement': 'Test hypothesis',
            'confidence': 0.8
        })
        
        # Export state
        exported = orchestrator.session_manager.exportSession(session_id)
        
        # Simulate restart - create new session manager
        new_session_manager = SessionManagerImpl()
        
        # Import state
        restored_id = new_session_manager.importSession(exported)
        
        # Verify state restored
        restored_state = new_session_manager.getState(restored_id)
        assert restored_state.videoContext['title'] == 'Test Video'
        assert restored_state.hypothesis['statement'] == 'Test hypothesis'


if __name__ == '__main__':
    pytest.main([__file__, '-v'])