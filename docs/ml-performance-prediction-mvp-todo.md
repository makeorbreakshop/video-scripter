# ML Performance Prediction MVP - Todo Checklist

## Phase 1: Data Preparation (30-45 minutes)

### Backfill Training Data
- [ ] Select 50,000 videos with at least 3 view snapshots spanning 30+ days
- [ ] Filter to videos published 3-12 months ago (complete performance history)
- [ ] Use existing performance curves to interpolate missing days 1-30
- [ ] Calculate performance multiplier for each day (actual/expected)
- [ ] Export as training dataset with columns: video_id, day_n_multiplier (for n=1,3,7,14,30)

### Feature Engineering
- [ ] Extract basic features for each video:
  - [ ] Topic cluster ID (from your 216 clusters)
  - [ ] Format category (from your 12 formats)
  - [ ] Channel subscriber tier (buckets: <10k, 10-100k, 100k-1M, 1M+)
  - [ ] Title length in words
  - [ ] Published day of week
  - [ ] Published hour of day
- [ ] Calculate early performance signals:
  - [ ] Day 1 multiplier (actual/expected)
  - [ ] Day 3 multiplier
  - [ ] Day 7 multiplier
  - [ ] View velocity (day 3-7 growth rate)
- [ ] Add similarity features:
  - [ ] Average performance of 10 most similar videos (by title embedding)
  - [ ] Channel's recent 10-video average multiplier

## Phase 2: Model Development (30-45 minutes)

### Initial Model Training
- [ ] Split data: 70% train, 15% validation, 15% test (by date to avoid leakage)
- [ ] Train XGBoost to predict Day 30 multiplier using Day 1-7 features
- [ ] Measure performance: MAE, RMSE, R²
- [ ] Compare against baseline (always predict 1.0x)
- [ ] Generate SHAP values to understand feature importance

### Model Validation
- [ ] Test on videos from different time periods
- [ ] Validate predictions work across different channel sizes
- [ ] Check for topic-specific biases
- [ ] Create confusion matrix for "hit detection" (>2x performance)

## Phase 3: Pattern Extraction (20-30 minutes)

### Success Pattern Mining
- [ ] Use SHAP to identify top 20 most impactful feature combinations
- [ ] For each pattern, find 10 example videos that match
- [ ] Calculate average performance boost for each pattern
- [ ] Write human-readable pattern descriptions

### Pattern Categories
- [ ] Title patterns (e.g., "I Built" in DIY category = +40%)
- [ ] Timing patterns (e.g., Tuesday 2PM in Tech = +25%)
- [ ] Format/Topic combos (e.g., Tutorial + Woodworking = +60%)
- [ ] Velocity patterns (e.g., 3x by Day 3 usually = 5x by Day 30)

## Phase 4: Simple API Endpoint (20-30 minutes)

### Prediction Endpoint
- [ ] Create `/api/ml/predict-performance` endpoint
- [ ] Input: title, topic, format, channel_id, planned_publish_time
- [ ] Process: Generate features, run model, return prediction
- [ ] Output: 
  - [ ] Predicted Day 30 multiplier
  - [ ] Confidence interval
  - [ ] Top 3 similar videos with their performance
  - [ ] 2-3 relevant success patterns

### Testing
- [ ] Test with 100 random historical videos
- [ ] Verify predictions match actual performance reasonably
- [ ] Check response time (<500ms)

## Phase 5: Basic UI Test Page (30-45 minutes)

### Creator Input Form
- [ ] Title input field
- [ ] Topic dropdown (from your 216 clusters)
- [ ] Format dropdown (from your 12 formats)
- [ ] Channel search/select
- [ ] Planned publish date/time picker

### Results Display
- [ ] Predicted performance score (0.5x - 3x baseline)
- [ ] Visual performance curve showing expected trajectory
- [ ] "Why this prediction" section with top factors
- [ ] 3 similar successful videos as examples
- [ ] 2-3 specific improvement suggestions

### Quick Experiments
- [ ] A/B test different title variations
- [ ] Try different publish times
- [ ] Compare different format approaches

## Phase 6: Validation & Iteration (20-30 minutes)

### Real Creator Testing
- [ ] Find 5-10 creators with 50+ videos
- [ ] Have them test predictions on their recent videos
- [ ] Compare predictions to actual performance
- [ ] Gather feedback on suggestion quality

### Performance Metrics
- [ ] Track prediction accuracy over time
- [ ] Measure which patterns actually work
- [ ] Identify where model fails (edge cases)

## Success Criteria

- [ ] Model beats baseline by 30%+ on RMSE
- [ ] Can detect "hits" (>2x) with 70%+ precision
- [ ] Generates actionable suggestions, not generic advice
- [ ] Processes predictions in <500ms
- [ ] Creators say "this actually makes sense" 

## Quick Implementation Notes

### Key Tables/Views to Use
- `view_snapshots` - Raw performance data
- `video_performance_trends` - Materialized view with calculations
- `videos` - Metadata, topics, formats
- `baseline_analytics` - Channel baselines

### Python Libraries Needed
- `xgboost` - Main ML model
- `shap` - Feature importance
- `scikit-learn` - Data splitting, metrics
- `pandas` - Data manipulation
- `numpy` - Numerical operations

### Critical Decisions
1. Use log-transformed views for better model behavior
2. Cap multipliers at 10x to avoid outlier influence
3. Weight recent videos more heavily in patterns
4. Start with classification (hit/miss) before regression

## Total Timeline: 3-4 hours with Claude Code assistance