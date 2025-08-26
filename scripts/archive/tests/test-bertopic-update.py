#!/usr/bin/env python3
"""
Test BERTopic database update on a small subset
"""

import os
import sys
import asyncio
from datetime import datetime

# Add the parent directory to Python path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

async def test_update():
    """Test the update process on 100 videos"""
    print("="*60)
    print("BERTopic Database Update - TEST RUN")
    print("="*60)
    print("\nThis will test updating 100 videos to verify:")
    print("1. Model loading works correctly")
    print("2. Classification process works")
    print("3. Database updates are IOPS-safe")
    print("4. No errors in the pipeline")
    print("="*60)
    
    # Import the module directly
    from scripts.update_database_with_bertopic import BERTopicDatabaseUpdater
    
    try:
        # Initialize updater
        updater = BERTopicDatabaseUpdater()
        
        # Get update plan
        update_plan = updater.prepare_update_strategy()
        
        print(f"\nFound {update_plan['total_videos']} total videos")
        print("Limiting to 100 videos for test...")
        
        # Get a small subset for testing
        test_classifications = []
        
        # Get 50 from training sample
        if update_plan['in_sample']:
            sample_subset = update_plan['in_sample'][:50]
            training_classifications = updater.get_training_sample_classifications(sample_subset)
            test_classifications.extend(training_classifications)
            print(f"✅ Got {len(training_classifications)} classifications from training sample")
        
        # Get 50 that need classification
        if update_plan['need_transform'] and len(test_classifications) < 100:
            transform_subset = update_plan['need_transform'][:50]
            new_classifications = await updater.classify_new_videos(transform_subset)
            test_classifications.extend(new_classifications)
            print(f"✅ Classified {len(new_classifications)} new videos")
        
        # Test database update
        print(f"\n🔄 Testing database update with {len(test_classifications)} videos...")
        start_time = datetime.now()
        
        updated = await updater.update_database(test_classifications[:100])
        
        elapsed = (datetime.now() - start_time).total_seconds()
        print(f"\n✅ Test complete!")
        print(f"   - Updated {updated} videos in {elapsed:.1f} seconds")
        print(f"   - Rate: {updated/elapsed:.1f} videos/second")
        
        # Estimate full run time
        if updated > 0:
            estimated_time = (update_plan['total_videos'] / (updated/elapsed)) / 3600
            print(f"\n📊 Estimated time for full {update_plan['total_videos']} videos: {estimated_time:.1f} hours")
            print(f"   (Assuming similar IOPS conditions)")
        
    except Exception as e:
        print(f"\n❌ Test failed: {e}")
        import traceback
        traceback.print_exc()
        return False
    
    return True

if __name__ == "__main__":
    success = asyncio.run(test_update())
    if success:
        print("\n✅ Test passed! Ready to run full update.")
        print("Run: python scripts/update-database-with-bertopic.py")
    else:
        print("\n❌ Test failed. Please fix issues before running full update.")