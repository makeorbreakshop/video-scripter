# Performance Calculation Update: Rolling Year Baseline

## Overview
Updated the performance score calculation to use a rolling historical baseline instead of a fixed 12-month current average.

## Previous Method (Problems)
```sql
-- All videos compared to channel's CURRENT 12-month average
WHERE v.published_at >= NOW() - INTERVAL '12 months'
```

**Issues:**
- A video from 2022 compared to 2024 performance data
- Unfair to older videos from when channel was smaller
- Doesn't account for channel growth over time

## New Method (Rolling Year Baseline)
```sql
-- Each video compared to the previous year of videos from THAT channel
LEFT JOIN videos historical ON (
  historical.channel_id = target.channel_id
  AND historical.published_at BETWEEN 
    target.published_at - INTERVAL '1 year'
    AND target.published_at - INTERVAL '1 day'
)
```

## How It Works

### Established Channels
- **Video published**: March 2024
- **Baseline period**: March 2023 - February 2024
- **Comparison**: Video views ÷ average of previous year

### Newer Channels  
- **Video published**: March 2024
- **Channel started**: October 2023  
- **Baseline period**: October 2023 - February 2024 (whatever exists)
- **Comparison**: Video views ÷ average of available history

### Brand New Channels
- **First video**: No baseline (performance_ratio = NULL)
- **Second video**: Baseline = first video only
- **Third video**: Baseline = average of first two videos
- **Grows naturally over time**

## Benefits

✅ **Historically Fair**: Each video compared to its contemporary performance  
✅ **Growth-Aware**: Accounts for channel evolution over time  
✅ **Self-Adjusting**: Automatically handles all channel ages  
✅ **Simple Logic**: No complex hybrid approaches needed  
✅ **Intuitive**: "How did this video do vs the previous year?"

## Edge Cases Handled

1. **NULL Performance**: New channels with no history show NULL (not 0%)
2. **Shorts Filtering**: Excludes shorts from both target and baseline calculations  
3. **Sort Handling**: NULL performance ratios sorted last
4. **Performance Filters**: Only apply to videos with valid baselines

## Database Changes

- Updated `get_packaging_performance()` function
- Added `NULLS LAST` to sort handling
- Enhanced CTE structure for rolling baselines
- Maintained existing API interface

## UI Impact

- Channel averages now show the rolling historical average used for that specific video
- Videos without baselines show "N/A" or similar indicator
- Performance badges only appear for videos with valid baselines

## Testing

Run the updated function and verify:
1. Older videos have reasonable performance scores
2. New channels handle NULL gracefully  
3. Performance filters work correctly
4. Sorting handles NULL values properly

## Implementation

1. Run the SQL migration: `sql/update_packaging_performance_rolling_year.sql`
2. Test the function with sample data
3. Deploy to production after verification