"""
Comprehensive test suite for Idea Heist Agent system
Tests all components: logger, orchestrator, streaming, and end-to-end flow
"""

import pytest
import asyncio
import json
import os
import tempfile
from pathlib import Path
from unittest.mock import Mock, patch, AsyncMock, MagicMock
from datetime import datetime
import sys
import time

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# ============================================================================
# TEST CONFIGURATION
# ============================================================================

@pytest.fixture
def temp_log_dir():
    """Create temporary directory for test logs"""
    with tempfile.TemporaryDirectory() as tmpdir:
        yield Path(tmpdir)

@pytest.fixture
def mock_supabase():
    """Mock Supabase client"""
    mock = MagicMock()
    mock.from_.return_value.select.return_value.eq.return_value.single.return_value = {
        'data': {
            'id': 'test-video-id',
            'title': 'Test Video Title',
            'channel_name': 'Test Channel',
            'view_count': 100000,
            'temporal_performance_score': 5.5
        },
        'error': None
    }
    return mock

@pytest.fixture
def mock_openai_client():
    """Mock OpenAI client for testing"""
    mock = MagicMock()
    mock.chat.completions.create.return_value = MagicMock(
        choices=[MagicMock(
            message=MagicMock(
                content=json.dumps({
                    'hypothesis': 'Test pattern hypothesis',
                    'confidence': 0.85
                })
            )
        )],
        usage=MagicMock(total_tokens=1000)
    )
    return mock

@pytest.fixture
def test_video_data():
    """Sample video data for testing"""
    return {
        'id': 'Y-Z4fjwMPsU',
        'title': 'Adam Savage\'s Workbench Ruler Build Has Two Mistakes!',
        'channel_name': 'Adam Savage\'s Tested',
        'channel_id': 'UCiDJtJKMICpb9B1qf7qjEOA',
        'view_count': 250000,
        'temporal_performance_score': 5.205,
        'published_at': '2024-01-15T12:00:00Z'
    }

# ============================================================================
# UNIT TESTS - AGENT LOGGER
# ============================================================================

class TestAgentLogger:
    """Test the AgentLogger component"""
    
    def test_logger_initialization(self, temp_log_dir):
        """Test logger creates correct file structure"""
        # Temporarily set environment variable for log directory
        os.environ['LOG_BASE_DIR'] = str(temp_log_dir)
        try:
            from lib.agentic.logger.agent_logger import AgentLogger
            
            logger = AgentLogger('test-video-id')
            assert logger.videoId == 'test-video-id'
            assert logger.runId.startswith('agent_')
            assert os.path.exists(logger.getLogFilePath())
    
    def test_log_entry_creation(self, temp_log_dir):
        """Test different types of log entries"""
        with patch('lib.agentic.logger.agent_logger.LOG_BASE_DIR', temp_log_dir):
            from lib.agentic.logger.agent_logger import AgentLogger
            
            logger = AgentLogger('test-video-id')
            
            # Test info log
            logger.log('info', 'test', 'Test message', {'key': 'value'})
            
            # Test reasoning log
            logger.logReasoning('hypothesis', 'gpt-5', {
                'statement': 'Test hypothesis',
                'confidence': 0.8
            })
            
            # Test tool call log
            logger.logToolCall('test_tool', {'param': 'value'}, {'result': 'success'})
            
            # Test model call log
            logger.logModelCall('gpt-5', 'Test prompt', 'Test response', 100, 0.01)
            
            # Complete and check file
            logger.complete(True, {'pattern': 'test'})
            
            # Verify log file exists and contains entries
            log_file = logger.getLogFilePath()
            assert os.path.exists(log_file)
            
            with open(log_file, 'r') as f:
                lines = f.readlines()
                assert len(lines) >= 4  # At least our 4 log entries
                
                # Verify each line is valid JSON
                for line in lines:
                    if line.strip():
                        entry = json.loads(line)
                        assert 'timestamp' in entry
                        assert 'level' in entry
    
    def test_logger_metadata_creation(self, temp_log_dir):
        """Test metadata file generation"""
        with patch('lib.agentic.logger.agent_logger.LOG_BASE_DIR', temp_log_dir):
            from lib.agentic.logger.agent_logger import AgentLogger
            
            logger = AgentLogger('test-video-id')
            logger.logModelCall('gpt-5', 'prompt', 'response', 500, 0.05)
            logger.logToolCall('tool1', {}, {})
            logger.complete(True, {'pattern': 'test'})
            
            # Check metadata file
            metadata_path = logger.getLogFilePath().replace('.jsonl', '_metadata.json')
            assert os.path.exists(metadata_path)
            
            with open(metadata_path, 'r') as f:
                metadata = json.load(f)
                assert metadata['videoId'] == 'test-video-id'
                assert metadata['success'] == True
                assert metadata['totalTokens'] == 500
                assert metadata['totalCost'] == 0.05
                assert metadata['totalToolCalls'] == 1

