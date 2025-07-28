import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Test query
const SEED_QUERY = "how to make sourdough bread";

// Thread expansion strategies
const THREAD_STRATEGIES = [
  { id: 'direct', prompt: '{query}' },
  { id: 'how_to', prompt: 'how to {query} step by step tutorial' },
  { id: 'tips', prompt: 'best tips for {query}' },
  { id: 'mistakes', prompt: 'common mistakes {query}' },
  { id: 'beginner', prompt: '{query} for beginners' },
  { id: 'advanced', prompt: 'advanced {query} techniques' },
  { id: 'tools', prompt: 'tools needed for {query}' },
  { id: 'comparison', prompt: 'best way to {query}' },
  { id: 'science', prompt: 'science of {query}' },
  { id: 'problems', prompt: 'troubleshooting {query} problems' },
];

// Simulate searching videos with our API
async function searchVideos(query) {
  try {
    const response = await fetch('http://localhost:3000/api/youtube/semantic-search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        query,
        limit: 30,
        performanceThreshold: 1.2 
      })
    });
    
    if (!response.ok) {
      throw new Error(`Search failed: ${response.statusText}`);
    }
    
    const data = await response.json();
    return data.videos || [];
  } catch (error) {
    console.error(`Search error for "${query}":`, error.message);
    return [];
  }
}

