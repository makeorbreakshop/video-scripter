"""
Integration tests for model switching behavior
"""

import pytest
from unittest.mock import Mock, AsyncMock, patch
import sys
import os
from datetime import datetime

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))))

from lib.orchestrator.model_router import ModelRouter
from lib.orchestrator.session_manager import SessionManagerImpl
from lib.orchestrator.budget_tracker import BudgetTrackerImpl
from types.orchestrator import (
    SessionState,
    BudgetUsage,
    ModelType,
    TurnType
)


class TestModelSwitching:
    """Test model switching and state continuity"""
    
    @pytest.fixture
    def router(self):
        """Create model router"""
        return ModelRouter()
    
    @pytest.fixture
    def session_manager(self):
        """Create session manager"""
        return SessionManagerImpl()
    
    @pytest.fixture
    def budget_tracker(self):
        """Create budget tracker"""
        return BudgetTrackerImpl()
    
    @pytest.fixture
    def mock_state(self):
        """Create mock session state"""
        return {
            'videoId': 'test-video-123',
            'videoContext': {
                'title': 'Test Video Title',
                'tps': 3.5,
                'channelName': 'Test Channel',
                'formatType': 'tutorial',
                'topicNiche': 'technology'
            },
            'hypothesis': {
                'statement': 'Videos with X pattern outperform',
                'confidence': 0.75,
                'supportingEvidence': ['evidence1', 'evidence2', 'evidence3']
            },
            'searchResults': {
                'semanticNeighbors': ['video1', 'video2', 'video3'],
                'competitiveSuccesses': ['video4', 'video5'],
                'totalCandidates': 50
            },
            'validationResults': None,
            'toolCalls': [],
            'errors': []
        }
    
    @pytest.mark.asyncio
    async def test_gpt5_to_mini_switch(self, router, session_manager, mock_state):
        """Test switching from GPT-5 to GPT-5-mini"""
        # Create session with GPT-5
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
        
        # Set initial state
        session_manager.sessions[session_id]['state'] = mock_state
        
        # Record some tool calls with GPT-5
        for i in range(5):
            session_manager.recordToolCall(session_id, {
                'id': f'call_{i}',
                'toolName': f'tool_{i}',
                'params': {},
                'status': 'success',
                'startTime': datetime.now(),
                'endTime': datetime.now(),
                'result': {'data': f'result_{i}'},
                'error': None
            })
        
        # Switch to GPT-5-mini for validation
        session_manager.switchModel(session_id, 'gpt-5', 'gpt-5-mini')
        
        # Get compacted state
        compacted = session_manager.getState(session_id)
        
        # Verify state was compacted
        assert compacted is not None
        assert compacted.hypothesis is not None
        assert compacted.hypothesis['statement'] == mock_state['hypothesis']['statement']
        
        # Verify search results preserved
        assert compacted.searchResults is not None
        assert len(compacted.searchResults['semanticNeighbors']) > 0
        
        # Verify model switch recorded
        history = session_manager.sessions[session_id]['modelSwitchHistory']
        assert len(history) == 1
        assert history[0]['from'] == 'gpt-5'
        assert history[0]['to'] == 'gpt-5-mini'
    
    @pytest.mark.asyncio
    async def test_mini_to_nano_switch(self, router, session_manager):
        """Test switching from GPT-5-mini to GPT-5-nano"""
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
        
        # Start with mini model
        session_manager.sessions[session_id]['currentModel'] = 'gpt-5-mini'
        
        # Add validation results
        session_manager.sessions[session_id]['state']['validationResults'] = {
            'validatedPatterns': [
                {'pattern': 'pattern1', 'confidence': 0.8, 'validations': 15},
                {'pattern': 'pattern2', 'confidence': 0.6, 'validations': 8}
            ],
            'totalValidations': 23
        }
        
        # Switch to nano for enrichment
        session_manager.switchModel(session_id, 'gpt-5-mini', 'gpt-5-nano')
        
        # Get state after switch
        state = session_manager.getState(session_id)
        
        # Verify validation results preserved
        assert state.validationResults is not None
        assert len(state.validationResults['validatedPatterns']) == 2
        assert state.validationResults['totalValidations'] == 23
        
        # Verify model switch
        assert session_manager.sessions[session_id]['currentModel'] == 'gpt-5-nano'
    
    @pytest.mark.asyncio
    async def test_nano_to_gpt5_switch(self, router, session_manager):
        """Test switching from GPT-5-nano back to GPT-5"""
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
        
        # Start with nano
        session_manager.sessions[session_id]['currentModel'] = 'gpt-5-nano'
        
        # Add enriched data
        session_manager.sessions[session_id]['state']['enrichedData'] = {
            'thumbnailUrls': ['url1', 'url2', 'url3'],
            'performanceSnapshots': [2.5, 3.0, 4.2],
            'topicClusters': ['cluster1', 'cluster2']
        }
        
        # Switch back to GPT-5 for finalization
        session_manager.switchModel(session_id, 'gpt-5-nano', 'gpt-5')
        
        # Verify enriched data preserved
        state = session_manager.getState(session_id)
        assert 'enrichedData' in state.__dict__ or state.toolCalls  # Data should be in state
        
        # Verify model switch
        assert session_manager.sessions[session_id]['currentModel'] == 'gpt-5'
    
    @pytest.mark.asyncio
    async def test_state_continuity_across_switches(self, router, session_manager, mock_state):
        """Test that state is maintained across multiple model switches"""
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
        
        # Set initial state
        session_manager.sessions[session_id]['state'] = mock_state.copy()
        
        # Chain of model switches: GPT-5 -> mini -> nano -> GPT-5
        models = ['gpt-5', 'gpt-5-mini', 'gpt-5-nano', 'gpt-5']
        
        for i in range(len(models) - 1):
            from_model = models[i]
            to_model = models[i + 1]
            
            # Add some data at each step
            if from_model == 'gpt-5':
                session_manager.updateHypothesis(session_id, {
                    'statement': 'Updated hypothesis',
                    'confidence': 0.85,
                    'supportingEvidence': ['new_evidence']
                })
            elif from_model == 'gpt-5-mini':
                state = session_manager.sessions[session_id]['state']
                state['validationResults'] = {
                    'validatedPatterns': [{'pattern': 'p1', 'confidence': 0.9}],
                    'totalValidations': 10
                }
            elif from_model == 'gpt-5-nano':
                state = session_manager.sessions[session_id]['state']
                state['enrichedData'] = {'thumbnails': ['t1', 't2']}
            
            # Switch model
            session_manager.switchModel(session_id, from_model, to_model)
        
        # Verify all data preserved through switches
        final_state = session_manager.getState(session_id)
        
        # Check hypothesis preserved and updated
        assert final_state.hypothesis is not None
        assert final_state.hypothesis['statement'] == 'Updated hypothesis'
        assert final_state.hypothesis['confidence'] == 0.85
        
        # Check validation results preserved
        assert final_state.validationResults is not None
        assert len(final_state.validationResults['validatedPatterns']) > 0
        
        # Check model switch history
        history = session_manager.sessions[session_id]['modelSwitchHistory']
        assert len(history) == 3  # Three switches
        assert history[0]['from'] == 'gpt-5'
        assert history[-1]['to'] == 'gpt-5'
    
    @pytest.mark.asyncio
    async def test_budget_aware_model_selection(self, router, budget_tracker):
        """Test that model selection respects budget constraints"""
        # Use 80% of budget
        for i in range(40):  # 40 tool calls
            budget_tracker.recordToolCall(f'tool_{i}', 2000, 0.02)
        
        budget_usage = budget_tracker.getUsage()
        
        # High budget usage should trigger downgrade
        mock_state = {
            'videoId': 'test',
            'videoContext': {'tps': 2.0},
            'hypothesis': {'confidence': 0.7},
            'searchResults': None,
            'validationResults': None,
            'toolCalls': [],
            'errors': []
        }
        
        # Should downgrade from GPT-5 to nano due to budget
        decision = router.route('hypothesis_generation', mock_state, budget_usage)
        assert decision.model == 'gpt-5-nano'
        assert 'Budget constraint' in decision.reason
    
    @pytest.mark.asyncio
    async def test_state_compaction_on_switch(self, session_manager):
        """Test that state is properly compacted when switching models"""
        # Create session with lots of data
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
        
        # Add many tool calls
        for i in range(20):
            session_manager.recordToolCall(session_id, {
                'id': f'call_{i}',
                'toolName': f'tool_{i}',
                'params': {'data': f'x' * 1000},  # Large params
                'status': 'success',
                'startTime': datetime.now(),
                'endTime': datetime.now(),
                'result': {'data': f'y' * 1000},  # Large result
                'error': None
            })
        
        # Add many patterns
        state = session_manager.sessions[session_id]['state']
        state['discoveredPatterns'] = [
            {'pattern': f'pattern_{i}', 'score': i * 0.1}
            for i in range(10)
        ]
        
        # Switch model (triggers compaction)
        session_manager.switchModel(session_id, 'gpt-5', 'gpt-5-mini')
        
        # Get compacted state
        compacted = session_manager.getState(session_id)
        
        # Verify compaction occurred
        assert len(compacted.toolCalls) <= 10  # Should keep only last 10
        
        # Verify patterns were prioritized (top 3 by score)
        if hasattr(compacted, 'discoveredPatterns'):
            assert len(compacted.discoveredPatterns) <= 3
    
    @pytest.mark.asyncio
    async def test_error_recovery_on_switch(self, session_manager):
        """Test error recovery when model switch fails"""
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
        
        # Add some errors
        session_manager.recordError(session_id, {
            'timestamp': datetime.now(),
            'error': 'API timeout',
            'context': 'tool_call',
            'recoverable': True
        })
        
        # Save state before switch
        original_state = session_manager.getState(session_id).copy() if hasattr(session_manager.getState(session_id), 'copy') else None
        
        # Simulate failed switch (corrupt the state)
        session_manager.sessions[session_id]['state'] = None
        
        # Try recovery
        recovered = session_manager.recoverSession(session_id)
        
        # Should recover from history
        assert recovered is not None
        
        # Errors should be preserved
        assert len(recovered.errors) > 0
        assert recovered.errors[0]['error'] == 'API timeout'


if __name__ == '__main__':
    pytest.main([__file__, '-v'])