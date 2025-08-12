"""
Mock Responses API for testing
"""

from typing import Dict, List, Any, Optional, Callable
from datetime import datetime
import uuid
import asyncio
import random


class MockResponsesAPI:
    """Mock implementation of OpenAI Responses API"""
    
    def __init__(self, behavior: str = 'normal'):
        """
        Initialize mock API with configurable behavior
        
        Args:
            behavior: 'normal', 'slow', 'error', 'timeout', 'budget_exceeded'
        """
        self.behavior = behavior
        self.sessions = {}
        self.call_history = []
        self.tool_handlers = {}
        self._setup_default_responses()
    
    def _setup_default_responses(self):
        """Set up default response patterns"""
        self.response_templates = {
            'hypothesis_generation': {
                'model': 'gpt-5',
                'tool_calls': [
                    {'tool': 'get_video_bundle', 'params': {'video_id': '{{video_id}}'}},
                    {'tool': 'get_channel_baseline', 'params': {'channel_id': '{{channel_id}}'}},
                    {'tool': 'list_channel_history', 'params': {'channel_id': '{{channel_id}}'}}
                ],
                'hypothesis': {
                    'statement': 'Videos with visual demonstrations and clear problem-solution structure outperform',
                    'confidence': 0.75,
                    'reasoning': 'Based on channel history and performance data'
                }
            },
            'search_planning': {
                'model': 'gpt-5',
                'tool_calls': [
                    {'tool': 'search_titles', 'params': {'query': 'visual demonstration tutorial'}},
                    {'tool': 'search_summaries', 'params': {'query': 'problem solution structure'}},
                    {'tool': 'search_thumbs', 'params': {'query': 'hands-on demonstration'}}
                ],
                'search_strategy': 'Multi-modal search across semantic, conceptual, and visual dimensions'
            },
            'validation': {
                'model': 'gpt-5-mini',
                'tool_calls': [
                    {'tool': 'perf_snapshot', 'params': {'video_ids': ['vid1', 'vid2', 'vid3']}},
                    {'tool': 'fetch_thumbs', 'params': {'video_ids': ['vid1', 'vid2', 'vid3']}}
                ],
                'validation_results': {
                    'pattern_confirmed': True,
                    'confidence': 0.85,
                    'validations': 15,
                    'cross_niche_coverage': 3
                }
            },
            'enrichment': {
                'model': 'gpt-5-nano',
                'tool_calls': [
                    {'tool': 'topic_lookup', 'params': {'video_ids': ['vid1', 'vid2']}},
                    {'tool': 'get_performance_timeline', 'params': {'video_id': 'vid1'}}
                ],
                'enriched_data': {
                    'topics_covered': ['tech', 'education', 'diy'],
                    'performance_curves': ['early_spike', 'slow_burn']
                }
            },
            'finalization': {
                'model': 'gpt-5',
                'final_report': {
                    'patterns': [
                        {
                            'pattern': 'Visual demonstration with problem-solution structure',
                            'confidence': 0.88,
                            'validations': 23,
                            'cross_niche': 4,
                            'expected_tps': 3.2
                        }
                    ],
                    'recommendations': [
                        'Include hands-on demonstrations',
                        'Start with clear problem statement',
                        'Show solution step-by-step'
                    ],
                    'evidence_summary': 'Strong statistical significance (p<0.001) across multiple niches'
                }
            }
        }
    
    async def create(self, **kwargs) -> Dict[str, Any]:
        """
        Create a new response session
        
        Args:
            model: Model to use
            tools: Available tools
            input: User input
            previous_response_id: Previous response for continuity
            response_format: Output format constraints
        """
        # Simulate API behavior based on configuration
        if self.behavior == 'error':
            raise Exception("API Error: Service unavailable")
        
        if self.behavior == 'timeout':
            await asyncio.sleep(70)  # Exceed typical timeout
            raise TimeoutError("Request timeout")
        
        if self.behavior == 'slow':
            await asyncio.sleep(random.uniform(2, 5))
        
        # Generate response
        session_id = str(uuid.uuid4())
        model = kwargs.get('model', 'gpt-5')
        
        # Detect turn type from input
        turn_type = self._detect_turn_type(kwargs.get('input', {}))
        
        # Get appropriate response template
        template = self.response_templates.get(turn_type, {})
        
        # Build response
        response = {
            'id': session_id,
            'model': model,
            'created': datetime.now().isoformat(),
            'turn_type': turn_type,
            'tool_calls': template.get('tool_calls', []),
            'content': template
        }
        
        # Handle budget exceeded
        if self.behavior == 'budget_exceeded':
            if len(self.call_history) > 10:
                response['error'] = 'budget_exceeded'
                response['error_details'] = {
                    'resource': 'tokens',
                    'used': 105000,
                    'limit': 100000
                }
        
        # Store session
        self.sessions[session_id] = response
        self.call_history.append({
            'timestamp': datetime.now(),
            'session_id': session_id,
            'model': model,
            'turn_type': turn_type
        })
        
        return response
    
    def _detect_turn_type(self, input_data: Any) -> str:
        """Detect the type of turn from input"""
        if isinstance(input_data, dict):
            content = input_data.get('content', '')
            if isinstance(content, str):
                content_lower = content.lower()
            else:
                content_lower = str(content).lower()
            
            if 'hypothesis' in content_lower or 'analyze' in content_lower:
                return 'hypothesis_generation'
            elif 'search' in content_lower or 'find' in content_lower:
                return 'search_planning'
            elif 'validate' in content_lower or 'check' in content_lower:
                return 'validation'
            elif 'enrich' in content_lower or 'additional' in content_lower:
                return 'enrichment'
            elif 'final' in content_lower or 'report' in content_lower:
                return 'finalization'
        
        return 'hypothesis_generation'  # Default
    
    async def execute_tool(self, tool_name: str, params: Dict[str, Any]) -> Dict[str, Any]:
        """Execute a mock tool"""
        # Use custom handler if registered
        if tool_name in self.tool_handlers:
            return await self.tool_handlers[tool_name](params)
        
        # Default mock responses by tool
        mock_responses = {
            'get_video_bundle': {
                'video_id': params.get('video_id'),
                'title': 'Mock Video Title',
                'tps': random.uniform(1.5, 4.5),
                'channel_name': 'Mock Channel',
                'format_type': random.choice(['tutorial', 'vlog', 'review']),
                'topic_niche': random.choice(['tech', 'education', 'gaming'])
            },
            'get_channel_baseline': {
                'channel_id': params.get('channel_id'),
                'baseline_tps': random.uniform(1.0, 2.0),
                'sample_size': random.randint(10, 50)
            },
            'search_titles': {
                'results': [
                    {'video_id': f'vid_{i}', 'score': random.uniform(0.5, 1.0)}
                    for i in range(random.randint(5, 20))
                ]
            },
            'perf_snapshot': {
                'videos': [
                    {'video_id': vid, 'tps': random.uniform(1.0, 4.0)}
                    for vid in params.get('video_ids', [])[:10]
                ],
                'distribution': {
                    'viral': 0.1,
                    'outperforming': 0.3,
                    'standard': 0.5,
                    'underperforming': 0.1
                }
            },
            'calculate_pattern_significance': {
                'significance': random.uniform(0.8, 0.99),
                'p_value': random.uniform(0.001, 0.05),
                'effect_size': random.uniform(0.5, 1.2)
            }
        }
        
        # Simulate processing delay
        if self.behavior == 'slow':
            await asyncio.sleep(random.uniform(0.1, 0.5))
        
        return mock_responses.get(tool_name, {'result': 'mock_data'})
    
    def register_tool_handler(self, tool_name: str, handler: Callable):
        """Register a custom tool handler for testing"""
        self.tool_handlers[tool_name] = handler
    
    def get_session(self, session_id: str) -> Optional[Dict[str, Any]]:
        """Get session data"""
        return self.sessions.get(session_id)
    
    def get_call_history(self) -> List[Dict[str, Any]]:
        """Get call history for analysis"""
        return self.call_history
    
    def reset(self):
        """Reset mock state"""
        self.sessions.clear()
        self.call_history.clear()
        self.tool_handlers.clear()
    
    def set_behavior(self, behavior: str):
        """Change mock behavior"""
        self.behavior = behavior
    
    def get_metrics(self) -> Dict[str, Any]:
        """Get usage metrics"""
        model_usage = {}
        for call in self.call_history:
            model = call['model']
            model_usage[model] = model_usage.get(model, 0) + 1
        
        return {
            'total_calls': len(self.call_history),
            'unique_sessions': len(self.sessions),
            'model_usage': model_usage,
            'avg_calls_per_session': len(self.call_history) / max(len(self.sessions), 1)
        }


def create_mock_api(behavior: str = 'normal') -> MockResponsesAPI:
    """Factory function to create mock API"""
    return MockResponsesAPI(behavior)


# Preset scenarios for testing
class MockScenarios:
    """Predefined test scenarios"""
    
    @staticmethod
    def successful_analysis() -> MockResponsesAPI:
        """Create mock for successful analysis"""
        api = MockResponsesAPI('normal')
        return api
    
    @staticmethod
    def api_errors() -> MockResponsesAPI:
        """Create mock that throws errors"""
        api = MockResponsesAPI('error')
        return api
    
    @staticmethod
    def slow_responses() -> MockResponsesAPI:
        """Create mock with slow responses"""
        api = MockResponsesAPI('slow')
        return api
    
    @staticmethod
    def budget_exceeded() -> MockResponsesAPI:
        """Create mock that exceeds budget"""
        api = MockResponsesAPI('budget_exceeded')
        return api
    
    @staticmethod
    def timeout_scenario() -> MockResponsesAPI:
        """Create mock that times out"""
        api = MockResponsesAPI('timeout')
        return api