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

// Seed query
const SEED_QUERY = "how to make sourdough bread";

// More diverse thread strategies
const THREAD_STRATEGIES = [
  { id: 'direct', prompt: '{query}' },
  { id: 'how_to', prompt: 'how to {query} step by step' },
  { id: 'tips', prompt: 'best tips for {query}' },
  { id: 'mistakes', prompt: 'common mistakes when {query}' },
  { id: 'beginner', prompt: '{query} for beginners complete guide' },
  { id: 'advanced', prompt: 'advanced {query} techniques pro level' },
  { id: 'tools', prompt: 'essential tools equipment for {query}' },
  { id: 'science', prompt: 'science behind {query} explained' },
  { id: 'troubleshooting', prompt: 'troubleshooting {query} problems solutions' },
  { id: 'results', prompt: 'amazing {query} results showcase' },
  { id: 'comparison', prompt: 'different methods for {query} compared' },
  { id: 'quick', prompt: 'quick easy {query} in minutes' }
];

// Manual vector search using embeddings
async function searchVideosManually(query, limit = 50) {
  try {
    // Get embedding for query
    const embeddingResponse = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: query,
    });
    const embedding = embeddingResponse.data[0].embedding;
    
    // Call our vector search API
    const response = await fetch('http://localhost:3000/api/vector/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        embedding,
        limit,
        minScore: 0.4
      })
    });
    
    if (!response.ok) {
      console.error(`API error: ${response.status}`);
      return [];
    }
    
    const data = await response.json();
    return data.results || [];
  } catch (error) {
    console.error(`Search error: ${error.message}`);
    return [];
  }
}

// Calculate cosine similarity between two embeddings
function cosineSimilarity(a, b) {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

// Simple clustering using embedding similarity
async function clusterVideosByEmbeddings(videos, threshold = 0.85) {
  console.log(`\n🔮 CLUSTERING ${videos.length} VIDEOS BY EMBEDDINGS`);
  
  // Get embeddings for all video titles
  const batchSize = 50;
  const embeddings = [];
  
  for (let i = 0; i < videos.length; i += batchSize) {
    const batch = videos.slice(i, i + batchSize);
    const titles = batch.map(v => v.title);
    
    try {
      const response = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: titles,
      });
      embeddings.push(...response.data.map(d => d.embedding));
    } catch (error) {
      console.error('Embedding error:', error);
      // Fill with empty embeddings on error
      embeddings.push(...titles.map(() => []));
    }
    
    console.log(`  Processed ${Math.min(i + batchSize, videos.length)}/${videos.length} embeddings...`);
  }
  
  // Simple clustering algorithm
  const clusters = [];
  const assigned = new Array(videos.length).fill(false);
  
  for (let i = 0; i < videos.length; i++) {
    if (assigned[i] || !embeddings[i].length) continue;
    
    const cluster = {
      videos: [videos[i]],
      indices: [i],
      centroid: embeddings[i],
      thread_sources: new Set(videos[i].found_by_threads || [])
    };
    
    // Find all similar videos
    for (let j = i + 1; j < videos.length; j++) {
      if (assigned[j] || !embeddings[j].length) continue;
      
      const similarity = cosineSimilarity(embeddings[i], embeddings[j]);
      if (similarity >= threshold) {
        cluster.videos.push(videos[j]);
        cluster.indices.push(j);
        assigned[j] = true;
        
        // Add thread sources
        (videos[j].found_by_threads || []).forEach(t => {
          cluster.thread_sources.add(t);
        });
      }
    }
    
    assigned[i] = true;
    
    if (cluster.videos.length >= 3) {
      // Calculate average performance
      cluster.avg_performance = cluster.videos.reduce((sum, v) => 
        sum + (v.performance_ratio || 1), 0
      ) / cluster.videos.length;
      
      cluster.is_wide = cluster.thread_sources.size >= 3;
      clusters.push(cluster);
    }
  }
  
  return clusters.sort((a, b) => {
    // Sort by wide first, then by size
    if (a.is_wide !== b.is_wide) return b.is_wide ? 1 : -1;
    return b.videos.length - a.videos.length;
  });
}

