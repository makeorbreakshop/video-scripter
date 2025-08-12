"""
Mock budget scenarios for testing budget enforcement
"""

from typing import Dict, Any, List, Optional
from datetime import datetime


class MockBudgetScenarios:
    """Predefined budget scenarios for testing"""
    
    @staticmethod
    def unlimited() -> Dict[str, Any]:
        """Unlimited budget for testing without constraints"""
        return {
            'maxFanouts': 100,
            'maxValidations': 100,
            'maxCandidates': 10000,
            'maxTokens': 1000000,
            'maxDurationMs': 600000,  # 10 minutes
            'maxToolCalls': 1000
        }
    
    @staticmethod
    def tight() -> Dict[str, Any]:
        """Very tight budget for testing constraints"""
        return {
            'maxFanouts': 1,
            'maxValidations': 2,
            'maxCandidates': 10,
            'maxTokens': 5000,
            'maxDurationMs': 10000,  # 10 seconds
            'maxToolCalls': 5
        }
    
    @staticmethod
    def standard() -> Dict[str, Any]:
        """Standard production budget"""
        return {
            'maxFanouts': 2,
            'maxValidations': 10,
            'maxCandidates': 120,
            'maxTokens': 100000,
            'maxDurationMs': 60000,  # 60 seconds
            'maxToolCalls': 50
        }
    
    @staticmethod
    def fanout_limited() -> Dict[str, Any]:
        """Limited fanouts only"""
        return {
            'maxFanouts': 1,
            'maxValidations': 20,
            'maxCandidates': 200,
            'maxTokens': 200000,
            'maxDurationMs': 120000,
            'maxToolCalls': 100
        }
    
    @staticmethod
    def validation_limited() -> Dict[str, Any]:
        """Limited validations only"""
        return {
            'maxFanouts': 5,
            'maxValidations': 3,
            'maxCandidates': 30,
            'maxTokens': 200000,
            'maxDurationMs': 120000,
            'maxToolCalls': 100
        }
    
    @staticmethod
    def token_limited() -> Dict[str, Any]:
        """Limited tokens only"""
        return {
            'maxFanouts': 10,
            'maxValidations': 50,
            'maxCandidates': 500,
            'maxTokens': 10000,  # Very limited
            'maxDurationMs': 300000,
            'maxToolCalls': 100
        }
    
    @staticmethod
    def time_limited() -> Dict[str, Any]:
        """Limited time only"""
        return {
            'maxFanouts': 10,
            'maxValidations': 50,
            'maxCandidates': 500,
            'maxTokens': 500000,
            'maxDurationMs': 5000,  # 5 seconds only
            'maxToolCalls': 100
        }