# ============================================================================
# UNIT TESTS - ORCHESTRATOR
# ============================================================================

class TestOrchestrator:
    """Test the IdeaHeistAgent orchestrator"""
    
    @pytest.mark.asyncio
    async def test_orchestrator_initialization(self):
        """Test orchestrator initializes correctly"""
        from lib.agentic.orchestrator.idea_heist_agent import IdeaHeistAgent
        
        agent = IdeaHeistAgent({
            'mode': 'agentic',
            'budget': {
                'maxTokens': 10000,
                'maxToolCalls': 10
            }
        })
        
        assert agent.config.mode == 'agentic'
        assert agent.config.budget.maxTokens == 10000
    
    @pytest.mark.asyncio
    async def test_orchestrator_error_handling(self, mock_supabase):
        """Test orchestrator handles errors gracefully"""
        with patch('lib.agentic.orchestrator.idea_heist_agent.createClient', return_value=mock_supabase):
            from lib.agentic.orchestrator.idea_heist_agent import IdeaHeistAgent
            
            agent = IdeaHeistAgent({'fallbackToClassic': False})
            
            # Force an error by not providing required tools
            with patch.object(agent, 'toolRegistry', MagicMock(get=MagicMock(return_value=None))):
                result = await agent.runIdeaHeistAgent('test-video-id')
                
                assert result['success'] == False
                assert 'error' in result or 'pattern' in result
    
    @pytest.mark.asyncio
    async def test_turn_sequence_execution(self):
        """Test the orchestrator executes turns in correct sequence"""
        from lib.agentic.orchestrator.idea_heist_agent import IdeaHeistAgent, TURN_SEQUENCE
        
        agent = IdeaHeistAgent()
        executed_turns = []
        
        # Mock executeTurn to track sequence
        async def mock_execute_turn(turn_type):
            executed_turns.append(turn_type)
            return {'complete': turn_type == 'finalization', 'nextTurn': None}
        
        with patch.object(agent, 'executeTurn', mock_execute_turn):
            with patch.object(agent, 'createResult', AsyncMock(return_value={'success': True})):
                with patch.object(agent, 'sessionManager') as mock_session:
                    mock_session.createSession.return_value = 'test-session'
                    mock_session.getSession.return_value = {'videoId': 'test'}
                    
                    await agent.runIdeaHeistAgent('test-video-id')
                    
                    # Verify at least some turns were executed
                    assert len(executed_turns) > 0
                    assert executed_turns[0] == TURN_SEQUENCE[0]

# ============================================================================
# INTEGRATION TESTS - STREAMING ENDPOINT
# ============================================================================

class TestStreamingEndpoint:
    """Test the streaming API endpoint"""
    
    @pytest.mark.asyncio
    async def test_streaming_response_format(self):
        """Test that streaming endpoint returns correct SSE format"""
        from app.api.idea_heist.agentic_v2.route import POST
        from unittest.mock import MagicMock
        
        # Create mock request
        mock_request = AsyncMock()
        mock_request.json.return_value = {
            'videoId': 'test-video-id',
            'mode': 'agentic'
        }
        
        # Mock the orchestrator
        with patch('app.api.idea_heist.agentic_v2.route.IdeaHeistAgent') as MockAgent:
            mock_instance = MockAgent.return_value
            mock_instance.runIdeaHeistAgent.return_value = {
                'success': True,
                'pattern': {'statement': 'Test pattern', 'confidence': 0.8}
            }
            
            # Call the endpoint
            response = await POST(mock_request)
            
            # Response should be a Response object with streaming body
            assert response is not None
            assert hasattr(response, 'body')
    
    @pytest.mark.asyncio
    async def test_streaming_error_handling(self):
        """Test streaming endpoint handles missing video ID"""
        from app.api.idea_heist.agentic_v2.route import POST
        
        mock_request = AsyncMock()
        mock_request.json.return_value = {}  # No video ID
        
        response = await POST(mock_request)
        
        # Should still return a response (with error message in stream)
        assert response is not None

