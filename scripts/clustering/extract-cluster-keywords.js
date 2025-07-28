import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { writeFileSync } from 'fs';
import path from 'path';
import natural from 'natural';
import stopword from 'stopword';

// Load environment variables
dotenv.config();

// Initialize Supabase client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Initialize TF-IDF
const TfIdf = natural.TfIdf;

/**
 * Extract keywords from a collection of titles using TF-IDF
 */
function extractKeywords(titles, topN = 10) {
  const tfidf = new TfIdf();
  
  // Process all titles as one document for the cluster
  const processedTitles = titles.map(title => {
    // Convert to lowercase and tokenize
    let tokens = title.toLowerCase().split(/\s+/);
    
    // Remove stopwords
    tokens = stopword.removeStopwords(tokens);
    
    // Remove short tokens and numbers
    tokens = tokens.filter(token => 
      token.length > 2 && 
      !/^\d+$/.test(token) &&
      !/^[^\w]+$/.test(token)
    );
    
    return tokens.join(' ');
  });
  
  // Add as single document
  tfidf.addDocument(processedTitles.join(' '));
  
  // Get top terms
  const terms = [];
  tfidf.listTerms(0).forEach((item, index) => {
    if (index < topN) {
      terms.push({
        term: item.term,
        tfidf: item.tfidf,
        frequency: Math.round(item.tfidf * 100) / 100
      });
    }
  });
  
  return terms;
}

/**
 * Extract n-grams from titles
 */
function extractNgrams(titles, n = 2, topN = 5) {
  const ngramCounts = new Map();
  
  titles.forEach(title => {
    const words = title.toLowerCase().split(/\s+/);
    
    // Generate n-grams
    for (let i = 0; i <= words.length - n; i++) {
      const ngram = words.slice(i, i + n).join(' ');
      
      // Skip if contains only stopwords or short words
      const hasContent = words.slice(i, i + n).some(word => 
        word.length > 3 && !stopword.isStopword(word)
      );
      
      if (hasContent) {
        ngramCounts.set(ngram, (ngramCounts.get(ngram) || 0) + 1);
      }
    }
  });
  
  // Sort by frequency and return top N
  return Array.from(ngramCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([ngram, count]) => ({ ngram, count }));
}

/**
 * Extract common patterns from titles
 */
function extractPatterns(titles) {
  const patterns = {
    tutorials: 0,
    howTo: 0,
    reviews: 0,
    tips: 0,
    guides: 0,
    builds: 0,
    projects: 0,
    comparisons: 0,
    showcases: 0,
    updates: 0
  };
  
  const patternRegexes = {
    tutorials: /tutorial|lesson|course|learn|teaching/i,
    howTo: /how to|how-to|step by step|diy/i,
    reviews: /review|unboxing|first look|hands on|tested/i,
    tips: /tips|tricks|hacks|secrets|advice/i,
    guides: /guide|explained|complete|ultimate|everything/i,
    builds: /build|making|creating|crafting|assembling/i,
    projects: /project|challenge|experiment|attempt/i,
    comparisons: /vs|versus|compare|comparison|better/i,
    showcases: /showcase|tour|collection|setup|my/i,
    updates: /update|news|announcement|release|new/i
  };
  
  titles.forEach(title => {
    Object.entries(patternRegexes).forEach(([pattern, regex]) => {
      if (regex.test(title)) {
        patterns[pattern]++;
      }
    });
  });
  
  // Calculate percentages
  const total = titles.length;
  const patternPercentages = {};
  Object.entries(patterns).forEach(([pattern, count]) => {
    if (count > 0) {
      patternPercentages[pattern] = Math.round((count / total) * 100);
    }
  });
  
  return patternPercentages;
}

/**
 * Get videos for a specific cluster
 */
async function getClusterVideos(clusterId, level = 3) {
  const columnName = `topic_level_${level}`;
  
  const { data, error } = await supabase
    .from('videos')
    .select('video_id, title, view_count')
    .eq(columnName, clusterId)
    .order('view_count', { ascending: false })
    .limit(500); // Get more videos for better keyword extraction
  
  if (error) {
    console.error(`Error fetching videos for cluster ${clusterId}:`, error);
    return [];
  }
  
  return data || [];
}

/**
 * Process all clusters at a specific level
 */
async function processAllClusters(level = 3) {
  console.log(`Processing clusters at level ${level}...`);
  
  // Get all unique cluster IDs at this level
  const columnName = `topic_level_${level}`;
  const { data: clusterData, error } = await supabase
    .from('videos')
    .select(columnName)
    .not(columnName, 'is', null)
    .not(columnName, 'eq', -1); // Skip outliers
  
  if (error) {
    console.error('Error fetching cluster IDs:', error);
    return;
  }
  
  // Get unique cluster IDs
  const clusterIds = [...new Set(clusterData.map(row => row[columnName]))];
  console.log(`Found ${clusterIds.length} clusters at level ${level}`);
  
  const results = [];
  
  // Process each cluster
  for (const clusterId of clusterIds) {
    console.log(`Processing cluster ${clusterId}...`);
    
    const videos = await getClusterVideos(clusterId, level);
    
    if (videos.length < 5) {
      console.log(`Skipping cluster ${clusterId} (only ${videos.length} videos)`);
      continue;
    }
    
    const titles = videos.map(v => v.title);
    
    // Extract various features
    const keywords = extractKeywords(titles, 15);
    const bigrams = extractNgrams(titles, 2, 10);
    const trigrams = extractNgrams(titles, 3, 5);
    const patterns = extractPatterns(titles);
    
    // Calculate cluster statistics
    const totalViews = videos.reduce((sum, v) => sum + (v.view_count || 0), 0);
    const avgViews = Math.round(totalViews / videos.length);
    
    results.push({
      cluster_id: clusterId,
      level: level,
      video_count: videos.length,
      total_views: totalViews,
      avg_views: avgViews,
      keywords: keywords.map(k => k.term),
      keyword_scores: keywords,
      bigrams: bigrams,
      trigrams: trigrams,
      content_patterns: patterns,
      sample_titles: titles.slice(0, 10)
    });
  }
  
  // Sort by video count
  results.sort((a, b) => b.video_count - a.video_count);
  
  // Save results
  const timestamp = new Date().toISOString().split('T')[0];
  const outputPath = path.join('exports', `cluster-keywords-level${level}-${timestamp}.json`);
  writeFileSync(outputPath, JSON.stringify(results, null, 2));
  
  console.log(`\nKeyword extraction complete!`);
  console.log(`Results saved to: ${outputPath}`);
  console.log(`Processed ${results.length} clusters`);
  
  // Print summary
  console.log('\nTop 10 clusters by size:');
  results.slice(0, 10).forEach((cluster, i) => {
    console.log(`${i + 1}. Cluster ${cluster.cluster_id}: ${cluster.video_count} videos`);
    console.log(`   Keywords: ${cluster.keywords.slice(0, 5).join(', ')}`);
  });
  
  return results;
}

// Main execution
async function main() {
  const level = process.argv[2] ? parseInt(process.argv[2]) : 3;
  
  if (![1, 2, 3].includes(level)) {
    console.error('Please specify a valid level (1, 2, or 3)');
    console.log('Usage: node extract-cluster-keywords.js [level]');
    process.exit(1);
  }
  
  await processAllClusters(level);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { extractKeywords, extractNgrams, extractPatterns, processAllClusters };