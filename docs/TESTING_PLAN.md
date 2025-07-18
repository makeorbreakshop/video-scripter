# Title Generation System - Comprehensive Testing Plan

## Overview
This document outlines a systematic testing approach for the pool-and-cluster title generation system. All tests should be automated and runnable via command line.

## Current Issues to Address
1. **Pinecone Connection Issues**
   - "undefined vectors" in logs
   - Multiple redundant connections (78 connections for 78 queries)
   - Potential memory leaks from unclosed connections

2. **Data Flow Issues**
   - Embeddings not properly passed through the pipeline
   - WIDE vs DEEP pattern classification inconsistencies
   - Performance ratio calculations potentially incorrect

3. **API Performance**
   - Slow response times (30-35 seconds)
   - Excessive API calls to OpenAI/Pinecone
   - No caching mechanism

## Testing Framework Setup

### 1. Install Testing Dependencies
```bash
npm install --save-dev jest @types/jest ts-jest @testing-library/react @testing-library/jest-dom
npm install --save-dev @supabase/supabase-js @pinecone-database/pinecone
npm install --save-dev msw # For mocking API calls
```

### 2. Jest Configuration
Create `jest.config.js`:
```javascript
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/__tests__/**/*.ts', '**/?(*.)+(spec|test).ts'],
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
  setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],
};
```

## Test Categories

### 1. Unit Tests

#### A. Pinecone Service Tests (`tests/unit/pinecone-service.test.ts`)
```typescript
describe('PineconeService', () => {
  it('should initialize only once for concurrent requests');
  it('should handle missing vector count gracefully');
  it('should return embeddings with search results');
  it('should filter results by minimum score');
  it('should handle pagination correctly');
  it('should gracefully handle connection failures');
  it('should clean up connections properly');
});
```

#### B. DBSCAN Clustering Tests (`tests/unit/dbscan.test.ts`)
```typescript
describe('DBSCAN Clustering', () => {
  it('should cluster videos with 85% similarity correctly');
  it('should identify WIDE patterns (3+ threads)');
  it('should identify DEEP patterns (1-2 threads)');
  it('should handle noise points');
  it('should fall back to title-based clustering when no embeddings');
  it('should calculate cosine similarity correctly');
});
```

#### C. Pattern Discovery Tests (`tests/unit/pattern-discovery.test.ts`)
```typescript
describe('Pattern Discovery', () => {
  it('should generate 15 diverse threads with 6 queries each');
  it('should expand threads with correct angles and intents');
  it('should discover patterns using OpenAI structured outputs');
  it('should handle Zod schema validation');
  it('should aggregate patterns from multiple clusters');
});
```

#### D. Quality Filtering Tests (`tests/unit/quality-filter.test.ts`)
```typescript
describe('Quality-Based Filtering', () => {
  it('should filter patterns by performance threshold');
  it('should filter patterns by confidence score');
  it('should filter patterns by sample size');
  it('should balance WIDE and DEEP patterns');
  it('should respect maximum suggestion limit');
});
```

### 2. Integration Tests

#### A. API Endpoint Tests (`tests/integration/api.test.ts`)
```typescript
describe('Title Generation API', () => {
  it('should handle valid concept input');
  it('should return proper error for missing concept');
  it('should complete within 60 seconds');
  it('should return WIDE and DEEP patterns');
  it('should include debug information');
  it('should handle rate limiting gracefully');
});
```

#### B. Database Integration Tests (`tests/integration/database.test.ts`)
```typescript
describe('Database Integration', () => {
  it('should fetch video metadata correctly');
  it('should calculate performance ratios accurately');
  it('should handle missing channel baselines');
  it('should filter out YouTube Shorts');
  it('should batch fetch videos efficiently');
});
```

### 3. End-to-End Tests

#### A. Full Pipeline Test (`tests/e2e/pipeline.test.ts`)
```typescript
describe('Complete Title Generation Pipeline', () => {
  it('should generate titles for "woodworking tools" concept');
  it('should show WIDE patterns in UI');
  it('should display debug panel correctly');
  it('should handle error states gracefully');
});
```

### 4. Performance Tests

#### A. Load Tests (`tests/performance/load.test.ts`)
```typescript
describe('Performance Tests', () => {
  it('should handle 10 concurrent requests');
  it('should maintain <5s response time under load');
  it('should not leak memory over 100 requests');
  it('should reuse Pinecone connections efficiently');
});
```