class BudgetUsageSimulator:
    """Simulate budget usage patterns"""
    
    def __init__(self, initial_caps: Dict[str, Any]):
        self.caps = initial_caps
        self.usage = {
            'fanouts': 0,
            'validations': 0,
            'candidates': 0,
            'tokens': 0,
            'durationMs': 0,
            'toolCalls': 0,
            'costs': {
                'gpt5': 0.0,
                'gpt5Mini': 0.0,
                'gpt5Nano': 0.0,
                'total': 0.0
            }
        }
        self.start_time = datetime.now()
        self.events = []
    
    def simulate_tool_call(self, tool_name: str, tokens: int = 1000, cost: float = 0.01):
        """Simulate a tool call"""
        if self.usage['toolCalls'] >= self.caps['maxToolCalls']:
            return {
                'allowed': False,
                'reason': 'Tool call limit exceeded',
                'limit': self.caps['maxToolCalls'],
                'used': self.usage['toolCalls']
            }
        
        if self.usage['tokens'] + tokens > self.caps['maxTokens']:
            return {
                'allowed': False,
                'reason': 'Token limit exceeded',
                'limit': self.caps['maxTokens'],
                'used': self.usage['tokens']
            }
        
        # Update usage
        self.usage['toolCalls'] += 1
        self.usage['tokens'] += tokens
        self.usage['costs']['total'] += cost
        
        # Distribute cost by tool type
        if 'search' in tool_name or 'hypothesis' in tool_name:
            self.usage['costs']['gpt5'] += cost * 0.6
            self.usage['costs']['gpt5Mini'] += cost * 0.3
            self.usage['costs']['gpt5Nano'] += cost * 0.1
        elif 'validate' in tool_name:
            self.usage['costs']['gpt5Mini'] += cost * 0.7
            self.usage['costs']['gpt5Nano'] += cost * 0.3
        else:
            self.usage['costs']['gpt5Nano'] += cost
        
        # Record event
        self.events.append({
            'timestamp': datetime.now(),
            'type': 'tool_call',
            'tool': tool_name,
            'tokens': tokens,
            'cost': cost,
            'usage_after': self.usage.copy()
        })
        
        return {'allowed': True, 'usage': self.usage.copy()}
    
    def simulate_fanout(self):
        """Simulate a search fanout"""
        if self.usage['fanouts'] >= self.caps['maxFanouts']:
            return {
                'allowed': False,
                'reason': 'Fanout limit exceeded',
                'limit': self.caps['maxFanouts'],
                'used': self.usage['fanouts']
            }
        
        self.usage['fanouts'] += 1
        
        self.events.append({
            'timestamp': datetime.now(),
            'type': 'fanout',
            'usage_after': self.usage.copy()
        })
        
        return {'allowed': True, 'fanouts': self.usage['fanouts']}
    
    def simulate_validation(self, candidate_count: int = 10):
        """Simulate a validation batch"""
        if self.usage['validations'] >= self.caps['maxValidations']:
            return {
                'allowed': False,
                'reason': 'Validation limit exceeded',
                'limit': self.caps['maxValidations'],
                'used': self.usage['validations']
            }
        
        if self.usage['candidates'] + candidate_count > self.caps['maxCandidates']:
            return {
                'allowed': False,
                'reason': 'Candidate limit exceeded',
                'limit': self.caps['maxCandidates'],
                'would_use': self.usage['candidates'] + candidate_count
            }
        
        self.usage['validations'] += 1
        self.usage['candidates'] += candidate_count
        
        self.events.append({
            'timestamp': datetime.now(),
            'type': 'validation',
            'candidates': candidate_count,
            'usage_after': self.usage.copy()
        })
        
        return {
            'allowed': True,
            'validations': self.usage['validations'],
            'candidates': self.usage['candidates']
        }
    
    def check_time_limit(self) -> bool:
        """Check if time limit exceeded"""
        elapsed_ms = (datetime.now() - self.start_time).total_seconds() * 1000
        self.usage['durationMs'] = elapsed_ms
        return elapsed_ms > self.caps['maxDurationMs']
    
    def get_remaining_budget(self) -> Dict[str, Any]:
        """Get remaining budget"""
        return {
            'fanouts': self.caps['maxFanouts'] - self.usage['fanouts'],
            'validations': self.caps['maxValidations'] - self.usage['validations'],
            'candidates': self.caps['maxCandidates'] - self.usage['candidates'],
            'tokens': self.caps['maxTokens'] - self.usage['tokens'],
            'toolCalls': self.caps['maxToolCalls'] - self.usage['toolCalls'],
            'timeMs': max(0, self.caps['maxDurationMs'] - self.usage['durationMs'])
        }
    
    def get_usage_percentage(self) -> Dict[str, float]:
        """Get usage as percentage of caps"""
        return {
            'fanouts': (self.usage['fanouts'] / self.caps['maxFanouts']) * 100,
            'validations': (self.usage['validations'] / self.caps['maxValidations']) * 100,
            'candidates': (self.usage['candidates'] / self.caps['maxCandidates']) * 100,
            'tokens': (self.usage['tokens'] / self.caps['maxTokens']) * 100,
            'toolCalls': (self.usage['toolCalls'] / self.caps['maxToolCalls']) * 100,
            'time': (self.usage['durationMs'] / self.caps['maxDurationMs']) * 100
        }
    
    def get_critical_resources(self, threshold: float = 80.0) -> List[str]:
        """Get resources above threshold percentage"""
        percentages = self.get_usage_percentage()
        return [
            resource for resource, pct in percentages.items()
            if pct >= threshold
        ]
    
    def simulate_typical_flow(self) -> Dict[str, Any]:
        """Simulate a typical analysis flow"""
        results = {
            'completed_phases': [],
            'blocked_at': None,
            'final_usage': None
        }
        
        # Phase 1: Context gathering (3 tools)
        for tool in ['get_video_bundle', 'get_channel_baseline', 'list_channel_history']:
            result = self.simulate_tool_call(tool, tokens=500, cost=0.01)
            if not result['allowed']:
                results['blocked_at'] = f'context_{tool}'
                results['final_usage'] = self.usage
                return results
        
        results['completed_phases'].append('context')
        
        # Phase 2: Search fanout
        fanout_result = self.simulate_fanout()
        if not fanout_result['allowed']:
            results['blocked_at'] = 'search_fanout'
            results['final_usage'] = self.usage
            return results
        
        # Search tools (3 parallel)
        for tool in ['search_titles', 'search_summaries', 'search_thumbs']:
            result = self.simulate_tool_call(tool, tokens=2000, cost=0.02)
            if not result['allowed']:
                results['blocked_at'] = f'search_{tool}'
                results['final_usage'] = self.usage
                return results
        
        results['completed_phases'].append('search')
        
        # Phase 3: Validation
        validation_result = self.simulate_validation(20)
        if not validation_result['allowed']:
            results['blocked_at'] = 'validation'
            results['final_usage'] = self.usage
            return results
        
        # Validation tools
        for tool in ['perf_snapshot', 'fetch_thumbs']:
            result = self.simulate_tool_call(tool, tokens=1000, cost=0.01)
            if not result['allowed']:
                results['blocked_at'] = f'validation_{tool}'
                results['final_usage'] = self.usage
                return results
        
        results['completed_phases'].append('validation')
        
        # Phase 4: Analysis
        result = self.simulate_tool_call('calculate_pattern_significance', tokens=3000, cost=0.03)
        if not result['allowed']:
            results['blocked_at'] = 'analysis'
            results['final_usage'] = self.usage
            return results
        
        results['completed_phases'].append('analysis')
        results['final_usage'] = self.usage
        
        return results
    
    def reset(self):
        """Reset simulator"""
        self.usage = {
            'fanouts': 0,
            'validations': 0,
            'candidates': 0,
            'tokens': 0,
            'durationMs': 0,
            'toolCalls': 0,
            'costs': {
                'gpt5': 0.0,
                'gpt5Mini': 0.0,
                'gpt5Nano': 0.0,
                'total': 0.0
            }
        }
        self.start_time = datetime.now()
        self.events.clear()


