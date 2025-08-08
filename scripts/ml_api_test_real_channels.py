#!/usr/bin/env python3
"""
Test ML Baseline API with real channel data
"""

import requests
import json

def test_real_channels():
    """Test the ML baseline API with real channel data from the database"""
    
    # Real channel data from database query
    real_channels = [
        {
            'channel_id': 'UCBJycsmduvYEL83R_U4JriQ',
            'channel_name': 'Marques Brownlee',
            'subscriber_count': 20100000,
            'dominant_format': 'product_focus',
            'dominant_topic_cluster': 393,
            'avg_title_length': 5.6
        },
        {
            'channel_id': 'UCstwpLSByklww1YojZN-KiQ',
            'channel_name': 'Stumpy Nubs (James Hamilton)',
            'subscriber_count': 1000000,
            'dominant_format': 'tutorial',
            'dominant_topic_cluster': 1,
            'avg_title_length': 9.8
        },
        {
            'channel_id': 'UC7ZddA__ewP3AtDefjl_tWg',
            'channel_name': 'I Will Teach You To Be Rich',
            'subscriber_count': 940000,
            'dominant_format': 'explainer',
            'dominant_topic_cluster': 37,
            'avg_title_length': 9.3
        },
        {
            'channel_id': 'UCLZ6-13n1-IzVGCSNYP_CSw',
            'channel_name': 'Niche Pursuits',
            'subscriber_count': 91100,
            'dominant_format': 'case_study',
            'dominant_topic_cluster': 42,
            'avg_title_length': 12.6
        },
        {
            'channel_id': 'UCGh9zg0zvyF3GqHeR4WR3Xg',
            'channel_name': 'Cruise With Ben and David',
            'subscriber_count': 318000,
            'dominant_format': 'product_focus',
            'dominant_topic_cluster': 60,
            'avg_title_length': 9.7
        }
    ]
    
    print("🧪 Testing ML Baseline API with Real Channel Data")
    print("=" * 60)
    
    base_url = "http://localhost:3000"
    endpoint = f"{base_url}/api/ml/recent-baseline"
    
    results = []
    
    for i, channel in enumerate(real_channels):
        print(f"\n📊 Testing Channel {i+1}/5: {channel['channel_name']}")
        print(f"   Subscribers: {channel['subscriber_count']:,}")
        print(f"   Format: {channel['dominant_format']}")
        print(f"   Topic: {channel['dominant_topic_cluster']}")
        
        try:
            # Make API request
            response = requests.post(endpoint, 
                json={'channel': channel},
                timeout=30
            )
            
            if response.status_code == 200:
                result = response.json()
                
                if result.get('success'):
                    baseline = result['baselines'][0]
                    
                    print(f"   ✅ Success!")
                    print(f"   📈 Avg Multiplier: {baseline['avg_multiplier']:.2f}x")
                    print(f"   📊 Range: {baseline['min_multiplier']:.2f}x - {baseline['max_multiplier']:.2f}x")
                    print(f"   🎯 Channel Tier: {baseline['channel_characteristics']['channel_tier']}")
                    
                    results.append({
                        'channel': channel['channel_name'],
                        'success': True,
                        'avg_multiplier': baseline['avg_multiplier'],
                        'channel_tier': baseline['channel_characteristics']['channel_tier'],
                        'baseline': baseline
                    })
                else:
                    print(f"   ❌ API Error: {result.get('error', 'Unknown error')}")
                    results.append({
                        'channel': channel['channel_name'],
                        'success': False,
                        'error': result.get('error')
                    })
            else:
                print(f"   ❌ HTTP Error: {response.status_code}")
                print(f"   Response: {response.text[:200]}")
                results.append({
                    'channel': channel['channel_name'],
                    'success': False,
                    'error': f'HTTP {response.status_code}'
                })
                
        except Exception as e:
            print(f"   ❌ Request Error: {e}")
            results.append({
                'channel': channel['channel_name'],
                'success': False,
                'error': str(e)
            })
    
    # Summary
    print("\n" + "=" * 60)
    print("📋 TEST SUMMARY")
    print("=" * 60)
    
    successful = [r for r in results if r['success']]
    failed = [r for r in results if not r['success']]
    
    print(f"✅ Successful: {len(successful)}/{len(results)}")
    print(f"❌ Failed: {len(failed)}/{len(results)}")
    
    if successful:
        print(f"\n🎯 SUCCESSFUL BASELINES:")
        for result in successful:
            print(f"   {result['channel']}: {result['avg_multiplier']:.2f}x ({result['channel_tier']} tier)")
    
    if failed:
        print(f"\n❌ FAILED TESTS:")
        for result in failed:
            print(f"   {result['channel']}: {result['error']}")
    
    # Save detailed results
    with open('data/ml_api_test_results_real_channels.json', 'w') as f:
        json.dump({
            'test_date': '2025-08-05',
            'total_channels': len(results),
            'successful': len(successful),
            'failed': len(failed),
            'results': results
        }, f, indent=2)
    
    print(f"\n💾 Detailed results saved to: data/ml_api_test_results_real_channels.json")
    
    return len(successful) == len(results)

if __name__ == "__main__":
    success = test_real_channels()
    if success:
        print("\n🎉 All tests passed!")
    else:
        print("\n⚠️ Some tests failed - check the output above")