## Test Data Setup

### 1. Mock Data (`tests/fixtures/`)
- `embeddings.json` - Sample 512D embeddings
- `videos.json` - Sample video metadata
- `patterns.json` - Expected pattern outputs
- `clusters.json` - Sample cluster data

### 2. Environment Setup (`tests/.env.test`)
```env
PINECONE_API_KEY=test-key
PINECONE_INDEX_NAME=test-index
OPENAI_API_KEY=test-key
NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=test-key
```

## Automated Test Runner Script

Create `scripts/run-tests.ts`:
```typescript
#!/usr/bin/env ts-node

import { execSync } from 'child_process';
import chalk from 'chalk';

const testSuites = [
  { name: 'Unit Tests', command: 'jest tests/unit --coverage' },
  { name: 'Integration Tests', command: 'jest tests/integration' },
  { name: 'E2E Tests', command: 'jest tests/e2e' },
  { name: 'Performance Tests', command: 'jest tests/performance' },
];

console.log(chalk.blue('🧪 Running Comprehensive Test Suite\n'));

let allPassed = true;

for (const suite of testSuites) {
  console.log(chalk.yellow(`Running ${suite.name}...`));
  try {
    execSync(suite.command, { stdio: 'inherit' });
    console.log(chalk.green(`✅ ${suite.name} passed\n`));
  } catch (error) {
    console.log(chalk.red(`❌ ${suite.name} failed\n`));
    allPassed = false;
  }
}

if (allPassed) {
  console.log(chalk.green('🎉 All tests passed!'));
  process.exit(0);
} else {
  console.log(chalk.red('💥 Some tests failed!'));
  process.exit(1);
}
```

## Debugging Checklist

### 1. Pinecone Issues
- [ ] Check Pinecone index stats structure
- [ ] Verify API key is valid
- [ ] Confirm index exists and is accessible
- [ ] Check vector dimensions match (512D)
- [ ] Verify includeValues flag is set

### 2. Pattern Discovery Issues
- [ ] Verify OpenAI API key is valid
- [ ] Check Zod schema matches expected output
- [ ] Confirm thread expansion returns 15 threads
- [ ] Verify each thread has 5-6 queries
- [ ] Check cluster_info is passed to UI

### 3. Performance Issues
- [ ] Profile API route execution time
- [ ] Check for N+1 database queries
- [ ] Verify Promise.all() is used for parallel operations
- [ ] Check for memory leaks in long-running processes
- [ ] Monitor API rate limits

## Continuous Monitoring

### 1. Create Health Check Endpoint (`/api/health`)
```typescript
export async function GET() {
  const checks = {
    pinecone: await checkPineconeConnection(),
    supabase: await checkSupabaseConnection(),
    openai: await checkOpenAIConnection(),
    memory: process.memoryUsage(),
    uptime: process.uptime(),
  };
  
  return NextResponse.json(checks);
}
```

### 2. Logging Strategy
- Use structured logging with correlation IDs
- Log all API calls with timing information
- Track error rates and types
- Monitor pattern quality metrics

## Test Execution Plan

### Phase 1: Setup (Day 1)
1. Install testing frameworks
2. Create test directory structure
3. Set up mock services
4. Create test fixtures

### Phase 2: Unit Tests (Day 2-3)
1. Write Pinecone service tests
2. Write DBSCAN algorithm tests
3. Write pattern discovery tests
4. Write quality filtering tests

### Phase 3: Integration Tests (Day 4)
1. Write API endpoint tests
2. Write database integration tests
3. Set up test database

### Phase 4: E2E & Performance (Day 5)
1. Write end-to-end tests
2. Write performance tests
3. Create load testing scenarios

### Phase 5: CI/CD Integration (Day 6)
1. Set up GitHub Actions workflow
2. Configure test reporting
3. Set up code coverage tracking

## Success Criteria

1. **All tests pass** with >80% code coverage
2. **API response time** <5 seconds for 95% of requests
3. **Memory usage** stable over 1000 requests
4. **Error rate** <1% in production
5. **WIDE patterns** correctly identified and displayed
6. **No redundant connections** to external services

## Next Steps

1. Start with fixing the immediate Pinecone connection issue
2. Implement unit tests for core algorithms
3. Add integration tests for the full pipeline
4. Set up continuous testing in CI/CD
5. Monitor production performance metrics

---

**Note**: Update this document as new issues are discovered or testing strategies evolve.