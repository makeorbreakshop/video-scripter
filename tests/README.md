# Pattern Discovery Test Suite

Comprehensive testing framework for the pattern discovery system.

## Test Structure

### 1. Unit Tests (`/tests/unit-tests/`)
- **Pattern Analyzer Tests**: Tests each individual analyzer in isolation
- **Mock Data**: Uses controlled test data fixtures
- **Coverage**: Title, Structure, Format, Duration, Timing, Topic analyzers

### 2. Integration Tests (`/tests/integration-tests/`)
- **API Integration Tests**: Tests all API endpoints with real server
- **End-to-End Flows**: Complete request/response cycles
- **Error Handling**: Invalid inputs, edge cases, performance

### 3. Full System Tests (`/tests/pattern-discovery-test-suite.js`)
- **Environment Setup**: Database, API keys, connections
- **Complete Workflow**: Discovery → Validation → Storage
- **Performance Testing**: Large datasets, concurrent requests
- **Edge Cases**: Empty data, malformed inputs

## Running Tests

### Quick Tests
```bash
# Simple pattern discovery test
npm run test:patterns

# Unit tests only
npm run test:patterns:unit

# API integration tests only
npm run test:patterns:api

# Full comprehensive test suite
npm run test:patterns:full
```

### Complete Test Suite
```bash
# Run all tests in sequence
npm run test:patterns:all
```

## Test Data

### Mock Video Data
- **Title Patterns**: Videos with "beginner", "how to", etc.
- **Structure Patterns**: Various word counts, punctuation
- **Duration Patterns**: Different video lengths (5min, 15min, 45min)
- **Timing Patterns**: Different publishing days
- **Format Patterns**: Tutorial, listicle, repair, transformation

### Real Data Testing
- Uses actual database content for integration tests
- Filters for high-quality test samples
- Respects performance thresholds

## Expected Results

### Unit Tests
- ✅ **Title Pattern Analyzer**: Finds n-gram patterns like "beginner"
- ✅ **Structure Analyzer**: Detects word count and punctuation patterns
- ✅ **Format Analyzer**: Identifies format performance differences
- ✅ **Duration Analyzer**: Finds optimal video length ranges
- ✅ **Timing Analyzer**: Discovers best publishing days
- ✅ **Topic Analyzer**: Analyzes topic-specific patterns

### Integration Tests
- ✅ **Pattern List API**: Returns paginated pattern results
- ✅ **Pattern Discovery API**: Creates new patterns from data
- ✅ **Pattern Prediction API**: Predicts video performance
- ✅ **Error Handling**: Graceful handling of invalid inputs
- ✅ **Performance**: Response times under thresholds

### Full System Tests
- ✅ **Environment Setup**: All APIs and databases connected
- ✅ **Database Schema**: Required tables and columns present
- ✅ **Pattern Discovery**: End-to-end pattern creation
- ✅ **Pattern Storage**: Successful database persistence
- ✅ **Worker Functionality**: Background processing works

## Test Reports

Each test suite generates detailed reports with:
- **Pass/Fail Counts**: Total, passed, failed, warnings
- **Performance Metrics**: Response times, processing duration
- **Error Details**: Specific failure messages and data
- **Recommendations**: Next steps based on results

## Troubleshooting

### Common Issues

1. **Database Connection Errors**
   - Check `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`
   - Verify database tables exist (run SQL scripts)

2. **API Connection Errors**
   - Check `OPENAI_API_KEY` and `PINECONE_API_KEY`
   - Verify API quotas and limits

3. **Test Data Issues**
   - Ensure videos table has required columns
   - Check for sufficient test data (30+ videos per cluster)

4. **Worker Test Failures**
   - Verify worker files are in correct locations
   - Check for proper error handling in worker code

### Debug Mode
Add `console.log` statements in test files to debug specific issues:
```javascript
console.log('Debug:', { testData, response, error });
```

## CI/CD Integration

These tests are designed to be run in CI/CD pipelines:
- **Exit Codes**: Non-zero exit codes on failures
- **JSON Reports**: Machine-readable output available
- **Environment Variables**: All configuration via env vars
- **Timeout Handling**: Tests complete within reasonable time limits

## Performance Benchmarks

### Expected Performance
- **Unit Tests**: < 30 seconds total
- **API Tests**: < 2 minutes total
- **Full System Tests**: < 5 minutes total
- **Pattern Discovery**: < 30 seconds per 1000 videos

### Thresholds
- **API Response Time**: < 3 seconds
- **Database Queries**: < 1 second
- **Pattern Processing**: < 10 seconds per analyzer
- **Memory Usage**: < 500MB during tests