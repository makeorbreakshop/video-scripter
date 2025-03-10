/**
 * Anthropic API client for Claude embeddings
 * Handles interactions with Anthropic's API for generating embeddings
 */

// Define the Anthropic API response types
interface AnthropicEmbeddingResponse {
  id: string;
  embeddings: number[][];
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

interface AnthropicError {
  status?: number;
  message: string;
  type: string;
}

/**
 * Generate embeddings for one or more text inputs using Anthropic's API
 * 
 * @param texts - Array of text strings to embed
 * @param apiKey - Anthropic API key
 * @param model - Embedding model to use (defaults to "claude-3-embedding-v1")
 * @returns Promise containing the generated embeddings as arrays of floats
 */
export async function createEmbeddings(
  texts: string[],
  apiKey: string,
  model: string = "claude-3-embedding-v1"
): Promise<number[][]> {
  if (!texts || texts.length === 0) {
    throw new Error("No text provided for embedding");
  }

  if (!apiKey) {
    throw new Error("Anthropic API key is required");
  }

  // Check for empty strings
  const nonEmptyTexts = texts.map(text => text.trim()).filter(text => text.length > 0);
  if (nonEmptyTexts.length === 0) {
    throw new Error("All provided texts were empty");
  }

  try {
    console.log(`🧠 Generating embeddings for ${nonEmptyTexts.length} text chunks`);
    
    const response = await fetch("https://api.anthropic.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model,
        input: nonEmptyTexts,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error("🚨 Anthropic API error:", errorData);
      throw new Error(`Anthropic API error: ${errorData.error?.message || response.statusText}`);
    }

    const data = await response.json() as AnthropicEmbeddingResponse;
    console.log(`✅ Successfully generated ${data.embeddings.length} embeddings`);
    
    return data.embeddings;
  } catch (error) {
    console.error("🚨 Error generating embeddings:", error);
    throw error;
  }
}

/**
 * Batch process multiple texts to avoid hitting API limits
 * 
 * @param texts - Array of all texts to embed
 * @param apiKey - Anthropic API key
 * @param batchSize - Number of texts to process in each batch (default: 10)
 * @param model - Embedding model to use
 * @returns Promise containing all generated embeddings
 */
export async function batchCreateEmbeddings(
  texts: string[],
  apiKey: string,
  batchSize: number = 10,
  model: string = "claude-3-embedding-v1"
): Promise<number[][]> {
  if (!texts || texts.length === 0) {
    return [];
  }

  // Process texts in batches
  const batches: string[][] = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    batches.push(texts.slice(i, i + batchSize));
  }

  console.log(`🔄 Processing ${texts.length} texts in ${batches.length} batches`);

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
      
      const batchEmbeddings = await createEmbeddings(batch, apiKey, model);
      allEmbeddings.push(...batchEmbeddings);
      
      console.log(`✅ Batch ${i + 1}/${batches.length} completed`);
    } catch (error) {
      console.error(`🚨 Error processing batch ${i + 1}:`, error);
      
      // If we encounter an error, wait longer before retrying
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Try once more
      try {
        console.log(`🔄 Retrying batch ${i + 1}/${batches.length}`);
        const batchEmbeddings = await createEmbeddings(batch, apiKey, model);
        allEmbeddings.push(...batchEmbeddings);
      } catch (retryError) {
        console.error(`❌ Failed to process batch ${i + 1} after retry:`, retryError);
        
        // Add empty embeddings as placeholders for failed texts
        // This ensures the indices still align with the original texts array
        for (let j = 0; j < batch.length; j++) {
          allEmbeddings.push(new Array(1536).fill(0));
        }
      }
    }
  }

  return allEmbeddings;
} 