/**
 * Integration module for adding LLM summary generation to the unified import process
 * This can be integrated into the main unified-video-import.ts file
 */

import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

// The refined prompt that performed best in testing
const ACTION_FIRST_PROMPT = `Extract the core content from this YouTube description, ignoring all promotional material, links, and channel information.

Write 1-2 sentences describing what is demonstrated, taught, or shown. Start with an action verb (Building, Creating, Installing, etc.) or a noun phrase. 

CRITICAL: Never use the words "video", "tutorial", "channel", or any meta-references. Focus only on the actual content/techniques/outcomes.`;

export interface SummaryGenerationOptions {
  skipSummaries?: boolean;
  summaryModel?: string;
  maxConcurrent?: number;
}

export interface SummaryResult {
  videoId: string;
  summary: string | null;
  success: boolean;
  error?: string;
}

/**
 * Generate LLM summaries for videos during import
 * This should be called after storing video data but can run in parallel with embeddings
 */
export async function generateVideoSummaries(
  videos: Array<{ id: string; title: string; channel_name: string; description?: string }>,
  options?: SummaryGenerationOptions
): Promise<SummaryResult[]> {
  if (options?.skipSummaries) {
    console.log('⏩ Skipping summary generation (skipSummaries=true)');
    return [];
  }

  console.log(`📝 Generating LLM summaries for ${videos.length} videos...`);
  
  const model = options?.summaryModel || 'gpt-4o-mini';
  const maxConcurrent = options?.maxConcurrent || 10;
  const results: SummaryResult[] = [];
  
  // Filter videos that need summaries
  const videosNeedingSummaries = videos.filter(v => 
    v.description && v.description.length >= 50
  );
  
  if (videosNeedingSummaries.length === 0) {
    console.log('⚠️ No videos with suitable descriptions for summary generation');
    return [];
  }
  
  // Process in batches to avoid rate limits
  for (let i = 0; i < videosNeedingSummaries.length; i += maxConcurrent) {
    const batch = videosNeedingSummaries.slice(i, i + maxConcurrent);
    
    const batchPromises = batch.map(async (video) => {
      try {
        const response = await openai.chat.completions.create({
          model,
          messages: [
            {
              role: 'system',
              content: ACTION_FIRST_PROMPT
            },
            {
              role: 'user',
              content: `Title: ${video.title}\nChannel: ${video.channel_name}\nDescription: ${video.description?.substring(0, 2000) || 'No description'}`
            }
          ],
          temperature: 0.3,
          max_tokens: 100
        });
        
        const summary = response.choices[0].message.content?.trim() || null;
        
        if (summary) {
          // Update database immediately
          await supabase
            .from('videos')
            .update({
              llm_summary: summary,
              llm_summary_generated_at: new Date().toISOString(),
              llm_summary_model: model
            })
            .eq('id', video.id);
        }
        
        return {
          videoId: video.id,
          summary,
          success: true
        };
      } catch (error) {
        console.error(`❌ Summary generation failed for ${video.id}:`, error);
        return {
          videoId: video.id,
          summary: null,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }
    });
    
    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);
    
    console.log(`Progress: ${Math.min((i + maxConcurrent), videosNeedingSummaries.length)}/${videosNeedingSummaries.length}`);
    
    // Rate limiting between batches
    if (i + maxConcurrent < videosNeedingSummaries.length) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  const successCount = results.filter(r => r.success).length;
  console.log(`✅ Generated ${successCount}/${videosNeedingSummaries.length} summaries successfully`);
  
  return results;
}

/**
 * Generate embeddings for LLM summaries
 * This should be called after summary generation completes
 */
export async function generateSummaryEmbeddings(
  summaryResults: SummaryResult[]
): Promise<Array<{ videoId: string; embedding: number[]; success: boolean; error?: string }>> {
  const successfulSummaries = summaryResults.filter(r => r.success && r.summary);
  
  if (successfulSummaries.length === 0) {
    console.log('⚠️ No summaries to generate embeddings for');
    return [];
  }
  
  console.log(`🔄 Generating embeddings for ${successfulSummaries.length} summaries...`);
  
  const embeddingResults = [];
  
  // Process in batches of 20 for rate limiting
  for (let i = 0; i < successfulSummaries.length; i += 20) {
    const batch = successfulSummaries.slice(i, i + 20);
    
    const batchPromises = batch.map(async (result) => {
      let retries = 3;
      let lastError: any;
      
      while (retries > 0) {
        try {
          const response = await openai.embeddings.create({
            model: 'text-embedding-3-small',
            input: result.summary!,
            dimensions: 512,
          });
          
          return {
            videoId: result.videoId,
            embedding: response.data[0].embedding,
            success: true
          };
        } catch (error: any) {
          lastError = error;
          retries--;
          
          // Only retry on network errors
          if (retries > 0 && (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED' || error.type === 'system')) {
            console.log(`⚠️ Network error for ${result.videoId}, retrying... (${retries} attempts left)`);
            await new Promise(resolve => setTimeout(resolve, 1000 * (4 - retries))); // Exponential backoff
          } else {
            break;
          }
        }
      }
      
      console.error(`❌ Embedding generation failed for ${result.videoId}:`, lastError);
      return {
        videoId: result.videoId,
        embedding: [],
        success: false,
        error: lastError instanceof Error ? lastError.message : 'Unknown error'
      };
    });
    
    const batchResults = await Promise.all(batchPromises);
    embeddingResults.push(...batchResults);
    
    // Rate limiting
    if (i + 20 < successfulSummaries.length) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  
  const successCount = embeddingResults.filter(r => r.success).length;
  console.log(`✅ Generated ${successCount} summary embeddings successfully`);
  
  return embeddingResults;
}

/**
 * Integration code to add to unified-video-import.ts processVideos method
 * Add this after Step 2 (Store video data) and run in parallel with Step 3 (embeddings)
 */
export const integrationCode = `
// Import at the top of the file
import { generateVideoSummaries, generateSummaryEmbeddings } from './unified-import-summary-integration';

// Add to VideoImportRequest options interface:
options?: {
  // ... existing options ...
  skipSummaries?: boolean;
  summaryModel?: string;
}

// Add to VideoImportResult interface:
export interface VideoImportResult {
  // ... existing fields ...
  summariesGenerated: number;
  summaryEmbeddingsGenerated: number;
}

// In processVideos method, after Step 2 (Store video data):

// Prepare all parallel operations
const parallelOperations: Promise<any>[] = [];

// Step 3a: Generate LLM summaries (new)
let summaryResults: SummaryResult[] = [];
if (!request.options?.skipSummaries) {
  const summaryPromise = (async () => {
    summaryResults = await generateVideoSummaries(videoMetadata, {
      skipSummaries: request.options?.skipSummaries,
      summaryModel: request.options?.summaryModel
    });
    result.summariesGenerated = summaryResults.filter(r => r.success).length;
  })();
  parallelOperations.push(summaryPromise);
}

// Step 3b: Generate embeddings (existing, but now in parallel)
let embeddingResults: EmbeddingResults | null = null;
if (!request.options?.skipEmbeddings) {
  const embeddingPromise = (async () => {
    embeddingResults = await this.processVideoEmbeddings(videoMetadata, request.options);
    result.embeddingsGenerated.titles = embeddingResults.titleEmbeddings.filter(e => e.success).length;
    result.embeddingsGenerated.thumbnails = embeddingResults.thumbnailEmbeddings.filter(e => e.success).length;
  })();
  parallelOperations.push(embeddingPromise);
}

// Run summaries and embeddings in parallel
if (parallelOperations.length > 0) {
  console.log(\`⚡ Running \${parallelOperations.length} operations in parallel...\`);
  await Promise.all(parallelOperations);
}

// Step 3c: Generate summary embeddings (after summaries complete)
if (summaryResults.length > 0 && !request.options?.skipEmbeddings) {
  const summaryEmbeddings = await generateSummaryEmbeddings(summaryResults);
  result.summaryEmbeddingsGenerated = summaryEmbeddings.filter(e => e.success).length;
  
  // Upload summary embeddings to Pinecone
  if (summaryEmbeddings.length > 0) {
    // Add to uploadToPinecone method or create separate upload
    await this.uploadSummaryEmbeddingsToPinecone(summaryEmbeddings);
  }
}
`;