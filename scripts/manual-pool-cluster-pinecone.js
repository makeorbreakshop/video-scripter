import { Pinecone } from '@pinecone-database/pinecone';
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

const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY,
});

// Seed query
const SEED_QUERY = "how to make sourdough bread";

// More diverse thread strategies
const THREAD_STRATEGIES = [
  { id: 'direct', prompt: '{query}' },
  { id: 'how_to', prompt: 'how to {query} step by step' },
  { id: 'tips', prompt: 'best tips for {query}' },
  { id: 'mistakes', prompt: 'common mistakes when {query}' },
  { id: 'beginner', prompt: '{query} for beginners' },
  { id: 'advanced', prompt: 'advanced {query} techniques' },
  { id: 'tools', prompt: 'tools equipment for {query}' },
  { id: 'science', prompt: 'science behind {query}' },
  { id: 'troubleshooting', prompt: 'troubleshooting {query} problems' },
  { id: 'results', prompt: '{query} results showcase' },
  { id: 'comparison', prompt: 'different methods for {query}' },
  { id: 'quick', prompt: 'quick easy {query}' }
];

// Search videos using Pinecone
async function searchVideosPinecone(query, limit = 50) {
  try {
    // Get embedding with correct dimensions for our index
    const embeddingResponse = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: query,
      dimensions: 512  // Match Pinecone index dimension
    });
    const embedding = embeddingResponse.data[0].embedding;
    
    // Connect to Pinecone
    const index = pinecone.index('youtube-titles-prod');
    
    // Search
    const results = await index.query({
      vector: embedding,
      topK: limit,
      includeMetadata: true,
      filter: {
        performance_ratio: { $gte: 1.0 }
      }
    });
    
    // Get full video data from Supabase
    const videoIds = results.matches.map(m => m.metadata.videoId);
    
    if (videoIds.length === 0) return [];
    
    const { data: videos, error } = await supabase
      .from('videos')
      .select('id, title, channel_name, view_count, published_at, performance_ratio')
      .in('id', videoIds)
      .order('performance_ratio', { ascending: false });
    
    if (error) {
      console.error('Supabase error:', error);
      return [];
    }
    
    // Add similarity scores
    const scoreMap = {};
    results.matches.forEach(m => {
      scoreMap[m.metadata.videoId] = m.score;
    });
    
    return videos.map(v => ({
      ...v,
      similarity_score: scoreMap[v.id] || 0
    }));
  } catch (error) {
    console.error(`Search error: ${error.message}`);
    return [];
  }
}

// Calculate cosine similarity
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

