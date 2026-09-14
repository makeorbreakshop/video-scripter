import { Pinecone } from '@pinecone-database/pinecone';
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';
import { q } from './admin/db';
import { VIDEO_TEXT_JOIN, videoTextFor, type VideoText } from './app/video-text';

const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY!,
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * Videos that have a summary but no embedding yet.
 *
 * The summary is read from `video_text`; `llm_summary_embedding_synced` is a bookkeeping flag
 * that stays on `videos` and is not part of the move. Asking `videos` for the summary would,
 * after the null-out, either find nothing or — for the `is not null` form — find everything.
 */
export const PENDING_SUMMARY_EMBEDDING_SQL = `
  select v.id, v.title, v.channel_name, vt.llm_summary as llm_summary, v.created_at
    from videos v ${VIDEO_TEXT_JOIN}
   where vt.llm_summary is not null
     and v.llm_summary_embedding_synced = false
   limit $1`;

/** Overlay the side-table text onto rows selected from `videos`, whose copies are being nulled. */
export function withVideoText<T extends { id: string }>(
  rows: readonly T[],
  text: ReadonlyMap<string, VideoText>,
): Array<T & { description: string | null; metadata: any; llm_summary: string | null }> {
  return rows.map((row) => {
    const t = text.get(row.id);
    return {
      ...row,
      description: t?.description ?? null,
      metadata: t?.metadata ?? null,
      llm_summary: t?.llmSummary ?? null,
    };
  });
}

export class PineconeSummaryService {
  private indexName = process.env.PINECONE_SUMMARY_INDEX_NAME || 'video-summaries';
  private dimension = 512; // text-embedding-3-small
  private namespace = 'llm-summaries';
  
  async initializeIndex() {
    console.log('🔧 Initializing Pinecone summary index...');
    
    const indexes = await pinecone.listIndexes();
    const indexExists = indexes.indexes?.some(idx => idx.name === this.indexName);
    
    if (!indexExists) {
      console.log(`Creating new index: ${this.indexName}`);
      
      await pinecone.createIndex({
        name: this.indexName,
        dimension: this.dimension,
        metric: 'cosine',
        spec: {
          serverless: {
            cloud: 'aws',
            region: 'us-east-1'
          }
        }
      });
      
      // Wait for index to be ready
      await new Promise(resolve => setTimeout(resolve, 60000));
    }
    
    console.log('✅ Pinecone index ready');
    return pinecone.index(this.indexName);
  }
  
  async generateEmbedding(text: string) {
    const response = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: text,
    });
    
    return response.data[0].embedding;
  }
  
  async syncSummaryEmbeddings(batchSize = 100) {
    console.log('🔄 Syncing summary embeddings to Pinecone...\n');
    
    const index = await this.initializeIndex();
    
    // Get videos with summaries but no embeddings
    const videos = await q<{
      id: string; title: string; channel_name: string; llm_summary: string; created_at: string;
    }>(PENDING_SUMMARY_EMBEDDING_SQL, [batchSize]);
    
    if (!videos || videos.length === 0) {
      console.log('No summaries need embedding sync!');
      return;
    }
    
    console.log(`Found ${videos.length} summaries to sync\n`);
    
    let successCount = 0;
    let errorCount = 0;
    
    // Process in batches of 20 for rate limiting
    for (let i = 0; i < videos.length; i += 20) {
      const batch = videos.slice(i, i + 20);
      
      const embeddings = await Promise.all(
        batch.map(async (video) => {
          try {
            const embedding = await this.generateEmbedding(video.llm_summary);
            return {
              id: video.id,
              values: embedding,
              metadata: {
                title: video.title,
                channel_name: video.channel_name,
                summary: video.llm_summary.substring(0, 200),
                created_at: video.created_at
              }
            };
          } catch (error) {
            console.error(`Error generating embedding for ${video.id}:`, error);
            errorCount++;
            return null;
          }
        })
      );
      
      // Filter out failed embeddings
      const validEmbeddings = embeddings.filter(e => e !== null);
      
      if (validEmbeddings.length > 0) {
        // Upsert to Pinecone
        await index.namespace(this.namespace).upsert(validEmbeddings);
        
        // Update database
        const videoIds = validEmbeddings.map(e => e!.id);
        const { error: updateError } = await supabase
          .from('videos')
          .update({ llm_summary_embedding_synced: true })
          .in('id', videoIds);
        
        if (updateError) {
          console.error('Failed to update sync status:', updateError);
        } else {
          successCount += validEmbeddings.length;
        }
      }
      
      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      console.log(`Progress: ${i + batch.length}/${videos.length}`);
    }
    
    console.log(`\n✅ Synced ${successCount} embeddings successfully`);
    console.log(`❌ ${errorCount} errors`);
    
    return { successCount, errorCount };
  }
  
  async searchBySummary(query: string, topK = 10) {
    const index = await this.initializeIndex();
    
    // Generate embedding for query
    const queryEmbedding = await this.generateEmbedding(query);
    
    // Search in Pinecone
    const results = await index.namespace(this.namespace).query({
      vector: queryEmbedding,
      topK,
      includeMetadata: true
    });
    
    // Get full video details from database
    const videoIds = results.matches.map(m => m.id);
    
    const { data: rows } = await supabase
      .from('videos')
      .select('*')
      .in('id', videoIds);
    
    // `select('*')` cannot name its columns, so the three moved ones are overwritten from the
    // side table here — after the null-out the copies in `videos` are all NULL.
    const videos = rows ? withVideoText(rows as Array<{ id: string }>, await videoTextFor(videoIds)) : null;
    
    // Merge scores with video data
    const videosWithScores = videos?.map(video => {
      const match = results.matches.find(m => m.id === video.id);
      return {
        ...video,
        similarity_score: match?.score || 0
      };
    });
    
    // Sort by score
    return videosWithScores?.sort((a, b) => b.similarity_score - a.similarity_score) || [];
  }
}