class CostCalculator:
    """Calculate costs for different scenarios"""
    
    # Pricing per 1K tokens (mock values)
    PRICING = {
        'gpt-5': 0.015,
        'gpt-5-mini': 0.002,
        'gpt-5-nano': 0.0005
    }
    
    @classmethod
    def calculate_tool_cost(cls, tool_name: str, tokens: int, model: str = 'gpt-5') -> float:
        """Calculate cost for a tool call"""
        price_per_1k = cls.PRICING.get(model, 0.01)
        return (tokens / 1000) * price_per_1k
    
    @classmethod
    def calculate_analysis_cost(cls, tool_calls: List[Dict[str, Any]]) -> Dict[str, float]:
        """Calculate total cost for an analysis"""
        costs = {
            'gpt5': 0.0,
            'gpt5Mini': 0.0,
            'gpt5Nano': 0.0,
            'total': 0.0
        }
        
        for call in tool_calls:
            model = call.get('model', 'gpt-5')
            tokens = call.get('tokens', 1000)
            cost = cls.calculate_tool_cost(call['tool'], tokens, model)
            
            if model == 'gpt-5':
                costs['gpt5'] += cost
            elif model == 'gpt-5-mini':
                costs['gpt5Mini'] += cost
            elif model == 'gpt-5-nano':
                costs['gpt5Nano'] += cost
            
            costs['total'] += cost
        
        return costs
    
    @classmethod
    def estimate_typical_cost(cls) -> Dict[str, Any]:
        """Estimate cost for typical analysis"""
        typical_flow = [
            # Context phase
            {'tool': 'get_video_bundle', 'tokens': 500, 'model': 'gpt-5'},
            {'tool': 'get_channel_baseline', 'tokens': 800, 'model': 'gpt-5'},
            {'tool': 'list_channel_history', 'tokens': 1200, 'model': 'gpt-5'},
            
            # Search phase
            {'tool': 'search_titles', 'tokens': 2000, 'model': 'gpt-5'},
            {'tool': 'search_summaries', 'tokens': 2500, 'model': 'gpt-5'},
            {'tool': 'search_thumbs', 'tokens': 1500, 'model': 'gpt-5'},
            
            # Validation phase
            {'tool': 'perf_snapshot', 'tokens': 1000, 'model': 'gpt-5-mini'},
            {'tool': 'fetch_thumbs', 'tokens': 500, 'model': 'gpt-5-mini'},
            {'tool': 'validation_batch', 'tokens': 5000, 'model': 'gpt-5-mini'},
            
            # Analysis phase
            {'tool': 'calculate_pattern_significance', 'tokens': 3000, 'model': 'gpt-5'},
            {'tool': 'suggest_pattern_hypotheses', 'tokens': 2000, 'model': 'gpt-5'},
            
            # Finalization
            {'tool': 'generate_report', 'tokens': 1500, 'model': 'gpt-5'}
        ]
        
        costs = cls.calculate_analysis_cost(typical_flow)
        
        return {
            'tool_calls': len(typical_flow),
            'total_tokens': sum(call['tokens'] for call in typical_flow),
            'costs': costs,
            'breakdown': typical_flow
        }