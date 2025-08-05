# ML Performance Prediction MVP - Todo Checklist (Refined)

## Phase 1: Data Preparation (30-45 minutes)

### Backfill Training Data
- [ ] Select 25,000 videos with at least 3 view snapshots spanning 30+ days (reduced from 50K for faster iteration)
- [ ] Filter to videos published 3-12 months ago (complete performance history)
- [ ] Keep raw snapshots, interpolate on-demand using existing performance curves
- [ ] Calculate log-space multipliers: log(actual) - log(expected) for stability
- [ ] Export as training dataset with columns: video_id, day_n_log_multiplier (for n=1,3,7,14,30)

### Feature Engineering
- [ ] Extract basic features for each video:
  - [ ] Topic cluster ID (from your 216 clusters)
  - [ ] Format category (from your 12 formats)
  - [ ] Channel subscriber count (continuous) OR day-0 expected views as proxy
  - [ ] Title length in words
  - [ ] Published day of week
  - [ ] Published hour of day (keep categorical for interpretability)
- [ ] Calculate early performance signals:
  - [ ] Day 1 log multiplier
  - [ ] Day 3 log multiplier
  - [ ] Day 7 log multiplier
  - [ ] View velocity (day 3-7 growth rate)
- [ ] Add channel-level features:
  - [ ] Channel's baseline performance tier (from your 6-tier system)
  - [ ] Channel's recent 10-video average multiplier
  - [ ] Skip title similarity for V1 (add in V2)

## Phase 2: Model Development (30-45 minutes)

### Initial Model Training
- [ ] Split data by upload month for temporal validation (prevents leakage)
- [ ] Train XGBoost to predict Day 30 log multiplier using Day 1-7 features
- [ ] Enable early stopping (50 rounds) to prevent overfitting
- [ ] Measure performance: MAE, RMSE, R², and SMAPE (symmetric % error)
- [ ] Compare against baseline (always predict 0.0 in log space = 1.0x multiplier)
- [ ] Generate SHAP values at cluster level (not per-video) for efficiency

### Model Validation
- [ ] Test on videos from different time periods using your 6-tier system
- [ ] Validate predictions work across different channel sizes
- [ ] Check for topic-specific biases across your 216 clusters
- [ ] Create confusion matrix for "hit detection" (>2x performance)
- [ ] Add prediction caps at mean ± 3σ to prevent absurd multipliers

## Phase 3: Pattern Extraction (20-30 minutes)

### Success Pattern Mining
- [ ] Generate SHAP summaries once per topic cluster (216 total, not 25K individual)
- [ ] Convert top SHAP interactions to auto-generated if-then rules
- [ ] For each pattern, find 5-10 example videos that match
- [ ] Calculate average performance boost for each pattern
- [ ] Auto-generate pattern descriptions (no manual write-ups)

### Pattern Categories
- [ ] Title patterns (e.g., "IF topic=CNC_Tutorials AND title_len<7 THEN +0.42 log-views")
- [ ] Timing patterns (e.g., "IF format=Tutorial AND day=Tuesday AND hour=14 THEN +0.25")
- [ ] Format/Topic combos (e.g., "IF format=Tutorial AND topic=Woodworking THEN +0.60")
- [ ] Velocity patterns (e.g., "IF day3_multiplier>0.48 THEN day30_multiplier>0.70")
- [ ] Channel tier patterns (using your 6-tier baseline system)

## Phase 4: Simple API Endpoint (20-30 minutes)

### Prediction Endpoint
- [ ] Create `/api/ml/predict-performance` endpoint
- [ ] Cache model and channel baselines in memory at startup
- [ ] Input: title, topic, format, channel_id, planned_publish_time
- [ ] Process: Generate features, run model, return prediction
- [ ] Output: 
  - [ ] Predicted Day 30 log multiplier AND raw multiplier (0.5x-3x)
  - [ ] Confidence interval
  - [ ] Top 3 similar videos (use topic cluster, not embeddings for V1)
  - [ ] 2-3 relevant success patterns from SHAP rules
  - [ ] NaN guard for missing early-day snapshots

### Testing
- [ ] Test with 100 random historical videos
- [ ] Verify predictions match actual performance reasonably
- [ ] Check response time (<100ms with cached model)

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

### Rollout Strategy
- [ ] Silent test on your own channel for 3 days first
- [ ] Then launch as "Beta Predictions" with clear labeling
- [ ] Track feedback as labeled data for future improvements

### Real Creator Testing
- [ ] Start with 5-10 creators with 50+ videos
- [ ] Have them test predictions on their recent videos
- [ ] Compare predictions to actual performance
- [ ] Log "helpful" vs "missed" feedback for reinforcement

### Performance Metrics
- [ ] Track prediction accuracy over time
- [ ] Measure which patterns actually work
- [ ] Identify where model fails (edge cases)
- [ ] Version every model with unique ID for instant rollback

## Phase 7: Essential Testing (20-30 minutes)

### Core Tests
- [ ] Create `test_ml_predictions.py`:
  - [ ] Test log-space multiplier calculations don't produce NaN/inf
  - [ ] Test model predictions stay within 0.1x-10x range
  - [ ] Test API endpoint with 10 real examples
  - [ ] Test handling of missing view snapshots

### Stress Test
- [ ] Simple load test: 100 concurrent requests
- [ ] Verify <100ms response time with cached model
- [ ] Check memory usage stays stable

### Sanity Checks
- [ ] Verify no future data in training set
- [ ] Test prediction for a known "hit" video (should predict >2x)
- [ ] Test prediction for average video (should predict ~1x)

## Success Criteria

- [ ] Model beats baseline by 30%+ on RMSE
- [ ] Can detect "hits" (>2x) with 70%+ precision
- [ ] Generates actionable suggestions, not generic advice
- [ ] Processes predictions in <500ms
- [ ] Creators say "this actually makes sense"
- [ ] All tests pass with >95% coverage
- [ ] No memory leaks under sustained load 

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

### Critical Decisions (Updated)
1. Use log-space multipliers: log(actual) - log(expected)
2. Start with 25K videos for faster iteration
3. Keep raw snapshots, interpolate on-demand
4. Cache model in memory for <100ms response
5. Month-based cross-validation to prevent temporal leakage
6. SHAP at cluster level (216) not individual videos (25K)
7. Silent test for 3 days, then "Beta" label
8. Version all models for instant rollback

### Key Advantages You Have
- 187K videos with snapshots (3.7 avg per video)
- Existing performance curves for backfilling
- 216 topic clusters as fast similarity proxy
- 6-tier tracking system for natural data splits
- Channel baselines already calculated

## Total Timeline: 3-4 hours with Claude Code assistance