# ============================================================================
# END-TO-END TESTS
# ============================================================================

class TestEndToEnd:
    """Complete end-to-end tests of the system"""
    
    @pytest.mark.asyncio
    async def test_full_agent_flow_success(self, test_video_data, temp_log_dir):
        """Test complete successful flow from request to result"""
        with patch('lib.agentic.logger.agent_logger.LOG_BASE_DIR', temp_log_dir):
            from lib.agentic.orchestrator.idea_heist_agent import IdeaHeistAgent
            
            agent = IdeaHeistAgent({
                'mode': 'agentic',
                'budget': {'maxTokens': 1000}
            })
            
            # Mock all external dependencies
            with patch.object(agent, 'toolRegistry') as mock_registry:
                # Mock tools
                mock_tool = AsyncMock()
                mock_tool.execute.return_value = {
                    'success': True,
                    'data': {'videos': [test_video_data]}
                }
                mock_registry.get.return_value = mock_tool
                
                # Mock session manager
                with patch.object(agent, 'sessionManager') as mock_session:
                    mock_session.createSession.return_value = 'test-session'
                    mock_session.getSession.return_value = {
                        'videoId': test_video_data['id'],
                        'videoContext': test_video_data,
                        'hypothesis': {
                            'statement': 'Test pattern',
                            'confidence': 0.85
                        },
                        'validationResults': {
                            'validated': 10,
                            'rejected': 2
                        },
                        'finalReport': {
                            'primaryPattern': {
                                'statement': 'Test pattern',
                                'confidence': 0.85,
                                'type': 'title',
                                'niches': ['tech'],
                                'evidence': [],
                                'performanceImpact': {'avgTPS': 5.0},
                                'actionability': 'high'
                            },
                            'metadata': {
                                'totalVideosAnalyzed': 12
                            }
                        }
                    }
                    
                    # Run the agent
                    result = await agent.runIdeaHeistAgent(test_video_data['id'])
                    
                    # Verify success
                    assert result['success'] == True
                    assert 'pattern' in result
                    assert result['pattern']['confidence'] == 0.85
                    
                    # Verify logs were created
                    log_files = list(temp_log_dir.glob('**/*.jsonl'))
                    assert len(log_files) > 0
    
    @pytest.mark.asyncio
    async def test_full_agent_flow_with_fallback(self, test_video_data):
        """Test agent falls back to classic mode on error"""
        from lib.agentic.orchestrator.idea_heist_agent import IdeaHeistAgent
        
        agent = IdeaHeistAgent({
            'fallbackToClassic': True
        })
        
        # Force an error in agentic mode
        with patch.object(agent, 'executeTurn', side_effect=Exception('Test error')):
            # Mock fallback to return success
            with patch.object(agent, 'fallbackToClassic', AsyncMock(return_value={
                'success': True,
                'mode': 'classic',
                'pattern': {'statement': 'Fallback pattern'}
            })):
                result = await agent.runIdeaHeistAgent(test_video_data['id'])
                
                assert result['success'] == True
                assert result['mode'] == 'classic'
    
    @pytest.mark.asyncio
    async def test_streaming_with_real_agent(self, test_video_data, temp_log_dir):
        """Test streaming endpoint with real agent execution"""
        with patch('lib.agentic.logger.agent_logger.LOG_BASE_DIR', temp_log_dir):
            from app.api.idea_heist.agentic_v2.route import POST
            
            mock_request = AsyncMock()
            mock_request.json.return_value = {
                'videoId': test_video_data['id'],
                'mode': 'agentic'
            }
            
            # Mock Supabase
            with patch('app.api.idea_heist.agentic_v2.route.createClient') as mock_create:
                mock_client = MagicMock()
                mock_create.return_value = mock_client
                
                # Mock video lookup
                mock_client.from_.return_value.select.return_value.eq.return_value.single.return_value = {
                    'data': test_video_data,
                    'error': None
                }
                
                # Mock the agent to complete quickly
                with patch('app.api.idea_heist.agentic_v2.route.IdeaHeistAgent') as MockAgent:
                    mock_agent = MockAgent.return_value
                    mock_agent.runIdeaHeistAgent = AsyncMock(return_value={
                        'success': True,
                        'pattern': {
                            'statement': 'Test pattern from streaming',
                            'confidence': 0.9
                        }
                    })
                    
                    # Execute request
                    response = await POST(mock_request)
                    
                    # Verify response
                    assert response is not None
                    assert response.status == 200
                    assert response.headers['Content-Type'] == 'text/event-stream'

