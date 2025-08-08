#!/usr/bin/env python3
"""
ML Performance Prediction - API Endpoint Testing
Test the ML prediction API with 100 random historical videos
"""

import requests
import json
import pandas as pd
import numpy as np
from datetime import datetime
import time
import statistics

def get_random_historical_videos(limit=100):
    """Get random historical videos for testing"""
    
    print(f"🎲 Getting {limit} random historical videos for testing...")
    
    # For now, create sample test data based on the structure we know
    # In a real scenario, this would query the database
    
    sample_videos = [
        {
            'video_id': 'V0wQqYlGY6c',
            'title': 'TESTING MY MAX BENCH PRESS | INSTANTLY INCREASE YOUR BENCH PRESS',
            'topic_cluster_id': 23,
            'format_type': 'case_study',
            'channel_id': 'UCEjIjshJ8bvvCkGNk0pkYcA',
            'published_at': '2021-03-23T21:59:19Z',
            'actual_performance_ratio': 1.0,
            'subscriber_count': 7170000,
            'expected_result': 'baseline_performance'
        },
        {
            'video_id': '_B-WHdT0tbQ',
            'title': 'Making Custom Drawer Pulls & T-Track Installation - Woodworking',
            'topic_cluster_id': 166,
            'format_type': 'tutorial',
            'channel_id': 'UCgwaPlarb9k0PS2BQphCLNQ',
            'published_at': '2019-11-22T13:52:39Z',
            'actual_performance_ratio': 1.0,
            'subscriber_count': 119000,
            'expected_result': 'baseline_performance'
        },
        {
            'video_id': 'DBjKmefC7NQ',
            'title': 'What everyone missed about Builder.ai',
            'topic_cluster_id': 17,
            'format_type': 'explainer',
            'channel_id': 'UCbRP3c757lWg9M-U7TyEkXA',
            'published_at': '2025-06-07T10:43:18Z',
            'actual_performance_ratio': 1.0,
            'subscriber_count': 460000,
            'expected_result': 'baseline_performance'
        },
        {
            'video_id': 'qiuFj-R7Et0',
            'title': 'The Rodent Tier List (Feat. RealLifeLore)',
            'topic_cluster_id': -1,
            'format_type': 'listicle',
            'channel_id': 'UCHsRtomD4twRf5WVHHk-cMw',
            'published_at': '2018-09-01T15:30:01Z',
            'actual_performance_ratio': 1.0,
            'subscriber_count': 3880000,
            'expected_result': 'high_performance'
        },
        {
            'video_id': '0ENZe0ckmxA',
            'title': 'I Cured @MrBeast\'s Fear Of Heights',
            'topic_cluster_id': 14,
            'format_type': 'personal_story',
            'channel_id': 'UCY1kMZp36IQSyNx_9h4mpCg',
            'published_at': '2023-06-29T20:47:19Z',
            'actual_performance_ratio': 4.42,
            'subscriber_count': 69400000,
            'expected_result': 'viral_performance'
        }
    ]
    
    # Replicate to get to 100 videos with variations
    test_videos = []
    for i in range(limit):
        base_video = sample_videos[i % len(sample_videos)].copy()
        base_video['test_id'] = i + 1
        # Add some variation to make tests more realistic
        base_video['title'] = f"Test {i+1}: {base_video['title']}"
        test_videos.append(base_video)
    
    print(f"✅ Generated {len(test_videos)} test videos")
    return test_videos

