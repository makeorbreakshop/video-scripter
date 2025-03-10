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
    console.log(`🧠 Generating embeddings for ${nonEmptyTexts.length} text chunks using OpenAI`);
    
    const openai = new OpenAI({
      apiKey: apiKey
    });

    // Process each text individually as the API expects
    const embeddings: number[][] = [];
    
    for (let i = 0; i < nonEmptyTexts.length; i++) {
      const response = await openai.embeddings.create({
        model: model,
        input: nonEmptyTexts[i],
        encoding_format: "float"
      });
      
      embeddings.push(response.data[0].embedding);
    }
    
    console.log(`✅ Successfully generated ${embeddings.length} embeddings`);
    
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
  batchSize: number = 10,
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

  console.log(`🔄 Processing ${texts.length} texts in ${batches.length} batches with OpenAI`);

  const allEmbeddings: number[][] = [];
  
  // Process each batch sequentially to avoid rate limits
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    try {
      console.log(`⏳ Processing batch ${i + 1}/${batches.length} with ${batch.length} texts`);
      
      // Add a small delay between batches to avoid rate limits
      if (i > 0) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      // Process each text in the batch
      for (const text of batch) {
        const batchEmbeddings = await createEmbeddings([text], apiKey, model);
        allEmbeddings.push(...batchEmbeddings);
      }
      
      console.log(`✅ Batch ${i + 1}/${batches.length} completed`);
    } catch (error) {
      console.error(`🚨 Error processing batch ${i + 1}:`, error);
      
      // If we encounter an error, wait longer before retrying
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Try once more
      try {
        console.log(`🔄 Retrying batch ${i + 1}/${batches.length}`);
        
        // Process each text in the batch
        for (const text of batch) {
          const batchEmbeddings = await createEmbeddings([text], apiKey, model);
          allEmbeddings.push(...batchEmbeddings);
        }
      } catch (retryError) {
        console.error(`❌ Failed to process batch ${i + 1} after retry:`, retryError);
        
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