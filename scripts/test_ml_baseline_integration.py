#!/usr/bin/env python3
"""
Test ML baseline integration without full database queries
"""

import os
import sys
import numpy as np
from dotenv import load_dotenv

# Add current directory to path
sys.path.append('.')

# Import our enhanced baseline functions
from scripts.smart_channel_baseline import (
    load_ml_baseline_model, 
    get_channel_characteristics_for_ml, 
    generate_ml_baseline
)

load_dotenv()

def test_ml_baseline_integration():
    """Test the ML baseline integration with sample data"""
    
    print("🧪 Testing ML baseline integration...")
    
    # Load ML model
    print("\n1. Loading ML model...")
    ml_model, ml_metadata = load_ml_baseline_model()
    
    if not ml_model:
        print("❌ No ML model found")
        return
    
    print(f"   ✓ Loaded: {ml_metadata['model_id']}")
    print(f"   ✓ Features: {len(ml_metadata['features'])}")
    
    # Test with sample Matt Mitchell channel data
    print("\n2. Testing channel characteristics extraction...")
    sample_videos = [
        {
            'title': 'DIY Dining Room Hutch Build',
            'format_type': 'tutorial',
            'topic_cluster_id': 166,
            'metadata': {
                'channel': {
                    'subscriber_count': 337000
                }
            }
        },
        {
            'title': 'Woodworking Shop Tour',
            'format_type': 'vlog',
            'topic_cluster_id': 166,
            'metadata': {
                'channel': {
                    'subscriber_count': 337000
                }
            }
        },
        {
            'title': 'Router Table Cabinet Build',
            'format_type': 'tutorial',
            'topic_cluster_id': 166,
            'metadata': {
                'channel': {
                    'subscriber_count': 337000
                }
            }
        }
    ]
    
    channel_chars = get_channel_characteristics_for_ml('Matt Mitchell', sample_videos)
    
    print(f"   ✓ Channel: {channel_chars['channel_name']}")
    print(f"   ✓ Subscribers: {channel_chars['subscriber_count']:,}")  
    print(f"   ✓ Dominant format: {channel_chars['dominant_format']}")
    print(f"   ✓ Dominant topic: {channel_chars['dominant_topic_cluster']}")
    print(f"   ✓ Avg title length: {channel_chars['avg_title_length']} words")
    
    # Test ML baseline generation
    print("\n3. Testing ML baseline generation...")
    global_baseline = 8478  # Global baseline
    
    ml_baseline, ml_multiplier = generate_ml_baseline(
        channel_chars, ml_model, ml_metadata, global_baseline
    )
    
    print(f"   ✓ Global baseline: {global_baseline:,} views")
    print(f"   ✓ ML multiplier: {ml_multiplier:.3f}x")
    print(f"   ✓ ML baseline: {ml_baseline:,.0f} views")
    print(f"   ✓ Scale factor: {ml_baseline / global_baseline:.3f}x")
    
    # Test blending with traditional baseline
    print("\n4. Testing baseline blending...")
    traditional_baseline = 45000  # Example traditional baseline
    blended_baseline = traditional_baseline * 0.6 + ml_baseline * 0.4
    
    print(f"   Traditional baseline: {traditional_baseline:,} views")
    print(f"   ML baseline: {ml_baseline:,.0f} views")
    print(f"   Blended (60% trad + 40% ML): {blended_baseline:,.0f} views")
    
    print(f"\n✅ ML baseline integration test complete!")
    print(f"   The system can now use ML to enhance channel baselines")
    print(f"   when early tracking data is sparse or missing.")

if __name__ == "__main__":
    test_ml_baseline_integration()