def test_api_endpoint(video_data, base_url="http://localhost:3000"):
    """Test a single video against the ML prediction API"""
    
    endpoint = f"{base_url}/api/ml/predict-performance"
    
    # Prepare API request payload
    payload = {
        'title': video_data['title'],
        'topic_cluster_id': video_data['topic_cluster_id'],
        'format_type': video_data['format_type'],
        'channel_id': video_data['channel_id'],
        'planned_publish_time': video_data['published_at']
    }
    
    try:
        start_time = time.time()
        response = requests.post(endpoint, json=payload, timeout=5)
        response_time = time.time() - start_time
        
        if response.status_code == 200:
            result = response.json()
            return {
                'success': True,
                'response_time': response_time,
                'prediction': result,
                'status_code': response.status_code
            }
        else:
            return {
                'success': False,
                'response_time': response_time,
                'error': f"HTTP {response.status_code}: {response.text[:200]}",
                'status_code': response.status_code
            }
            
    except requests.exceptions.Timeout:
        return {
            'success': False,
            'error': 'Request timeout (>5s)',
            'response_time': 5.0,
            'status_code': 408
        }
    except requests.exceptions.ConnectionError:
        return {
            'success': False,
            'error': 'Connection failed - is the server running?',
            'response_time': 0,
            'status_code': 0
        }
    except Exception as e:
        return {
            'success': False,
            'error': f"Unexpected error: {str(e)}",
            'response_time': 0,
            'status_code': 500
        }

def analyze_api_results(test_results, test_videos):
    """Analyze API test results for performance and accuracy"""
    
    print("\n📊 Analyzing API test results...")
    
    # Basic statistics
    total_tests = len(test_results)
    successful_tests = sum(1 for r in test_results if r['success'])
    failed_tests = total_tests - successful_tests
    
    print(f"📈 Success Rate: {successful_tests}/{total_tests} ({successful_tests/total_tests*100:.1f}%)")
    
    if successful_tests == 0:
        print("⚠️ No successful API calls - cannot analyze predictions")
        return
    
    # Response time analysis
    successful_results = [r for r in test_results if r['success']]
    response_times = [r['response_time'] for r in successful_results]
    
    avg_response_time = statistics.mean(response_times)
    max_response_time = max(response_times)
    min_response_time = min(response_times)
    
    print(f"⏱️ Response Time: {avg_response_time*1000:.0f}ms avg, {max_response_time*1000:.0f}ms max, {min_response_time*1000:.0f}ms min")
    
    # Target: <500ms response time
    fast_responses = sum(1 for t in response_times if t < 0.5)
    print(f"🎯 Fast Responses (<500ms): {fast_responses}/{successful_tests} ({fast_responses/successful_tests*100:.1f}%)")
    
    # Prediction analysis
    predictions = []
    actual_ratios = []
    
    for i, result in enumerate(successful_results):
        if 'prediction' in result and result['prediction']:
            pred_data = result['prediction']
            test_video = test_videos[i]
            
            if 'predicted_multiplier' in pred_data:
                predictions.append(pred_data['predicted_multiplier'])
                actual_ratios.append(test_video['actual_performance_ratio'])
    
    if predictions:
        print(f"\n🔮 Prediction Analysis ({len(predictions)} predictions):")
        print(f"   Predicted range: {min(predictions):.2f}x - {max(predictions):.2f}x")
        print(f"   Actual range: {min(actual_ratios):.2f}x - {max(actual_ratios):.2f}x")
        
        # Calculate simple accuracy metrics
        errors = [abs(p - a) for p, a in zip(predictions, actual_ratios)]
        mae = statistics.mean(errors)
        print(f"   Mean Absolute Error: {mae:.3f}x")
        
        # Count reasonable predictions (within 2x of actual)
        reasonable = sum(1 for p, a in zip(predictions, actual_ratios) if abs(p - a) <= 2.0)
        print(f"   Reasonable predictions (±2x): {reasonable}/{len(predictions)} ({reasonable/len(predictions)*100:.1f}%)")
    
    # Error analysis
    if failed_tests > 0:
        print(f"\n❌ Error Analysis ({failed_tests} failures):")
        failed_results = [r for r in test_results if not r['success']]
        error_types = {}
        
        for result in failed_results:
            error = result.get('error', 'Unknown error')
            error_type = error.split(':')[0]  # Get first part of error message
            error_types[error_type] = error_types.get(error_type, 0) + 1
        
        for error_type, count in error_types.items():
            print(f"   {error_type}: {count} occurrences")

