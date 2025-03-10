/**
 * Environment Configuration
 * Helper functions to access environment variables
 */

// Supabase configuration
export const getSupabaseUrl = (): string => {
  return process.env.NEXT_PUBLIC_SUPABASE_URL || '';
};

export const getSupabaseAnonKey = (): string => {
  return process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
};

// YouTube API configuration
export const getYouTubeApiKey = (): string => {
  return process.env.YOUTUBE_API_KEY || '';
};

// Anthropic API configuration
export const getAnthropicApiKey = (): string => {
  return process.env.ANTHROPIC_API_KEY || '';
};

export const getAnthropicEmbeddingModel = (): string => {
  return process.env.ANTHROPIC_EMBEDDING_MODEL || 'claude-3-embedding-v1';
};

// App URL configuration
export const getAppUrl = (): string => {
  return process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
};

// pgvector configuration
export const isPgvectorEnabled = (): boolean => {
  return process.env.PGVECTOR_ENABLED === 'true';
};

export const getVectorSimilarityThreshold = (): number => {
  return parseFloat(process.env.VECTOR_SIMILARITY_THRESHOLD || '0.7');
};

export const getVectorMaxResults = (): number => {
  return parseInt(process.env.VECTOR_MAX_RESULTS || '20', 10);
};

// OpenAI configuration (for compatibility with existing code)
export const getOpenAIApiKey = (): string => {
  return process.env.OPENAI_API_KEY || '';
};

export const getOpenAIEmbeddingModel = (): string => {
  return process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small';
};

// Validate required configurations
export const validateRequiredConfig = (): { valid: boolean; errors: string[] } => {
  const errors: string[] = [];
  
  if (!getSupabaseUrl()) errors.push('NEXT_PUBLIC_SUPABASE_URL is not configured');
  if (!getSupabaseAnonKey()) errors.push('NEXT_PUBLIC_SUPABASE_ANON_KEY is not configured');
  
  if (isPgvectorEnabled()) {
    if (!getOpenAIApiKey()) errors.push('OPENAI_API_KEY is required when PGVECTOR_ENABLED=true');
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}; 