// Main test
async function testPoolAndCluster() {
  console.log('🚀 TESTING POOL-AND-CLUSTER APPROACH');
  console.log('=' + '='.repeat(60));
  console.log(`Seed query: "${SEED_QUERY}"\n`);
  
  // 1. Create threads
  const threads = THREAD_STRATEGIES.map(s => ({
    ...s,
    query: s.prompt.replace('{query}', SEED_QUERY)
  }));
  
  console.log(`📋 CREATED ${threads.length} SEARCH THREADS:`);
  threads.forEach((t, i) => {
    console.log(`  ${i+1}. [${t.id}] "${t.query}"`);
  });
  
  // 2. Search for each thread
  console.log(`\n🔍 SEARCHING VIDEOS FOR EACH THREAD...`);
  const videosByThread = new Map();
  let totalVideos = 0;
  
  for (const thread of threads) {
    console.log(`\nSearching: [${thread.id}] "${thread.query}"`);
    const videos = await searchVideos(thread.query);
    
    // Add provenance
    const videosWithProvenance = videos.map(v => ({
      ...v,
      found_by: thread.id,
      thread_query: thread.query
    }));
    
    videosByThread.set(thread.id, videosWithProvenance);
    totalVideos += videos.length;
    console.log(`  → Found ${videos.length} videos`);
    
    // Show top 2 examples
    if (videos.length > 0) {
      console.log('  Examples:');
      videos.slice(0, 2).forEach(v => {
        console.log(`    • ${v.title} (${v.performance_ratio?.toFixed(1)}x)`);
      });
    }
  }
  
  // 3. Pool all videos
  console.log(`\n🏊 POOLING ${totalVideos} TOTAL VIDEOS`);
  console.log('=' + '='.repeat(60));
  
  const allVideos = [];
  const videoIdToThreads = new Map();
  
  videosByThread.forEach((videos, threadId) => {
    videos.forEach(video => {
      allVideos.push(video);
      
      // Track which threads found each video
      if (!videoIdToThreads.has(video.id)) {
        videoIdToThreads.set(video.id, new Set());
      }
      videoIdToThreads.get(video.id).add(threadId);
    });
  });
  
  // 4. Deduplicate
  const uniqueVideos = new Map();
  allVideos.forEach(video => {
    const existing = uniqueVideos.get(video.id);
    if (!existing || video.performance_ratio > existing.performance_ratio) {
      uniqueVideos.set(video.id, {
        ...video,
        found_by_threads: Array.from(videoIdToThreads.get(video.id))
      });
    }
  });
  
  const dedupedVideos = Array.from(uniqueVideos.values());
  console.log(`\nDeduplicated to ${dedupedVideos.length} unique videos`);
  
  // Analyze overlap
  const overlapStats = {};
  dedupedVideos.forEach(v => {
    const threadCount = v.found_by_threads.length;
    overlapStats[threadCount] = (overlapStats[threadCount] || 0) + 1;
  });
  
  console.log('\nThread overlap distribution:');
  Object.entries(overlapStats)
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .forEach(([count, videos]) => {
      console.log(`  Found by ${count} thread(s): ${videos} videos`);
    });
  
  // 5. Simple clustering by title similarity
  console.log(`\n🔮 CLUSTERING VIDEOS`);
  console.log('=' + '='.repeat(60));
  
  // Group by common patterns in titles
  const patterns = new Map();
  
  dedupedVideos.forEach(video => {
    const title = video.title.toLowerCase();
    
    // Extract key phrases
    const keyPhrases = [
      'starter', 'recipe', 'no knead', 'dutch oven', 'beginner',
      'artisan', 'overnight', 'same day', 'troubleshoot', 'mistakes',
      'scoring', 'shaping', 'hydration', 'crumb'
    ];
    
    keyPhrases.forEach(phrase => {
      if (title.includes(phrase)) {
        if (!patterns.has(phrase)) {
          patterns.set(phrase, {
            pattern: phrase,
            videos: [],
            thread_sources: new Set()
          });
        }
        patterns.get(phrase).videos.push(video);
        video.found_by_threads.forEach(t => {
          patterns.get(phrase).thread_sources.add(t);
        });
      }
    });
  });
  
  // Convert to array and calculate stats
  const clusters = Array.from(patterns.values())
    .filter(p => p.videos.length >= 3)
    .map(p => ({
      ...p,
      thread_sources: Array.from(p.thread_sources),
      is_wide: p.thread_sources.size >= 3,
      avg_performance: p.videos.reduce((sum, v) => sum + (v.performance_ratio || 1), 0) / p.videos.length
    }))
    .sort((a, b) => {
      // Sort by wide first, then by size
      if (a.is_wide !== b.is_wide) return b.is_wide ? 1 : -1;
      return b.videos.length - a.videos.length;
    });
  
  console.log(`Found ${clusters.length} patterns with 3+ videos\n`);
  
  // 6. Show top patterns
  console.log(`✨ TOP PATTERNS DISCOVERED`);
  console.log('=' + '='.repeat(60));
  
  for (let i = 0; i < Math.min(5, clusters.length); i++) {
    const cluster = clusters[i];
    console.log(`\n${i + 1}. "${cluster.pattern.toUpperCase()}" PATTERN`);
    console.log(`   Type: ${cluster.is_wide ? '🌊 WIDE TREND' : '🎯 DEEP TREND'}`);
    console.log(`   Videos: ${cluster.videos.length}`);
    console.log(`   Performance: ${cluster.avg_performance.toFixed(1)}x average`);
    console.log(`   Found by threads: ${cluster.thread_sources.join(', ')}`);
    console.log('   Top examples:');
    cluster.videos.slice(0, 3).forEach(v => {
      console.log(`     • ${v.title} (${v.performance_ratio?.toFixed(1)}x)`);
    });
  }
  
  // 7. Key insights
  console.log(`\n📊 KEY INSIGHTS`);
  console.log('=' + '='.repeat(60));
  
  const widePatterns = clusters.filter(c => c.is_wide);
  const deepPatterns = clusters.filter(c => !c.is_wide);
  
  console.log(`\n1. PATTERN DISTRIBUTION:`);
  console.log(`   - Wide patterns (3+ threads): ${widePatterns.length}`);
  console.log(`   - Deep patterns (1-2 threads): ${deepPatterns.length}`);
  
  console.log(`\n2. STRONGEST SIGNALS (Wide patterns):`);
  widePatterns.slice(0, 3).forEach(p => {
    console.log(`   - "${p.pattern}": ${p.videos.length} videos from ${p.thread_sources.length} threads`);
  });
  
  console.log(`\n3. THREAD EFFECTIVENESS:`);
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
      console.log(`   - ${thread}: contributed to ${hits} patterns`);
    });
  
  // 8. Generate titles for top pattern
  if (clusters.length > 0) {
    console.log(`\n🎯 GENERATING TITLES FOR TOP PATTERN`);
    console.log('=' + '='.repeat(60));
    
    const topCluster = clusters[0];
    const prompt = `Based on these high-performing YouTube videos about "${SEED_QUERY}" with a "${topCluster.pattern}" focus:

${topCluster.videos.slice(0, 5).map((v, i) => `${i+1}. ${v.title} (${v.performance_ratio?.toFixed(1)}x performance)`).join('\n')}

Generate 3 new title ideas that follow this pattern. Return as JSON: {"titles": ["...", "...", "..."]}`;

    try {
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        temperature: 0.8,
      });
      
      const result = JSON.parse(completion.choices[0].message.content);
      console.log(`\nNew titles for "${topCluster.pattern}" pattern:`);
      result.titles.forEach((title, i) => {
        console.log(`${i + 1}. ${title}`);
      });
    } catch (error) {
      console.error('GPT generation error:', error);
    }
  }
}

// Run test
testPoolAndCluster().catch(console.error);