// Main test
async function testPoolAndCluster() {
  console.log('🚀 MANUAL POOL-AND-CLUSTER TEST WITH PINECONE');
  console.log('=' + '='.repeat(60));
  console.log(`Seed query: "${SEED_QUERY}"\n`);
  
  // 1. Create threads
  const threads = THREAD_STRATEGIES.map(s => ({
    ...s,
    query: s.prompt.replace('{query}', SEED_QUERY)
  }));
  
  console.log(`📋 SEARCHING WITH ${threads.length} THREADS:`);
  
  // 2. Search for each thread
  console.log(`\n🔍 SEARCHING VIDEOS...`);
  const allVideos = [];
  const threadResults = {};
  
  for (const thread of threads) {
    console.log(`\n[${thread.id}] "${thread.query}"`);
    const videos = await searchVideosPinecone(thread.query, 30);
    
    threadResults[thread.id] = videos.length;
    
    // Add provenance
    videos.forEach(v => {
      allVideos.push({
        ...v,
        found_by_thread: thread.id,
        thread_query: thread.query
      });
    });
    
    console.log(`  → Found ${videos.length} videos`);
    if (videos.length > 0) {
      const avgPerf = videos.reduce((sum, v) => sum + (v.performance_ratio || 1), 0) / videos.length;
      console.log(`  → Avg performance: ${avgPerf.toFixed(2)}x`);
      console.log(`  → Top: "${videos[0].title.substring(0, 60)}..." (${videos[0].performance_ratio?.toFixed(1)}x)`);
    }
  }
  
  // 3. Pool and deduplicate
  console.log(`\n🏊 POOLING ${allVideos.length} VIDEOS`);
  
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
  console.log(`Deduplicated to ${pooledVideos.length} unique videos`);
  
  // Thread overlap analysis
  const overlapCounts = {};
  pooledVideos.forEach(v => {
    const count = v.found_by_threads.length;
    overlapCounts[count] = (overlapCounts[count] || 0) + 1;
  });
  
  console.log('\nThread overlap distribution:');
  for (let i = 1; i <= 12; i++) {
    if (overlapCounts[i]) {
      console.log(`  ${i} thread(s): ${overlapCounts[i]} videos`);
    }
  }
  
  // Find videos that appear in multiple threads
  const multiThreadVideos = pooledVideos.filter(v => v.found_by_threads.length >= 3);
  console.log(`\n🌊 ${multiThreadVideos.length} videos found by 3+ threads (strong signals)`);
  
  // 4. Simple pattern discovery
  console.log(`\n✨ PATTERN DISCOVERY`);
  console.log('=' + '='.repeat(60));
  
  // Group by common keywords/patterns
  const patterns = {
    'starter': { videos: [], threads: new Set() },
    'recipe': { videos: [], threads: new Set() },
    'beginner': { videos: [], threads: new Set() },
    'no knead': { videos: [], threads: new Set() },
    'artisan': { videos: [], threads: new Set() },
    'easy': { videos: [], threads: new Set() },
    'overnight': { videos: [], threads: new Set() },
    'dutch oven': { videos: [], threads: new Set() }
  };
  
  pooledVideos.forEach(video => {
    const titleLower = video.title.toLowerCase();
    Object.keys(patterns).forEach(pattern => {
      if (titleLower.includes(pattern)) {
        patterns[pattern].videos.push(video);
        video.found_by_threads.forEach(t => patterns[pattern].threads.add(t));
      }
    });
  });
  
  // Sort patterns by thread coverage
  const sortedPatterns = Object.entries(patterns)
    .filter(([_, data]) => data.videos.length >= 3)
    .map(([name, data]) => ({
      name,
      videos: data.videos,
      thread_count: data.threads.size,
      threads: Array.from(data.threads),
      avg_performance: data.videos.reduce((sum, v) => sum + (v.performance_ratio || 1), 0) / data.videos.length,
      is_wide: data.threads.size >= 3
    }))
    .sort((a, b) => {
      if (a.is_wide !== b.is_wide) return b.is_wide ? 1 : -1;
      return b.thread_count - a.thread_count;
    });
  
  console.log(`\n🌊 WIDE PATTERNS (3+ threads):`);
  const widePatterns = sortedPatterns.filter(p => p.is_wide);
  widePatterns.slice(0, 5).forEach((pattern, i) => {
    console.log(`\n${i + 1}. "${pattern.name.toUpperCase()}" pattern`);
    console.log(`   Found by ${pattern.thread_count} threads: ${pattern.threads.slice(0, 5).join(', ')}${pattern.threads.length > 5 ? '...' : ''}`);
    console.log(`   ${pattern.videos.length} videos, avg ${pattern.avg_performance.toFixed(2)}x performance`);
    console.log('   Top examples:');
    pattern.videos.slice(0, 3).forEach(v => {
      console.log(`     • ${v.title.substring(0, 70)}... (${v.performance_ratio?.toFixed(1)}x)`);
    });
  });
  
  console.log(`\n🎯 DEEP PATTERNS (1-2 threads):`);
  const deepPatterns = sortedPatterns.filter(p => !p.is_wide);
  deepPatterns.slice(0, 3).forEach((pattern, i) => {
    console.log(`\n${i + 1}. "${pattern.name.toUpperCase()}" pattern`);
    console.log(`   From threads: ${pattern.threads.join(', ')}`);
    console.log(`   ${pattern.videos.length} videos, avg ${pattern.avg_performance.toFixed(2)}x`);
  });
  
  // 5. Generate titles from best pattern
  if (sortedPatterns.length > 0) {
    const topPattern = sortedPatterns[0];
    console.log(`\n🎯 GENERATING TITLES FROM TOP PATTERN`);
    console.log('=' + '='.repeat(60));
    
    const prompt = `Based on these high-performing YouTube videos with "${topPattern.name}" pattern:

${topPattern.videos.slice(0, 6).map((v, i) => 
  `${i+1}. ${v.title} (${v.performance_ratio?.toFixed(1)}x)`
).join('\n')}

This pattern appeared across ${topPattern.thread_count} search strategies.

Generate 5 new titles following this pattern for "${SEED_QUERY}".
Return JSON: {"titles": ["...", "...", "...", "...", "..."]}`;

    try {
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        temperature: 0.8,
      });
      
      const result = JSON.parse(completion.choices[0].message.content);
      console.log(`\nNew titles with "${topPattern.name}" pattern:`);
      result.titles.forEach((title, i) => {
        console.log(`${i + 1}. ${title}`);
      });
    } catch (error) {
      console.error('Generation error:', error);
    }
  }
  
  // 6. Summary insights
  console.log(`\n📊 SUMMARY INSIGHTS`);
  console.log('=' + '='.repeat(60));
  
  console.log(`\n1. THREAD EFFECTIVENESS:`);
  Object.entries(threadResults)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .forEach(([thread, count]) => {
      console.log(`   ${thread}: ${count} videos found`);
    });
  
  console.log(`\n2. CROSS-THREAD VALIDATION:`);
  console.log(`   - ${widePatterns.length} patterns validated by 3+ threads`);
  console.log(`   - ${multiThreadVideos.length} videos appeared in 3+ searches`);
  console.log(`   - Strongest patterns have ${Math.max(...widePatterns.map(p => p.thread_count))} thread validation`);
  
  console.log(`\n3. VALUE OF POOLING:`);
  console.log(`   - Discovered ${sortedPatterns.length} distinct patterns`);
  console.log(`   - Wide patterns show universal appeal`);
  console.log(`   - Deep patterns show niche opportunities`);
}

// Run test
testPoolAndCluster().catch(console.error);