# ============================================================================
# PERFORMANCE TESTS
# ============================================================================

class TestPerformance:
    """Test performance and resource usage"""
    
    @pytest.mark.asyncio
    async def test_logger_performance(self, temp_log_dir):
        """Test logger can handle high volume of entries"""
        with patch('lib.agentic.logger.agent_logger.LOG_BASE_DIR', temp_log_dir):
            from lib.agentic.logger.agent_logger import AgentLogger
            
            logger = AgentLogger('perf-test')
            start_time = time.time()
            
            # Write 1000 log entries
            for i in range(1000):
                logger.log('info', 'perf', f'Message {i}', {'index': i})
            
            logger.complete(True)
            duration = time.time() - start_time
            
            # Should complete in reasonable time (< 5 seconds)
            assert duration < 5.0
            
            # Verify all entries were written
            with open(logger.getLogFilePath(), 'r') as f:
                lines = f.readlines()
                assert len(lines) >= 1000
    
    @pytest.mark.asyncio
    async def test_orchestrator_timeout(self):
        """Test orchestrator respects timeout configuration"""
        from lib.agentic.orchestrator.idea_heist_agent import IdeaHeistAgent
        
        agent = IdeaHeistAgent({
            'timeoutMs': 100  # 100ms timeout
        })
        
        # Mock a slow turn execution
        async def slow_turn(turn_type):
            await asyncio.sleep(0.5)  # 500ms delay
            return {'complete': False}
        
        with patch.object(agent, 'executeTurn', slow_turn):
            with patch.object(agent, 'createResult', AsyncMock(return_value={'success': False})):
                with patch.object(agent, 'sessionManager') as mock_session:
                    mock_session.createSession.return_value = 'test-session'
                    mock_session.getSession.return_value = {'videoId': 'test'}
                    
                    start_time = time.time()
                    result = await agent.runIdeaHeistAgent('test-video-id')
                    duration = time.time() - start_time
                    
                    # Should timeout and return quickly
                    assert duration < 1.0
                    assert result['success'] == False

# ============================================================================
# MOCK DATA TESTS
# ============================================================================

class TestWithMockData:
    """Test with realistic mock data"""
    
    @pytest.mark.asyncio
    async def test_with_mock_openai_response(self, mock_openai_client):
        """Test with mocked OpenAI responses"""
        from lib.agentic.orchestrator.idea_heist_agent import IdeaHeistAgent
        
        with patch('lib.agentic.openai_integration.client', mock_openai_client):
            agent = IdeaHeistAgent()
            
            # Mock the tool registry to use our mock OpenAI
            with patch.object(agent, 'toolRegistry') as mock_registry:
                mock_tool = AsyncMock()
                mock_tool.execute.return_value = {
                    'success': True,
                    'hypothesis': 'Numbered mistakes in titles boost CTR',
                    'confidence': 0.82
                }
                mock_registry.get.return_value = mock_tool
                
                with patch.object(agent, 'sessionManager') as mock_session:
                    mock_session.createSession.return_value = 'test-session'
                    mock_session.getSession.return_value = {
                        'videoId': 'test-id',
                        'hypothesis': {
                            'statement': 'Numbered mistakes pattern',
                            'confidence': 0.82
                        }
                    }
                    
                    result = await agent.runIdeaHeistAgent('test-video-id')
                    
                    # Verify the hypothesis was processed
                    assert 'pattern' in result or 'error' in result

# ============================================================================
# RUN ALL TESTS
# ============================================================================

if __name__ == '__main__':
    # Run all tests with verbose output
    pytest.main([__file__, '-v', '--tb=short'])