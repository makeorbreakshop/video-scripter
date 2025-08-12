/**
 * Utility for retrying operations with exponential backoff
 * Especially useful for network operations and API calls
 */

export interface RetryOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffMultiplier?: number;
  retryableErrors?: string[];
  onRetry?: (attempt: number, error: any, nextDelayMs: number) => void;
}

const DEFAULT_OPTIONS: Required<Omit<RetryOptions, 'onRetry'>> = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  retryableErrors: [
    'ENOTFOUND',
    'ETIMEDOUT',
    'ECONNRESET',
    'ECONNREFUSED',
    'fetch failed',
    'PineconeConnectionError',
    'Network request failed',
    'timeout',
  ],
};

/**
 * Check if an error is retryable based on error message/code patterns
 */
function isRetryableError(error: any, retryableErrors: string[]): boolean {
  const errorString = error?.toString() || '';
  const errorMessage = error?.message || '';
  const errorCode = error?.code || '';
  const errorCause = error?.cause?.toString() || '';
  
  // Check for specific error patterns
  for (const pattern of retryableErrors) {
    if (
      errorString.includes(pattern) ||
      errorMessage.includes(pattern) ||
      errorCode === pattern ||
      errorCause.includes(pattern)
    ) {
      return true;
    }
  }
  
  // Check for network-related errors
  if (error?.cause?.code && ['ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED'].includes(error.cause.code)) {
    return true;
  }
  
  // Check for fetch failures
  if (error?.name === 'TypeError' && errorMessage === 'fetch failed') {
    return true;
  }
  
  // Check for Pinecone connection errors
  if (error?.name === 'PineconeConnectionError') {
    return true;
  }
  
  return false;
}

/**
 * Sleep for a specified number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry an async operation with exponential backoff
 * 
 * @param operation - The async function to retry
 * @param options - Retry configuration options
 * @returns The result of the successful operation
 * @throws The last error if all retries fail
 */
export async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const config = { ...DEFAULT_OPTIONS, ...options };
  let lastError: any;
  let delay = config.initialDelayMs;
  
  for (let attempt = 1; attempt <= config.maxRetries + 1; attempt++) {
    try {
      // Try the operation
      return await operation();
    } catch (error) {
      lastError = error;
      
      // Check if this is the last attempt
      if (attempt > config.maxRetries) {
        console.error(`❌ All ${config.maxRetries} retries exhausted. Final error:`, error);
        throw error;
      }
      
      // Check if the error is retryable
      if (!isRetryableError(error, config.retryableErrors)) {
        console.error(`❌ Non-retryable error encountered:`, error);
        throw error;
      }
      
      // Calculate next delay with exponential backoff
      const nextDelay = Math.min(delay * config.backoffMultiplier, config.maxDelayMs);
      
      // Log retry attempt
      console.warn(
        `⚠️ Attempt ${attempt}/${config.maxRetries + 1} failed. Retrying in ${delay}ms...`,
        `Error: ${error?.message || error}`
      );
      
      // Call the onRetry callback if provided
      if (options.onRetry) {
        options.onRetry(attempt, error, delay);
      }
      
      // Wait before retrying
      await sleep(delay);
      
      // Update delay for next iteration
      delay = nextDelay;
    }
  }
  
  // This should never be reached, but TypeScript needs it
  throw lastError;
}

/**
 * Retry with backoff specifically for Pinecone operations
 */
export async function retryPineconeOperation<T>(
  operation: () => Promise<T>,
  operationName: string = 'Pinecone operation'
): Promise<T> {
  return retryWithBackoff(operation, {
    maxRetries: 5,
    initialDelayMs: 2000,
    maxDelayMs: 60000,
    backoffMultiplier: 2,
    retryableErrors: [
      ...DEFAULT_OPTIONS.retryableErrors,
      'PineconeConnectionError',
      'api.pinecone.io',
      'ENOTFOUND',
      'index_not_found',
    ],
    onRetry: (attempt, error, nextDelayMs) => {
      console.log(`🔄 Retrying ${operationName} (attempt ${attempt})...`);
      if (error?.cause?.code === 'ENOTFOUND') {
        console.log('  📡 DNS resolution failed - checking network connectivity...');
      }
    },
  });
}

/**
 * Retry with backoff specifically for Supabase operations
 */
export async function retrySupabaseOperation<T>(
  operation: () => Promise<T>,
  operationName: string = 'Supabase operation'
): Promise<T> {
  return retryWithBackoff(operation, {
    maxRetries: 3,
    initialDelayMs: 1000,
    maxDelayMs: 15000,
    backoffMultiplier: 2,
    retryableErrors: [
      ...DEFAULT_OPTIONS.retryableErrors,
      'supabase.co',
      'PGRST',
      'Connection terminated',
    ],
    onRetry: (attempt, error, nextDelayMs) => {
      console.log(`🔄 Retrying ${operationName} (attempt ${attempt})...`);
    },
  });
}