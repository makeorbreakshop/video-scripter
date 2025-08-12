# Idea Heist Agentic Mode - Testing Guide

## 🧪 Testing Overview

The agentic mode includes comprehensive testing tools to verify functionality at every level.

---

## Quick Start Testing

### 1. Mock Test (No API Keys Required)
```bash
npm run test:agentic:mock
```
- Tests all components with mock data
- Verifies code structure and flow
- No external dependencies needed
- Perfect for development testing

### 2. Basic Test (With API Keys)
```bash
npm run test:agentic [VIDEO_ID]
```
- Tests with minimal budget
- Uses real OpenAI API
- Connects to real databases
- Good for quick verification

### 3. Comprehensive Test Suite
```bash
npm run test:agentic:full
```
- Full system validation
- Configuration checks
- Database connectivity tests
- Tool execution tests
- Performance benchmarks
- Edge case handling

### 4. API Endpoint Test
```bash
./scripts/test-agentic-api.sh [VIDEO_ID]
```
- Tests REST API directly
- Validates request/response
- Checks error handling
- Optional real video testing

---

## Test Scripts Available

### **1. test-agentic-mock.ts**
Mock testing without external dependencies:
- Tool registry validation (18 tools)
- Budget tracker testing
- Session manager testing
- Full pipeline with mock data

**Output Example:**
```
✅ Tool Registry: 18 tools registered
✅ Budget Tracker: Enforcement working
✅ Session Manager: State management OK
✅ Mock Pipeline: Analysis complete
```

### **2. test-agentic-mode.ts**
Basic integration test with real APIs:
- Configuration verification
- Single video analysis
- Budget tracking
- Performance metrics

**Usage:**
```bash
# Test with default video
npm run test:agentic

# Test with specific video
npm run test:agentic abc123

# Save results to file
npm run test:agentic abc123 --save
```

### **3. test-agentic-comprehensive.ts**
Full test suite covering:
1. **Configuration Tests**
   - API key validation
   - Environment setup
   - Service availability

2. **Database Tests**
   - Supabase connectivity
   - Pinecone connectivity
   - Query performance

3. **Tool Tests**
   - Individual tool execution
   - Parameter validation
   - Error handling

4. **OpenAI Tests**
   - Hypothesis generation
   - Validation processing
   - Report generation

5. **Pipeline Tests**
   - Full analysis flow
   - Budget enforcement
   - Model switching

6. **Edge Cases**
   - Non-existent videos
   - Budget exceeded scenarios
   - Timeout handling

7. **Performance Tests**
   - Response time (<30s)
   - Memory usage (<100MB)
   - Concurrent requests

**Output:**
- Detailed test results
- Pass/fail statistics
- Performance metrics
- JSON report saved to `/data/`

### **4. test-agentic-api.sh**
Shell script for API testing:
```bash
# Basic API test
./scripts/test-agentic-api.sh

# Test with real video
./scripts/test-agentic-api.sh VIDEO_ID
```

Tests:
- GET /api/idea-heist/agentic (status)
- POST validation errors
- Mock video processing
- Real video analysis

---

## Testing Strategy

### Development Testing
1. Run mock tests first: `npm run test:agentic:mock`
2. Fix any code issues
3. Test with minimal config

### Integration Testing
1. Set up environment variables
2. Run basic test: `npm run test:agentic`
3. Check all 18 tools work
4. Verify pattern generation

### Production Testing
1. Run comprehensive suite: `npm run test:agentic:full`
2. Test with multiple videos
3. Monitor costs and performance
4. Check error recovery

---

## Expected Test Results

### ✅ Successful Test
```json
{
  "success": true,
  "mode": "agentic",
  "pattern": {
    "statement": "Videos with X achieve Y performance",
    "confidence": 0.75,
    "validations": 10
  },
  "metrics": {
    "totalDurationMs": 15000,
    "totalTokens": 10000,
    "totalCost": 0.15,
    "toolCallCount": 15
  }
}
```

### ⚠️ Common Issues

**1. Missing API Keys**
```
❌ OpenAI API key not configured
Solution: Add OPENAI_API_KEY to .env
```

**2. Database Connection Failed**
```
❌ Supabase connection failed
Solution: Check SUPABASE_SERVICE_ROLE_KEY
```

**3. Budget Exceeded**
```
⚠️ Budget exceeded, moving to finalization
Solution: This is normal - system handles gracefully
```

**4. Video Not Found**
```
❌ Video not found in database
Solution: Use a valid video ID from your database
```

---

## Performance Benchmarks

### Target Metrics
- **Analysis Time**: 15-30 seconds
- **Token Usage**: 10,000-50,000
- **Cost per Analysis**: $0.10-$0.30
- **Tool Calls**: 10-30
- **Success Rate**: >95%

### Current Performance (Mock)
- **Analysis Time**: <1 second
- **Token Usage**: 2,500
- **Tool Calls**: 2
- **Memory Usage**: ~50MB

---

## Debugging Tips

### 1. Enable Verbose Logging
```typescript
const result = await runIdeaHeistAgent(videoId, {
  telemetryEnabled: true,
  // ... other options
});
```

### 2. Check Individual Tools
```bash
# Test specific tool endpoint
curl -X POST http://localhost:3000/api/tools/get-video-bundle \
  -H "Content-Type: application/json" \
  -d '{"video_id": "test123"}'
```

### 3. Monitor Budget Usage
The system logs budget usage at each step:
```
[WARN] Budget exceeded: tokens 10001 > 10000
[INFO] Moving to finalization
```

### 4. Save Test Results
```bash
# Save detailed results for debugging
npm run test:agentic VIDEO_ID --save
# Results saved to: data/agentic-test-TIMESTAMP.json
```

---

## CI/CD Integration

### GitHub Actions
```yaml
name: Test Agentic Mode
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-node@v2
      - run: npm install
      - run: npm run test:agentic:mock
      - run: npm run test:agentic:full
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
          PINECONE_API_KEY: ${{ secrets.PINECONE_API_KEY }}
```

---

## Test Coverage Goals

- **Unit Tests**: 80% coverage
- **Integration Tests**: All 18 tools
- **API Tests**: All endpoints
- **Edge Cases**: 10+ scenarios
- **Performance**: <30s analysis

---

## Next Steps

1. **Run Mock Test**: Verify code works
2. **Configure APIs**: Add keys to .env
3. **Run Full Suite**: Test everything
4. **Monitor Results**: Check quality
5. **Deploy**: Add UI toggle

---

*Last updated: January 11, 2025*