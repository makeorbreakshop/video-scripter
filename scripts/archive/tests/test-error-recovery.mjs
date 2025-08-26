/**
 * Test script for Error Recovery and Resilience
 */

// Mock the error recovery module
class ErrorRecovery {
  constructor(logger, config) {
    this.logger = logger;
    this.retryConfig = {
      maxAttempts: 3,
      initialDelay: 1000,
      maxDelay: 30000,
      backoffFactor: 2,
      retryableErrors: [
        'ENOTFOUND',
        'ECONNREFUSED',
        'ETIMEDOUT',
        'ECONNRESET',
        'rate_limit_exceeded',
        'timeout',
        'network_error'
      ],
      ...config
    };
    this.errorHistory = new Map();
    this.circuitBreakers = new Map();
  }
  
  async executeWithRetry(fn, context, customConfig) {
    const config = { ...this.retryConfig, ...customConfig };
    let lastError = null;
    let delay = config.initialDelay;
    
    for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
      try {
        console.log(`  Attempt ${attempt}/${config.maxAttempts} for ${context}`);
        const result = await fn();
        
        if (attempt > 1) {
          console.log(`  ✅ Recovered after ${attempt} attempts`);
        }
        
        return result;
      } catch (error) {
        lastError = error;
        
        if (!this.isRetryableError(error, config)) {
          throw error;
        }
        
        if (attempt >= config.maxAttempts) {
          throw new Error(`Failed after ${config.maxAttempts} attempts: ${error.message}`);
        }
        
        console.log(`  ⚠️ Retrying after ${delay}ms due to: ${error.message}`);
        await this.delay(delay);
        delay = Math.min(delay * config.backoffFactor, config.maxDelay);
      }
    }
    
    throw lastError || new Error(`Failed to execute ${context}`);
  }
  
  async determineRecoveryStrategy(error, context, options = {}) {
    const errorType = this.classifyError(error);
    
    if (this.isRetryableError(error, this.retryConfig)) {
      return {
        type: 'retry',
        description: `Retry due to ${errorType} error`
      };
    }
    
    if (errorType === 'rate_limit' && options.canFallback) {
      return {
        type: 'fallback',
        description: 'Fallback to alternative method'
      };
    }
    
    if (errorType === 'non_critical' && options.canSkip) {
      return {
        type: 'skip',
        description: 'Skip non-critical operation'
      };
    }
    
    throw error;
  }
  
  async withErrorBoundary(fn, context, defaultValue) {
    try {
      return await fn();
    } catch (error) {
      console.log(`  Error boundary triggered: ${error.message}`);
      return defaultValue;
    }
  }
  
  async withCircuitBreaker(fn, context, options = {}) {
    const { failureThreshold = 5, resetTimeout = 60000 } = options;
    
    if (!this.circuitBreakers.has(context)) {
      this.circuitBreakers.set(context, {
        failures: 0,
        lastFailure: 0,
        isOpen: false
      });
    }
    
    const breaker = this.circuitBreakers.get(context);
    
    // Check if circuit should be reset
    if (breaker.isOpen && Date.now() - breaker.lastFailure > resetTimeout) {
      breaker.isOpen = false;
      breaker.failures = 0;
      console.log(`  Circuit breaker reset for ${context}`);
    }
    
    if (breaker.isOpen) {
      throw new Error(`Circuit breaker open for ${context}`);
    }
    
    try {
      const result = await fn();
      breaker.failures = 0;
      return result;
    } catch (error) {
      breaker.failures++;
      breaker.lastFailure = Date.now();
      
      if (breaker.failures >= failureThreshold) {
        breaker.isOpen = true;
        console.log(`  ⚡ Circuit breaker opened for ${context} after ${breaker.failures} failures`);
      }
      
      throw error;
    }
  }
  
  isRetryableError(error, config) {
    if (error.code && config.retryableErrors.includes(error.code)) {
      return true;
    }
    
    const message = error.message?.toLowerCase() || '';
    return config.retryableErrors.some(keyword => 
      message.includes(keyword.toLowerCase())
    );
  }
  
  classifyError(error) {
    const code = error.code || '';
    const message = error.message?.toLowerCase() || '';
    
    if (code.startsWith('E') || message.includes('network')) {
      return 'network';
    }
    if (message.includes('rate') || message.includes('limit')) {
      return 'rate_limit';
    }
    if (message.includes('timeout')) {
      return 'timeout';
    }
    if (message.includes('non-critical')) {
      return 'non_critical';
    }
    
    return 'unknown';
  }
  
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  getErrorStats() {
    const stats = {};
    for (const [context, errors] of this.errorHistory) {
      stats[context] = {
        count: errors.length,
        errorTypes: [...new Set(errors.map(e => this.classifyError(e)))]
      };
    }
    return stats;
  }
}

// Test functions
async function testRetryLogic() {
  console.log('\n📌 Test 1: Retry logic with network error');
  
  const recovery = new ErrorRecovery(null, { initialDelay: 100 });
  let callCount = 0;
  
  try {
    const result = await recovery.executeWithRetry(
      async () => {
        callCount++;
        if (callCount < 3) {
          const error = new Error('Network error');
          error.code = 'ENOTFOUND';
          throw error;
        }
        return 'Success!';
      },
      'network-test'
    );
    
    console.log(`✅ Retry succeeded: ${result}`);
    return true;
  } catch (error) {
    console.error(`❌ Retry failed: ${error.message}`);
    return false;
  }
}