// Main test
async function manualPoolAndClusterTest() {
  console.log('🚀 MANUAL POOL-AND-CLUSTER TEST');
  console.log('=' + '='.repeat(60));
  console.log(`Seed query: "${SEED_QUERY}"\n`);
  
  // 1. Expand queries
  const threads = THREAD_STRATEGIES.map(s => ({
    ...s,
    query: s.prompt.replace('{query}', SEED_QUERY)
  }));
  
  console.log(`📋 SEARCHING WITH ${threads.length} THREADS:`);
  threads.forEach((t, i) => {
    console.log(`  ${i+1}. [${t.id}] "${t.query}"`);
  });
  
  // 2. Search for each thread
  console.log(`\n🔍 SEARCHING VIDEOS...`);
  const allVideos = [];
  const videosByThread = new Map();
  
  for (const thread of threads) {
    console.log(`\n[${thread.id}] Searching: "${thread.query}"`);
    const videos = await searchVideosManually(thread.query, 40);
    
    // Add provenance
    const videosWithProvenance = videos.map(v => ({
      ...v,
      found_by_thread: thread.id,
      thread_query: thread.query
    }));
    
    videosByThread.set(thread.id, videosWithProvenance);
    allVideos.push(...videosWithProvenance);
    
    console.log(`  → Found ${videos.length} videos`);
    if (videos.length > 0) {
      const avgPerf = videos.reduce((sum, v) => sum + (v.performance_ratio || 1), 0) / videos.length;
      console.log(`  → Avg performance: ${avgPerf.toFixed(2)}x`);
      console.log(`  → Top result: "${videos[0].title}" (${videos[0].performance_ratio?.toFixed(1)}x)`);
    }
  }
  
  // 3. Pool and track provenance
  console.log(`\n🏊 POOLING ${allVideos.length} VIDEOS`);
  
  // Group by video ID to track all threads that found each video
  const videoMap = new Map();
  allVideos.forEach(video => {
    if (!videoMap.has(video.id)) {
      videoMap.set(video.id, {
        ...video,
        found_by_threads: []
      });
    }
    videoMap.get(video.id).found_by_threads.push(video.found_by_thread);
  });
  
  const pooledVideos = Array.from(videoMap.values());
  console.log(`\nDeduplicated to ${pooledVideos.length} unique videos`);
  
  // Analyze thread overlap
  const overlapCounts = {};
  pooledVideos.forEach(v => {
    const count = v.found_by_threads.length;
    overlapCounts[count] = (overlapCounts[count] || 0) + 1;
  });
  
  console.log('\nThread overlap:');
  Object.entries(overlapCounts)
    .sort((a, b) => Number(b[0]) - Number(a[0]))
    .forEach(([count, videos]) => {
      console.log(`  ${count} threads: ${videos} videos`);
    });
  
  // 4. Cluster videos
  const clusters = await clusterVideosByEmbeddings(pooledVideos, 0.82);
  
  console.log(`\nFound ${clusters.length} clusters with 3+ videos`);
  
  // 5. Analyze patterns
  console.log(`\n✨ DISCOVERED PATTERNS`);
  console.log('=' + '='.repeat(60));
  
  const widePatterns = clusters.filter(c => c.is_wide);
  const deepPatterns = clusters.filter(c => !c.is_wide);
  
  console.log(`\nPattern distribution:`);
  console.log(`  🌊 Wide patterns (3+ threads): ${widePatterns.length}`);
  console.log(`  🎯 Deep patterns (1-2 threads): ${deepPatterns.length}`);
  
  // Show top patterns
  console.log(`\n🌊 TOP WIDE PATTERNS (cross-thread signals):`);
  for (let i = 0; i < Math.min(5, widePatterns.length); i++) {
    const cluster = widePatterns[i];
    console.log(`\n${i + 1}. Pattern found by ${cluster.thread_sources.size} threads`);
    console.log(`   Threads: ${Array.from(cluster.thread_sources).join(', ')}`);
    console.log(`   Videos: ${cluster.videos.length}`);
    console.log(`   Avg performance: ${cluster.avg_performance.toFixed(2)}x`);
    console.log('   Examples:');
    cluster.videos.slice(0, 3).forEach(v => {
      console.log(`     • ${v.title} (${v.performance_ratio?.toFixed(1)}x)`);
    });
  }
  
  console.log(`\n🎯 TOP DEEP PATTERNS (specialized signals):`);
  for (let i = 0; i < Math.min(3, deepPatterns.length); i++) {
    const cluster = deepPatterns[i];
    console.log(`\n${i + 1}. Pattern from ${Array.from(cluster.thread_sources).join(', ')}`);
    console.log(`   Videos: ${cluster.videos.length}`);
    console.log(`   Avg performance: ${cluster.avg_performance.toFixed(2)}x`);
    console.log('   Examples:');
    cluster.videos.slice(0, 2).forEach(v => {
      console.log(`     • ${v.title} (${v.performance_ratio?.toFixed(1)}x)`);
    });
  }
  
  // 6. Generate titles from patterns
  if (clusters.length > 0) {
    console.log(`\n🎯 GENERATING TITLES FROM TOP PATTERN`);
    console.log('=' + '='.repeat(60));
    
    const topCluster = clusters[0];
    const patternType = topCluster.is_wide ? 'WIDE PATTERN' : 'DEEP PATTERN';
    
    const prompt = `Analyze these ${topCluster.videos.length} high-performing YouTube videos about "${SEED_QUERY}":

${topCluster.videos.slice(0, 8).map((v, i) => 
  `${i+1}. ${v.title} (${v.performance_ratio?.toFixed(1)}x performance)`
).join('\n')}

This ${patternType} was discovered across ${topCluster.thread_sources.size} different search strategies: ${Array.from(topCluster.thread_sources).join(', ')}

Based on the patterns in these titles, generate 5 new title ideas.
Return as JSON: {"pattern_name": "...", "titles": ["...", "...", "...", "...", "..."]}`;

    try {
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        temperature: 0.8,
      });
      
      const result = JSON.parse(completion.choices[0].message.content);
      console.log(`\nPattern: "${result.pattern_name}"`);
      console.log('New titles:');
      result.titles.forEach((title, i) => {
        console.log(`${i + 1}. ${title}`);
      });
    } catch (error) {
      console.error('GPT generation error:', error);
    }
  }
  
  // 7. Compare to thread-isolated approach
  console.log(`\n📊 COMPARISON: POOLED vs THREAD-ISOLATED`);
  console.log('=' + '='.repeat(60));
  
  console.log('\nPOOLED APPROACH:');
  console.log(`  - Found ${clusters.length} unique patterns`);
  console.log(`  - ${widePatterns.length} cross-thread patterns (strong signals)`);
  console.log(`  - Better pattern diversity from ${pooledVideos.length} unique videos`);
  
  console.log('\nTHREAD-ISOLATED (current system):');
  console.log(`  - Would find ~${threads.length * 4} patterns (4 per thread)`);
  console.log(`  - No cross-thread validation`);
  console.log(`  - Potential duplicate patterns across threads`);
  
  // Show which threads were most effective
  console.log(`\n🏆 THREAD EFFECTIVENESS:`);
  const threadHits = {};
  clusters.forEach(c => {
    c.thread_sources.forEach(t => {
      threadHits[t] = (threadHits[t] || 0) + 1;
    });
  });
  
  Object.entries(threadHits)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .forEach(([thread, hits]) => {
      console.log(`  ${thread}: contributed to ${hits} patterns`);
    });
}

// Run the test
manualPoolAndClusterTest().catch(console.error);