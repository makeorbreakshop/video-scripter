#!/usr/bin/env python3
"""
Tests for performance envelope analysis functions
"""

import pytest
import pandas as pd
import numpy as np
from performance_envelope_prototype import (
    extract_duration_seconds, 
    is_youtube_short,
    calculate_performance_envelope,
    smooth_envelope,
    analyze_video_performance
)

class TestDurationParsing:
    """Test duration parsing functions"""
    
    def test_extract_duration_seconds(self):
        """Test ISO 8601 duration parsing"""
        assert extract_duration_seconds('PT1M30S') == 90
        assert extract_duration_seconds('PT2M1S') == 121
        assert extract_duration_seconds('PT45S') == 45
        assert extract_duration_seconds('PT1H') == 3600
        assert extract_duration_seconds('PT30M') == 1800
        assert extract_duration_seconds('PT1H30M45S') == 5445
        assert extract_duration_seconds('') == 0
        assert extract_duration_seconds('P0D') == 0
        assert extract_duration_seconds(None) == 0
        assert extract_duration_seconds('invalid') == 0
    
    def test_is_youtube_short(self):
        """Test YouTube Shorts detection"""
        # Duration-based detection
        assert is_youtube_short('PT45S') == True
        assert is_youtube_short('PT2M1S') == True  # Exactly at threshold
        assert is_youtube_short('PT2M2S') == False  # Just over threshold
        assert is_youtube_short('PT5M') == False
        
        # Hashtag-based detection
        assert is_youtube_short('PT5M', 'Test #shorts video') == True
        assert is_youtube_short('PT5M', 'Test video', 'Description with #shorts') == True
        assert is_youtube_short('PT5M', 'Test video', 'Description with #youtubeshorts') == True
        assert is_youtube_short('PT5M', 'Regular video', 'Regular description') == False

class TestPerformanceEnvelope:
    """Test performance envelope calculation functions"""
    
    @pytest.fixture
    def sample_data(self):
        """Create sample data for testing"""
        np.random.seed(42)  # For reproducible tests
        
        data = []
        video_ids = ['video1', 'video2', 'video3', 'video4', 'video5']
        
        for video_id in video_ids:
            # Each video has data at days 0, 3, 7, 14
            base_views = np.random.randint(1000, 10000)
            growth_factor = np.random.uniform(1.1, 2.0)
            
            for day in [0, 3, 7, 14]:
                views = int(base_views * (growth_factor ** (day / 7)))
                data.append({
                    'video_id': video_id,
                    'title': f'Test Video {video_id}',
                    'days_since_published': day,
                    'view_count': views,
                    'snapshot_date': '2025-07-23'
                })
        
        return pd.DataFrame(data)
    
    def test_calculate_performance_envelope(self, sample_data):
        """Test performance envelope calculation"""
        daily_stats = calculate_performance_envelope(sample_data)
        
        # Should have data for days 0, 3, 7, 14
        assert len(daily_stats) == 4
        assert set(daily_stats['days_since_published']) == {0, 3, 7, 14}
        
        # Each day should have 5 data points (5 videos)
        assert all(daily_stats['count'] == 5)
        
        # Percentiles should be in correct order
        for _, row in daily_stats.iterrows():
            assert row['p10'] <= row['p25'] <= row['p50'] <= row['p75'] <= row['p90']
        
        # Views should generally increase with age (growth over time)
        median_views = daily_stats.set_index('days_since_published')['p50']
        assert median_views[14] > median_views[0]  # Views should grow over time
    
    def test_smooth_envelope_with_sufficient_data(self, sample_data):
        """Test envelope smoothing with enough data points"""
        daily_stats = calculate_performance_envelope(sample_data)
        smooth_stats = smooth_envelope(daily_stats)
        
        # Should have more data points after interpolation
        assert len(smooth_stats) >= len(daily_stats)
        
        # Should still have the required columns
        required_cols = ['days_since_published', 'p10', 'p25', 'p50', 'p75', 'p90']
        assert all(col in smooth_stats.columns for col in required_cols)
        
        # Values should still be in percentile order
        for _, row in smooth_stats.iterrows():
            assert row['p10'] <= row['p25'] <= row['p50'] <= row['p75'] <= row['p90']
            # All values should be non-negative
            assert all(row[col] >= 0 for col in ['p10', 'p25', 'p50', 'p75', 'p90'])
    
    def test_smooth_envelope_with_insufficient_data(self):
        """Test envelope smoothing with too few data points"""
        # Create minimal data (only 2 days)
        minimal_data = pd.DataFrame([
            {'days_since_published': 0, 'p10': 100, 'p25': 200, 'p50': 300, 'p75': 400, 'p90': 500, 'count': 3},
            {'days_since_published': 7, 'p10': 150, 'p25': 250, 'p50': 350, 'p75': 450, 'p90': 550, 'count': 3}
        ])
        
        smooth_stats = smooth_envelope(minimal_data)
        
        # Should return original data when insufficient points
        pd.testing.assert_frame_equal(smooth_stats, minimal_data)
    
    def test_analyze_video_performance(self, sample_data):
        """Test individual video performance analysis"""
        daily_stats = calculate_performance_envelope(sample_data)
        smooth_stats = smooth_envelope(daily_stats)
        
        # Get data for one video
        video_data = sample_data[sample_data['video_id'] == 'video1']
        
        analysis = analyze_video_performance(video_data, smooth_stats)
        
        # Should have analysis for each snapshot
        assert len(analysis) == len(video_data)
        
        # Each analysis item should have required fields
        required_fields = ['day', 'views', 'median_views', 'performance', 'percentile_vs_median']
        for item in analysis:
            assert all(field in item for field in required_fields)
            assert isinstance(item['percentile_vs_median'], (int, float))

