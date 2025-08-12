"""
Mock tool responses for testing
"""

from typing import Dict, Any, List, Optional
import random
from datetime import datetime, timedelta
import json


class MockToolResponses:
    """Mock responses for all 18 tools"""
    
    def __init__(self, scenario: str = 'success'):
        """
        Initialize with scenario
        
        Args:
            scenario: 'success', 'partial', 'failure', 'empty', 'invalid'
        """
        self.scenario = scenario
        self.call_count = {}  # Track calls per tool
    
    def get_response(self, tool_name: str, params: Dict[str, Any]) -> Dict[str, Any]:
        """Get mock response for a tool"""
        # Track call
        self.call_count[tool_name] = self.call_count.get(tool_name, 0) + 1
        
        # Handle failure scenario
        if self.scenario == 'failure':
            raise Exception(f"Tool {tool_name} failed: Mock error")
        
        # Get appropriate response
        response_method = getattr(self, f'mock_{tool_name}', self.mock_default)
        return response_method(params)
    
    # Context Tools (Phase 1)
    
    def mock_get_video_bundle(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """Mock get_video_bundle response"""
        if self.scenario == 'empty':
            return {'error': 'Video not found'}
        
        video_id = params.get('video_id', 'test-video')
        
        return {
            'video_id': video_id,
            'title': f'Mock Video Title for {video_id}',
            'summary': 'This is a mock video summary with key points about the content.',
            'thumb_url': f'https://mock-cdn.com/thumbs/{video_id}.jpg',
            'temporal_performance_score': random.uniform(1.5, 4.5) if self.scenario == 'success' else 1.0,
            'niche': random.choice(['technology', 'education', 'gaming', 'lifestyle']),
            'format_type': random.choice(['tutorial', 'vlog', 'review', 'explainer']),
            'channel_baseline_at_publish': random.uniform(0.8, 1.5),
            'published_at': (datetime.now() - timedelta(days=random.randint(1, 365))).isoformat(),
            'view_count': random.randint(1000, 1000000),
            'like_count': random.randint(100, 10000),
            'comment_count': random.randint(10, 1000)
        }
    
    def mock_get_channel_baseline(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """Mock get_channel_baseline response"""
        if self.scenario == 'empty':
            return {'baseline': None, 'sample_size': 0}
        
        channel_id = params.get('channel_id', 'test-channel')
        
        return {
            'channel_id': channel_id,
            'baseline_tps': random.uniform(1.0, 2.0),
            'sample_size': random.randint(10, 50),
            'baseline_videos': [
                {
                    'video_id': f'baseline_{i}',
                    'tps': random.uniform(0.8, 1.2),
                    'title': f'Baseline Video {i}'
                }
                for i in range(min(5, random.randint(3, 10)))
            ] if self.scenario == 'success' else []
        }
    
    def mock_list_channel_history(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """Mock list_channel_history response"""
        if self.scenario == 'empty':
            return {'videos': []}
        
        channel_id = params.get('channel_id', 'test-channel')
        limit = min(params.get('limit', 20), 50)
        
        videos = []
        for i in range(limit if self.scenario == 'success' else min(3, limit)):
            videos.append({
                'video_id': f'hist_{i}',
                'title': f'Historical Video {i}',
                'tps': random.uniform(0.5, 3.5),
                'published_at': (datetime.now() - timedelta(days=i*7)).isoformat(),
                'format_type': random.choice(['tutorial', 'vlog', 'review'])
            })
        
        return {
            'channel_id': channel_id,
            'videos': videos,
            'total_count': len(videos)
        }
    
    # Search Tools (Phase 1)
    
    def mock_search_titles(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """Mock search_titles response"""
        if self.scenario == 'empty':
            return {'results': []}
        
        query = params.get('query', '')
        num_results = random.randint(5, 20) if self.scenario == 'success' else 2
        
        return {
            'query': query,
            'results': [
                {
                    'video_id': f'search_title_{i}',
                    'title': f'Video matching "{query}" #{i}',
                    'similarity_score': random.uniform(0.5, 0.95),
                    'tps': random.uniform(1.0, 4.0)
                }
                for i in range(num_results)
            ]
        }
    
    def mock_search_summaries(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """Mock search_summaries response"""
        if self.scenario == 'empty':
            return {'results': []}
        
        query = params.get('query', '')
        num_results = random.randint(3, 15) if self.scenario == 'success' else 1
        
        return {
            'query': query,
            'results': [
                {
                    'video_id': f'search_summary_{i}',
                    'summary': f'Summary containing concepts related to {query}',
                    'similarity_score': random.uniform(0.4, 0.85),
                    'tps': random.uniform(1.5, 3.5)
                }
                for i in range(num_results)
            ]
        }
    
    def mock_search_thumbs(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """Mock search_thumbs response"""
        if self.scenario == 'empty':
            return {'results': []}
        
        query = params.get('query', '')
        num_results = random.randint(3, 10) if self.scenario == 'success' else 0
        
        return {
            'query': query,
            'results': [
                {
                    'video_id': f'search_thumb_{i}',
                    'thumb_url': f'https://mock-cdn.com/thumbs/visual_{i}.jpg',
                    'visual_similarity': random.uniform(0.6, 0.9),
                    'tps': random.uniform(2.0, 4.5)
                }
                for i in range(num_results)
            ]
        }
    
    # Enrichment Tools (Phase 1)
    
    def mock_perf_snapshot(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """Mock perf_snapshot response"""
        video_ids = params.get('video_ids', [])
        
        if self.scenario == 'empty':
            return {'videos': [], 'distribution': {}}
        
        videos = []
        for vid in video_ids[:200]:  # Limit to 200
            videos.append({
                'video_id': vid,
                'tps': random.uniform(0.5, 4.5) if self.scenario == 'success' else 1.0,
                'category': random.choice(['viral', 'outperforming', 'standard', 'underperforming'])
            })
        
        return {
            'videos': videos,
            'distribution': {
                'viral': 0.1,
                'outperforming': 0.25,
                'standard': 0.55,
                'underperforming': 0.1
            } if self.scenario == 'success' else {},
            'stats': {
                'mean_tps': 2.1,
                'median_tps': 1.8,
                'std_dev': 0.9
            }
        }
    
    def mock_fetch_thumbs(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """Mock fetch_thumbs response"""
        video_ids = params.get('video_ids', [])
        
        if self.scenario == 'empty':
            return {'thumbnails': []}
        
        thumbnails = []
        for vid in video_ids[:200]:
            thumbnails.append({
                'video_id': vid,
                'url': f'https://mock-cdn.com/thumbs/{vid}.jpg',
                'width': 1280,
                'height': 720,
                'valid': True if self.scenario == 'success' else random.choice([True, False])
            })
        
        return {
            'thumbnails': thumbnails,
            'invalid_count': 0 if self.scenario == 'success' else random.randint(0, len(video_ids)//4)
        }
    
    def mock_topic_lookup(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """Mock topic_lookup response"""
        video_ids = params.get('video_ids', [])
        
        if self.scenario == 'empty':
            return {'topics': []}
        
        topics = []
        for vid in video_ids[:200]:
            topics.append({
                'video_id': vid,
                'topic_niche': random.choice(['technology', 'education', 'gaming', 'lifestyle']),
                'topic_cluster_id': random.randint(1, 100),
                'cluster_name': f'Cluster {random.randint(1, 20)}',
                'cluster_size': random.randint(50, 500)
            })
        
        return {
            'topics': topics,
            'unique_clusters': len(set(t['topic_cluster_id'] for t in topics))
        }
    
    # Performance Analysis Tools (Phase 2)
    
    def mock_get_performance_timeline(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """Mock get_performance_timeline response"""
        video_id = params.get('video_id', 'test-video')
        
        if self.scenario == 'empty':
            return {'timeline': []}
        
        timeline = []
        for day in [1, 3, 7, 14, 30, 60, 90]:
            timeline.append({
                'day': day,
                'views': random.randint(1000, 100000) * day,
                'tps_at_day': random.uniform(1.0, 4.0),
                'vs_baseline': random.uniform(0.5, 3.0)
            })
        
        return {
            'video_id': video_id,
            'timeline': timeline,
            'curve_shape': random.choice(['early_spike', 'slow_burn', 'steady_growth', 'plateau'])
        }
    
    def mock_get_channel_performance_distribution(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """Mock channel performance distribution"""
        channel_id = params.get('channel_id', 'test-channel')
        
        if self.scenario == 'empty':
            return {'distribution': {}}
        
        return {
            'channel_id': channel_id,
            'distribution': {
                'viral': 0.05,
                'outperforming': 0.20,
                'standard': 0.60,
                'underperforming': 0.15
            },
            'percentiles': {
                'p10': 0.8,
                'p25': 1.2,
                'p50': 1.8,
                'p75': 2.5,
                'p90': 3.2
            },
            'total_videos': random.randint(50, 500)
        }
    
    def mock_find_competitive_successes(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """Mock competitive successes"""
        if self.scenario == 'empty':
            return {'videos': []}
        
        num_videos = random.randint(5, 30) if self.scenario == 'success' else 2
        
        return {
            'videos': [
                {
                    'video_id': f'competitive_{i}',
                    'title': f'Competitive Success #{i}',
                    'channel_name': f'Channel {random.randint(1, 10)}',
                    'tps': random.uniform(2.5, 5.0),
                    'format_type': random.choice(['tutorial', 'review', 'explainer'])
                }
                for i in range(num_videos)
            ],
            'unique_channels': random.randint(3, 10),
            'avg_tps': 3.2
        }
    
    # Novelty Detection Tools (Phase 2)
    
    def mock_detect_novelty_factors(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """Mock novelty detection"""
        video_id = params.get('video_id', 'test-video')
        
        return {
            'video_id': video_id,
            'novelty_score': random.uniform(0, 100) if self.scenario == 'success' else 0,
            'is_first': {
                'format_in_channel': random.choice([True, False]),
                'topic_in_channel': random.choice([True, False]),
                'cluster_in_channel': random.choice([True, False])
            },
            'days_since_similar': random.randint(0, 365),
            'semantic_distance_from_norm': random.uniform(0.1, 0.9)
        }
    
    def mock_find_content_gaps(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """Mock content gaps"""
        channel_id = params.get('channel_id', 'test-channel')
        
        if self.scenario == 'empty':
            return {'gaps': []}
        
        return {
            'channel_id': channel_id,
            'untried_formats': ['podcast', 'shorts', 'livestream'][:random.randint(0, 3)],
            'missing_topics': [f'Topic {i}' for i in range(random.randint(2, 8))],
            'competitor_exclusive': [
                {
                    'format': 'tutorial',
                    'topic': 'Advanced techniques',
                    'avg_tps': 3.5
                }
            ] if self.scenario == 'success' else []
        }
    
    # Semantic Intelligence Tools (Phase 2)
    
    def mock_calculate_pattern_significance(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """Mock pattern significance"""
        if self.scenario == 'invalid':
            return {'error': 'Invalid pattern'}
        
        return {
            'pattern': params.get('pattern', {}),
            'significance': random.uniform(0.7, 0.99) if self.scenario == 'success' else 0.5,
            'p_value': random.uniform(0.001, 0.05) if self.scenario == 'success' else 0.5,
            'effect_size': random.uniform(0.5, 1.5) if self.scenario == 'success' else 0.1,
            'confidence_interval': [0.65, 0.95],
            'sample_size': random.randint(20, 200)
        }
    
    def mock_find_correlated_features(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """Mock correlated features"""
        if self.scenario == 'empty':
            return {'correlations': []}
        
        return {
            'correlations': [
                {
                    'dimension': i,
                    'correlation': random.uniform(-0.8, 0.8),
                    'p_value': random.uniform(0.001, 0.05),
                    'interpretation': f'Dimension {i} relates to engagement'
                }
                for i in random.sample(range(512), min(10, 512))
            ] if self.scenario == 'success' else [],
            'top_positive': [234, 89, 456],
            'top_negative': [123, 367, 501]
        }
    
    def mock_get_comprehensive_video_analysis(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """Mock comprehensive analysis"""
        video_id = params.get('video_id', 'test-video')
        
        return {
            'video_id': video_id,
            'semantic_analysis': {
                'nearest_neighbors': [f'neighbor_{i}' for i in range(5)],
                'concept_clusters': ['tutorial', 'problem-solving', 'visual'],
                'embedding_position': 'cluster_center' if self.scenario == 'success' else 'outlier'
            },
            'visual_analysis': {
                'similar_thumbnails': [f'visual_{i}' for i in range(3)],
                'visual_style': 'professional',
                'color_dominance': 'blue'
            },
            'temporal_analysis': {
                'performance_curve': 'early_spike',
                'momentum': 'increasing',
                'predicted_plateau': 'day_60'
            },
            'combined_score': random.uniform(0.6, 0.95) if self.scenario == 'success' else 0.4
        }
    
    def mock_suggest_pattern_hypotheses(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """Mock pattern hypotheses"""
        if self.scenario == 'empty':
            return {'hypotheses': []}
        
        hypotheses = []
        for i in range(random.randint(1, 5) if self.scenario == 'success' else 0):
            hypotheses.append({
                'hypothesis': f'Pattern hypothesis {i}: Videos with X characteristic outperform',
                'confidence': random.uniform(0.6, 0.9),
                'supporting_videos': [f'support_{j}' for j in range(random.randint(5, 15))],
                'cross_boundary': random.choice([True, False]),
                'expected_lift': random.uniform(1.5, 3.0)
            })
        
        return {
            'hypotheses': hypotheses,
            'discovery_method': 'cross_channel_clustering' if self.scenario == 'success' else 'simple_correlation'
        }
    
    def mock_default(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """Default mock response for unknown tools"""
        return {
            'result': 'mock_data',
            'params_received': params,
            'scenario': self.scenario
        }
    
    def get_call_stats(self) -> Dict[str, int]:
        """Get statistics about tool calls"""
        return self.call_count.copy()
    
    def reset(self):
        """Reset call tracking"""
        self.call_count.clear()


# Configurable failure scenarios
class FailureScenarios:
    """Specific failure scenarios for testing"""
    
    @staticmethod
    def search_failures() -> MockToolResponses:
        """All search tools fail"""
        mock = MockToolResponses('success')
        
        def failing_search(params):
            raise Exception("Search API unavailable")
        
        mock.mock_search_titles = failing_search
        mock.mock_search_summaries = failing_search
        mock.mock_search_thumbs = failing_search
        
        return mock
    
    @staticmethod
    def partial_data() -> MockToolResponses:
        """Some tools return partial data"""
        return MockToolResponses('partial')
    
    @staticmethod
    def empty_results() -> MockToolResponses:
        """All tools return empty results"""
        return MockToolResponses('empty')
    
    @staticmethod
    def invalid_responses() -> MockToolResponses:
        """Tools return invalid data"""
        return MockToolResponses('invalid')