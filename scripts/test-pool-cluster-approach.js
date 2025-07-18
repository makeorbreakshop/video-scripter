import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Test query
const SEED_QUERY = "how to make sourdough bread";

// Thread expansion strategies
const THREAD_STRATEGIES = [
  { id: 'direct', prompt: 'Direct search for: {query}' },
  { id: 'how_to', prompt: 'Step-by-step tutorial: how to {query}' },
  { id: 'tips', prompt: 'Best tips and tricks for {query}' },
  { id: 'mistakes', prompt: 'Common mistakes when {query}' },
  { id: 'beginner', prompt: '{query} for beginners guide' },
  { id: 'advanced', prompt: 'Advanced techniques for {query}' },
  { id: 'tools', prompt: 'Best tools and equipment for {query}' },
  { id: 'comparison', prompt: 'Different methods to {query}' },
  { id: 'science', prompt: 'The science behind {query}' },
  { id: 'troubleshooting', prompt: 'Why {query} fails and how to fix' },
  { id: 'time_based', prompt: '{query} in 2024/2025' },
  { id: 'results', prompt: 'Results and outcomes from {query}' }
];

// Simulate thread expansion
async function expandQuery(seedQuery) {
  console.log(`\n📋 EXPANDING QUERY: "${seedQuery}"`);
  console.log('=' + '='.repeat(60));
  
  const threads = THREAD_STRATEGIES.map(strategy => ({
    ...strategy,
    query: strategy.prompt.replace('{query}', seedQuery)
  }));
  
  console.log(`\nCreated ${threads.length} search threads:`);
  threads.forEach((t, i) => {
    console.log(`  ${i+1}. [${t.id}] ${t.query}`);
  });
  
  return threads;
}

// Search videos for each thread
async function searchVideosForThread(thread, limit = 30) {
  try {
    // Get embedding for thread query
    const embeddingResponse = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: thread.query,
    });
    const embedding = embeddingResponse.data[0].embedding;
    
    // Search Pinecone (simulated with Supabase for this test)
    const { data: videos, error } = await supabase.rpc('match_videos', {
      query_embedding: embedding,
      match_threshold: 0.4,
      match_count: limit
    });
    
    if (error) throw error;
    
    // Add provenance to each video
    return videos.map(v => ({
      ...v,
      found_by_thread: thread.id,
      thread_query: thread.query,
      similarity_to_thread: v.similarity
    }));
  } catch (error) {
    console.error(`Error searching thread ${thread.id}:`, error);
    return [];
  }
}

// Pool and deduplicate videos
function poolAndDeduplicate(allVideos) {
  console.log(`\n🏊 POOLING ${allVideos.length} VIDEOS`);
  console.log('=' + '='.repeat(60));
  
  // Group by video ID to track multiple provenances
  const videoMap = new Map();
  
  allVideos.forEach(video => {
    const existing = videoMap.get(video.id);
    if (existing) {
      // Track multiple thread sources
      existing.found_by_threads.push({
        thread: video.found_by_thread,
        similarity: video.similarity_to_thread
      });
    } else {
      videoMap.set(video.id, {
        ...video,
        found_by_threads: [{
          thread: video.found_by_thread,
          similarity: video.similarity_to_thread
        }]
      });
    }
  });
  
  const dedupedVideos = Array.from(videoMap.values());
  console.log(`\nDeduplicated to ${dedupedVideos.length} unique videos`);
  
  // Analyze thread coverage
  const threadCoverage = {};
  dedupedVideos.forEach(v => {
    v.found_by_threads.forEach(t => {
      threadCoverage[t.thread] = (threadCoverage[t.thread] || 0) + 1;
    });
  });
  
  console.log('\nThread contribution:');
  Object.entries(threadCoverage)
    .sort((a, b) => b[1] - a[1])
    .forEach(([thread, count]) => {
      console.log(`  ${thread}: ${count} videos`);
    });
  
  return dedupedVideos;
}