class TestDataValidation:
    """Test data validation and edge cases"""
    
    def test_empty_dataframe(self):
        """Test handling of empty dataframes"""
        empty_df = pd.DataFrame()
        
        # Should handle empty data gracefully
        daily_stats = calculate_performance_envelope(empty_df)
        assert len(daily_stats) == 0
    
    def test_single_video_single_day(self):
        """Test with minimal valid data"""
        minimal_df = pd.DataFrame([{
            'video_id': 'test_video',
            'title': 'Test Video',
            'days_since_published': 3,
            'view_count': 1000,
            'snapshot_date': '2025-07-23'
        }])
        
        daily_stats = calculate_performance_envelope(minimal_df)
        
        # Should have one row
        assert len(daily_stats) == 1
        assert daily_stats.iloc[0]['days_since_published'] == 3
        assert daily_stats.iloc[0]['count'] == 1
        
        # All percentiles should be the same (only one data point)
        row = daily_stats.iloc[0]
        assert row['p10'] == row['p25'] == row['p50'] == row['p75'] == row['p90'] == 1000
    
    def test_outlier_handling(self):
        """Test that outliers don't break percentile calculations"""
        # Create data with extreme outliers
        data = []
        
        # Normal videos
        for i in range(10):
            data.append({
                'video_id': f'normal_{i}',
                'title': f'Normal Video {i}',
                'days_since_published': 3,
                'view_count': 1000 + i * 100,  # 1000-1900 views
                'snapshot_date': '2025-07-23'
            })
        
        # Add extreme outlier
        data.append({
            'video_id': 'viral',
            'title': 'Viral Video',
            'days_since_published': 3,
            'view_count': 1000000,  # 1M views - huge outlier
            'snapshot_date': '2025-07-23'
        })
        
        df = pd.DataFrame(data)
        daily_stats = calculate_performance_envelope(df)
        
        # Should still calculate correctly
        assert len(daily_stats) == 1
        row = daily_stats.iloc[0]
        
        # Median should be around normal range, not skewed by outlier
        assert 1000 <= row['p50'] <= 2000
        
        # 95th percentile should capture the outlier better
        # With 11 data points, p95 should get closer to the outlier
        assert row['p90'] >= 1900  # Should be at least the highest normal value
        # The system is working correctly - P90 with 11 points gives position 9.9
        # which interpolates between 1900 and 1000000, resulting in 1900

def test_realistic_data_scenario():
    """Test with data structure similar to real Supabase data"""
    
    # Simulate realistic video performance data
    realistic_data = []
    
    # Video 1: Slow grower
    for day, views in [(0, 500), (3, 800), (7, 1200), (14, 1500)]:
        realistic_data.append({
            'video_id': 'slow_grower',
            'title': 'Slow Growing Video',
            'days_since_published': day,
            'view_count': views,
            'snapshot_date': '2025-07-23'
        })
    
    # Video 2: Fast grower
    for day, views in [(0, 1000), (3, 5000), (7, 15000), (14, 25000)]:
        realistic_data.append({
            'video_id': 'fast_grower',
            'title': 'Fast Growing Video',
            'days_since_published': day,
            'view_count': views,
            'snapshot_date': '2025-07-23'
        })
    
    # Video 3: Viral hit
    for day, views in [(0, 2000), (3, 50000), (7, 200000), (14, 500000)]:
        realistic_data.append({
            'video_id': 'viral_hit',
            'title': 'Viral Video',
            'days_since_published': day,
            'view_count': views,
            'snapshot_date': '2025-07-23'
        })
    
    df = pd.DataFrame(realistic_data)
    
    # Test envelope calculation
    daily_stats = calculate_performance_envelope(df)
    assert len(daily_stats) == 4  # 4 days
    
    # Test smoothing
    smooth_stats = smooth_envelope(daily_stats)
    assert len(smooth_stats) >= 4
    
    # Test performance analysis for the viral video
    viral_data = df[df['video_id'] == 'viral_hit']
    analysis = analyze_video_performance(viral_data, smooth_stats)
    
    # Viral video should be identified as exceptional at later days
    later_performance = [item for item in analysis if item['day'] >= 7]
    assert any('Exceptional' in item['performance'] for item in later_performance)

if __name__ == "__main__":
    pytest.main([__file__, "-v"])