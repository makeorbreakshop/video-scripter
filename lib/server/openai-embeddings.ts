/**
 * OpenAI API client for embeddings (server-compatible)
 * Handles interactions with OpenAI's API for generating embeddings
 */

import OpenAI from 'openai';

// Define OpenAI related types
interface OpenAIEmbeddingResponse {
  data: {
    embedding: number[];
    index: number;
    object: string;
  }[];
  model: string;
  object: string;
  usage: {
    prompt_tokens: number;
    total_tokens: number;
  };
}

/**
 * Generate embeddings for one or more text inputs using OpenAI's API
 * 
 * @param texts - Array of text strings to embed
 * @param apiKey - OpenAI API key
 * @param model - Embedding model to use (defaults to "text-embedding-3-small")
 * @returns Promise containing the generated embeddings as arrays of floats
 */
export async function createEmbeddings(
  texts: string[],
  apiKey: string,
  model: string = "text-embedding-3-small"
): Promise<number[][]> {
  if (!texts || texts.length === 0) {
    throw new Error("No text provided for embedding");
  }

  if (!apiKey) {
    throw new Error("OpenAI API key is required");
  }

  // Check for empty strings
  const nonEmptyTexts = texts.map(text => text.trim()).filter(text => text.length > 0);
  if (nonEmptyTexts.length === 0) {
    throw new Error("All provided texts were empty");
  }

  try {
    
    const openai = new OpenAI({
      apiKey: apiKey
    });

    // Process all texts in a single API call instead of one at a time
    const response = await openai.embeddings.create({
      model: model,
      input: nonEmptyTexts,
      encoding_format: "float"
    });
    
    // Extract embeddings from response
    const embeddings = response.data.map(item => item.embedding);
    
    
    return embeddings;
  } catch (error) {
    console.error("🚨 Error generating embeddings with OpenAI:", error);
    throw error;
  }
}

/**
 * Batch process multiple texts to avoid hitting API limits
 * 
 * @param texts - Array of all texts to embed
 * @param apiKey - OpenAI API key
 * @param batchSize - Number of texts to process in each batch (default: 10)
 * @param model - Embedding model to use
 * @returns Promise containing all generated embeddings
 */
export async function batchCreateEmbeddings(
  texts: string[],
  apiKey: string,
  batchSize: number = 100,
  model: string = "text-embedding-3-small"
): Promise<number[][]> {
  if (!texts || texts.length === 0) {
    return [];
  }

  // Process texts in batches
  const batches: string[][] = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    batches.push(texts.slice(i, i + batchSize));
  }


  const allEmbeddings: number[][] = [];
  
  // Process each batch sequentially to avoid rate limits
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    try {
      
      // Minimal delay to avoid overwhelming the API
      if (i > 0) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      // Process each batch as a whole instead of one text at a time
      const batchEmbeddings = await createEmbeddings(batch, apiKey, model);
      allEmbeddings.push(...batchEmbeddings);
      
    } catch (error) {
      console.error(`🚨 Error processing batch ${i + 1}:`, error);
      
      // Brief wait before retry
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Try once more
      try {
        console.log(`🔄 Retrying OpenAI batch ${i + 1}/${batches.length}`);
        const batchEmbeddings = await createEmbeddings(batch, apiKey, model);
        allEmbeddings.push(...batchEmbeddings);
      } catch (retryError) {
        console.error(`❌ OpenAI batch ${i + 1}/${batches.length} failed after retry:`, retryError.message || retryError);
        
        // Add empty embeddings as placeholders for failed texts
        // OpenAI's text-embedding-3-small model returns 1536-dimension vectors
        for (let j = 0; j < batch.length; j++) {
          allEmbeddings.push(new Array(1536).fill(0));
        }
      }
    }
  }

  return allEmbeddings;
} 