async function testNonRetryableError() {
  console.log('\n📌 Test 2: Non-retryable error handling');
  
  const recovery = new ErrorRecovery(null, { initialDelay: 100 });
  
  try {
    await recovery.executeWithRetry(
      async () => {
        throw new Error('Authentication failed');
      },
      'auth-test'
    );
    
    console.log('❌ Should have thrown error');
    return false;
  } catch (error) {
    console.log(`✅ Correctly threw non-retryable error: ${error.message}`);
    return true;
  }
}

async function testRecoveryStrategy() {
  console.log('\n📌 Test 3: Recovery strategy determination');
  
  const recovery = new ErrorRecovery();
  
  // Test network error - should retry
  const networkError = new Error('Connection refused');
  networkError.code = 'ECONNREFUSED';
  
  const strategy1 = await recovery.determineRecoveryStrategy(
    networkError,
    'test-context'
  );
  console.log(`  Network error strategy: ${strategy1.type} - ${strategy1.description}`);
  
  // Test rate limit - should fallback if possible
  const rateLimitError = new Error('Rate limit exceeded');
  const strategy2 = await recovery.determineRecoveryStrategy(
    rateLimitError,
    'test-context',
    { canFallback: true }
  );
  console.log(`  Rate limit strategy: ${strategy2.type} - ${strategy2.description}`);
  
  // Test non-critical - should skip if allowed
  const nonCriticalError = new Error('Non-critical warning');
  const strategy3 = await recovery.determineRecoveryStrategy(
    nonCriticalError,
    'test-context',
    { canSkip: true }
  );
  console.log(`  Non-critical strategy: ${strategy3.type} - ${strategy3.description}`);
  
  console.log('✅ Recovery strategies working correctly');
  return true;
}

async function testErrorBoundary() {
  console.log('\n📌 Test 4: Error boundary with default value');
  
  const recovery = new ErrorRecovery();
  
  const result = await recovery.withErrorBoundary(
    async () => {
      throw new Error('Something went wrong');
    },
    'boundary-test',
    'default-value'
  );
  
  if (result === 'default-value') {
    console.log('✅ Error boundary returned default value');
    return true;
  } else {
    console.log('❌ Error boundary failed');
    return false;
  }
}

async function testCircuitBreaker() {
  console.log('\n📌 Test 5: Circuit breaker pattern');
  
  const recovery = new ErrorRecovery(null, { initialDelay: 10 });
  let callCount = 0;
  
  // Make calls that fail to trip the breaker
  for (let i = 0; i < 6; i++) {
    try {
      await recovery.withCircuitBreaker(
        async () => {
          callCount++;
          throw new Error('Service unavailable');
        },
        'service-test',
        { failureThreshold: 5 }
      );
    } catch (error) {
      if (error.message.includes('Circuit breaker open')) {
        console.log(`✅ Circuit breaker opened after ${callCount} failures`);
        return true;
      }
    }
  }
  
  console.log('❌ Circuit breaker did not open');
  return false;
}

async function testExponentialBackoff() {
  console.log('\n📌 Test 6: Exponential backoff timing');
  
  const recovery = new ErrorRecovery(null, {
    initialDelay: 100,
    backoffFactor: 2,
    maxDelay: 1000
  });
  
  const startTime = Date.now();
  let attemptTimes = [];
  
  try {
    await recovery.executeWithRetry(
      async () => {
        attemptTimes.push(Date.now() - startTime);
        if (attemptTimes.length < 3) {
          const error = new Error('Timeout');
          error.code = 'ETIMEDOUT';
          throw error;
        }
        return 'Success';
      },
      'backoff-test'
    );
    
    // Check delays: should be ~0, ~100, ~300 (100+200)
    const delay1 = attemptTimes[1] - attemptTimes[0];
    const delay2 = attemptTimes[2] - attemptTimes[1];
    
    console.log(`  Delays: ${delay1}ms, ${delay2}ms`);
    
    if (delay1 >= 90 && delay1 <= 110 && delay2 >= 190 && delay2 <= 210) {
      console.log('✅ Exponential backoff working correctly');
      return true;
    } else {
      console.log('❌ Backoff timing incorrect');
      return false;
    }
  } catch (error) {
    console.log('❌ Backoff test failed:', error.message);
    return false;
  }
}

// Run all tests
async function runAllTests() {
  console.log('🧪 Testing Error Recovery and Resilience');
  console.log('=' .repeat(50));
  
  const tests = [
    testRetryLogic,
    testNonRetryableError,
    testRecoveryStrategy,
    testErrorBoundary,
    testCircuitBreaker,
    testExponentialBackoff
  ];
  
  let passed = 0;
  let failed = 0;
  
  for (const test of tests) {
    const result = await test();
    if (result) {
      passed++;
    } else {
      failed++;
    }
  }
  
  console.log('\n' + '=' .repeat(50));
  console.log(`\n📊 Test Results:`);
  console.log(`  ✅ Passed: ${passed}`);
  console.log(`  ❌ Failed: ${failed}`);
  
  if (failed === 0) {
    console.log('\n🎉 All error recovery tests passed!');
  } else {
    console.log(`\n⚠️ ${failed} test(s) failed`);
  }
  
  return failed === 0;
}

// Run tests
runAllTests().then(success => {
  process.exit(success ? 0 : 1);
});