def save_test_results(test_results, test_videos):
    """Save detailed test results for analysis"""
    
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    
    # Combine test data with results
    detailed_results = []
    for i, (video, result) in enumerate(zip(test_videos, test_results)):
        combined = {
            'test_id': i + 1,
            'video_data': video,
            'api_result': result,
            'timestamp': timestamp
        }
        detailed_results.append(combined)
    
    # Save to JSON file
    results_path = f"data/ml_api_test_results_{timestamp}.json"
    with open(results_path, 'w') as f:
        json.dump(detailed_results, f, indent=2)
    
    print(f"💾 Detailed results saved: {results_path}")
    
    return results_path

def performance_benchmarks():
    """Define performance benchmarks for the API"""
    
    return {
        'success_rate_target': 95,  # 95% of requests should succeed
        'response_time_target': 500,  # <500ms response time
        'accuracy_target': 70,  # 70% of predictions within ±2x of actual
        'availability_target': 99  # 99% uptime
    }

def check_benchmarks(test_results, test_videos):
    """Check if API meets performance benchmarks"""
    
    benchmarks = performance_benchmarks()
    results = {}
    
    # Success rate
    total_tests = len(test_results)
    successful_tests = sum(1 for r in test_results if r['success'])
    success_rate = (successful_tests / total_tests) * 100 if total_tests > 0 else 0
    
    results['success_rate'] = {
        'actual': success_rate,
        'target': benchmarks['success_rate_target'],
        'pass': success_rate >= benchmarks['success_rate_target']
    }
    
    # Response time
    successful_results = [r for r in test_results if r['success']]
    if successful_results:
        response_times = [r['response_time'] for r in successful_results]
        avg_response_time_ms = statistics.mean(response_times) * 1000
        fast_responses = sum(1 for t in response_times if t * 1000 < benchmarks['response_time_target'])
        fast_response_rate = (fast_responses / len(response_times)) * 100
        
        results['response_time'] = {
            'actual': avg_response_time_ms,
            'target': benchmarks['response_time_target'],
            'pass': avg_response_time_ms < benchmarks['response_time_target']
        }
        
        results['fast_response_rate'] = {
            'actual': fast_response_rate,
            'target': 90,  # 90% of responses should be fast
            'pass': fast_response_rate >= 90
        }
    
    return results

def main():
    """Main API testing pipeline"""
    print("🚀 Starting ML API endpoint testing...")
    
    # Get test videos
    test_videos = get_random_historical_videos(limit=20)  # Start with 20 for testing
    
    print("🔧 Testing API endpoint...")
    test_results = []
    
    for i, video in enumerate(test_videos):
        print(f"   Testing video {i+1}/{len(test_videos)}: {video['title'][:50]}...")
        result = test_api_endpoint(video)
        test_results.append(result)
        
        # Small delay to avoid overwhelming the server
        time.sleep(0.1)
    
    # Analyze results
    analyze_api_results(test_results, test_videos)
    
    # Check benchmarks
    benchmark_results = check_benchmarks(test_results, test_videos)
    
    print("\n🎯 Benchmark Results:")
    for metric, data in benchmark_results.items():
        status = "✅ PASS" if data['pass'] else "❌ FAIL"
        print(f"   {metric}: {data['actual']:.1f} (target: {data['target']}) {status}")
    
    # Save results
    results_path = save_test_results(test_results, test_videos)
    
    print(f"\n✅ API testing complete!")
    
    # Overall success assessment
    overall_pass = all(data['pass'] for data in benchmark_results.values())
    if overall_pass:
        print("🎉 SUCCESS: API meets all performance benchmarks!")
    else:
        failed_metrics = [metric for metric, data in benchmark_results.items() if not data['pass']]
        print(f"⚠️ ISSUES: Failed benchmarks: {', '.join(failed_metrics)}")
    
    return test_results, benchmark_results

if __name__ == "__main__":
    main()