// Simple clustering based on title similarity
async function clusterVideos(videos) {
  console.log(`\n🔮 CLUSTERING ${videos.length} VIDEOS`);
  console.log('=' + '='.repeat(60));
  
  // For testing, we'll use a simple approach: group by common keywords
  const clusters = [];
  const used = new Set();
  
  for (const video of videos) {
    if (used.has(video.id)) continue;
    
    const cluster = {
      id: clusters.length,
      videos: [video],
      thread_sources: new Set(video.found_by_threads.map(t => t.thread))
    };
    
    // Find similar videos (simplified - in real implementation use embeddings)
    const titleWords = video.title.toLowerCase().split(/\s+/);
    
    for (const other of videos) {
      if (other.id === video.id || used.has(other.id)) continue;
      
      const otherWords = other.title.toLowerCase().split(/\s+/);
      const commonWords = titleWords.filter(w => otherWords.includes(w) && w.length > 4);
      
      if (commonWords.length >= 2) {
        cluster.videos.push(other);
        other.found_by_threads.forEach(t => {
          cluster.thread_sources.add(t.thread);
        });
        used.add(other.id);
      }
    }
    
    used.add(video.id);
    
    if (cluster.videos.length >= 3) {
      cluster.is_wide = cluster.thread_sources.size >= 3;
      cluster.avg_performance = cluster.videos.reduce((sum, v) => sum + (v.performance_ratio || 1), 0) / cluster.videos.length;
      clusters.push(cluster);
    }
  }
  
  console.log(`\nFound ${clusters.length} clusters`);
  
  // Sort by wide trends first, then by size
  clusters.sort((a, b) => {
    if (a.is_wide !== b.is_wide) return b.is_wide ? 1 : -1;
    return b.videos.length - a.videos.length;
  });
  
  return clusters;
}

// Analyze clusters with GPT
async function analyzeCluster(cluster, seedQuery) {
  const titles = cluster.videos.slice(0, 10).map(v => v.title);
  const threadList = Array.from(cluster.thread_sources).join(', ');
  
  const prompt = `
Analyze these ${cluster.videos.length} YouTube videos about "${seedQuery}":

Top titles:
${titles.map((t, i) => `${i+1}. ${t}`).join('\n')}

Found by search threads: ${threadList}
Average performance: ${cluster.avg_performance.toFixed(1)}x baseline
Thread coverage: ${cluster.is_wide ? 'WIDE (3+ threads)' : 'DEEP (1-2 threads)'}

Generate 3 new title ideas based on the patterns in these titles.
Format as JSON: { "pattern_name": "...", "titles": ["...", "...", "..."] }`;

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0.8,
    });
    
    return JSON.parse(completion.choices[0].message.content);
  } catch (error) {
    console.error('GPT analysis error:', error);
    return null;
  }
}

// Main test function
async function testPoolClusterApproach() {
  console.log('🚀 TESTING POOL-AND-CLUSTER APPROACH');
  console.log('=' + '='.repeat(60));
  
  // 1. Expand query into threads
  const threads = await expandQuery(SEED_QUERY);
  
  // 2. Search videos for each thread
  console.log(`\n🔍 SEARCHING VIDEOS FOR EACH THREAD...`);
  const allVideos = [];
  
  for (const thread of threads) {
    console.log(`\nSearching thread: ${thread.id}`);
    const videos = await searchVideosForThread(thread, 30);
    console.log(`  Found ${videos.length} videos`);
    allVideos.push(...videos);
  }
  
  // 3. Pool and deduplicate
  const pooledVideos = poolAndDeduplicate(allVideos);
  
  // 4. Cluster videos
  const clusters = await clusterVideos(pooledVideos);
  
  // 5. Analyze top clusters
  console.log(`\n✨ ANALYZING TOP CLUSTERS`);
  console.log('=' + '='.repeat(60));
  
  for (let i = 0; i < Math.min(5, clusters.length); i++) {
    const cluster = clusters[i];
    console.log(`\nCluster ${i + 1}: ${cluster.videos.length} videos (${cluster.is_wide ? 'WIDE' : 'DEEP'})`);
    console.log(`Threads: ${Array.from(cluster.thread_sources).join(', ')}`);
    console.log(`Performance: ${cluster.avg_performance.toFixed(1)}x`);
    console.log('Sample titles:');
    cluster.videos.slice(0, 3).forEach(v => {
      console.log(`  - ${v.title}`);
    });
    
    // Analyze with GPT
    const analysis = await analyzeCluster(cluster, SEED_QUERY);
    if (analysis) {
      console.log(`Pattern: ${analysis.pattern_name}`);
      console.log('New titles:');
      analysis.titles.forEach(t => {
        console.log(`  → ${t}`);
      });
    }
  }
  
  // 6. Summary insights
  console.log(`\n📊 INSIGHTS`);
  console.log('=' + '='.repeat(60));
  console.log(`Total unique videos found: ${pooledVideos.length}`);
  console.log(`Videos found by multiple threads: ${pooledVideos.filter(v => v.found_by_threads.length > 1).length}`);
  console.log(`Wide clusters (3+ threads): ${clusters.filter(c => c.is_wide).length}`);
  console.log(`Deep clusters (1-2 threads): ${clusters.filter(c => !c.is_wide).length}`);
}

// Run the test
testPoolClusterApproach().catch(console.error);