import fs from 'fs/promises';
import path from 'path';
import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';
import { parse } from 'csv-parse/sync';

// Load environment variables
dotenv.config();

// Check for API key
if (!process.env.ANTHROPIC_API_KEY) {
  console.error('Error: ANTHROPIC_API_KEY environment variable is not set');
  process.exit(1);
}

// Initialize Anthropic client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

async function loadBertopicResults() {
  const csvContent = await fs.readFile('bertopic_results_20250708_212427.csv', 'utf-8');
  
  // Parse CSV properly
  const records = parse(csvContent, {
    columns: true,
    skip_empty_lines: true
  });
  
  return records;
}

async function groupVideosByCluster(data) {
  const clusters = {};
  
  for (const row of data) {
    const clusterId = row.cluster;
    
    // Skip noise cluster
    if (clusterId === '-1') continue;
    
    if (!clusters[clusterId]) {
      clusters[clusterId] = {
        id: clusterId,
        videos: new Map(), // Use Map to avoid duplicates
        totalViews: 0,
        avgPerformance: 0
      };
    }
    
    // Add video (Map automatically handles duplicates by video_id)
    clusters[clusterId].videos.set(row.video_id, {
      video_id: row.video_id,
      title: row.title,
      channel_name: row.channel_name || '',
      view_count: parseInt(row.view_count) || 0,
      performance_ratio: parseFloat(row.performance_ratio) || 0
    });
  }
  
  // Convert Map to Array and calculate statistics
  for (const clusterId in clusters) {
    const cluster = clusters[clusterId];
    cluster.videos = Array.from(cluster.videos.values());
    cluster.size = cluster.videos.length;
    
    // Calculate total views and average performance
    cluster.totalViews = cluster.videos.reduce((sum, v) => sum + v.view_count, 0);
    cluster.avgPerformance = cluster.videos.reduce((sum, v) => sum + v.performance_ratio, 0) / cluster.size;
    
    // Sort videos by view count
    cluster.videos.sort((a, b) => b.view_count - a.view_count);
  }
  
  return clusters;
}

async function generateClusterName(cluster) {
  // Get top 15 video titles for analysis
  const topTitles = cluster.videos.slice(0, 15).map(v => v.title);
  
  const prompt = `Analyze these YouTube video titles from a single content cluster and generate a descriptive cluster name.

Video titles in this cluster:
${topTitles.map((title, i) => `${i + 1}. ${title}`).join('\n')}

Cluster statistics:
- Total videos: ${cluster.size}
- Total views: ${cluster.totalViews.toLocaleString()}
- Average performance ratio: ${cluster.avgPerformance.toFixed(2)}

Based on these titles, generate:
1. A short, descriptive cluster name (3-6 words)
2. A brief description of the content theme (1-2 sentences)
3. Key topics or keywords that define this cluster

Format your response as JSON:
{
  "name": "Cluster Name Here",
  "description": "Brief description of the content theme",
  "keywords": ["keyword1", "keyword2", "keyword3"],
  "content_type": "tutorial|review|vlog|education|entertainment|other"
}`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-3-haiku-20240307',
      max_tokens: 500,
      temperature: 0.3,
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ]
    });
    
    // Extract text from response
    const responseText = response.content[0].text;
    
    // Parse the JSON response
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    
    // Fallback if JSON parsing fails
    return {
      name: `Cluster ${cluster.id}`,
      description: "Unable to parse cluster theme",
      keywords: [],
      content_type: "other"
    };
  } catch (error) {
    console.error(`Error generating name for cluster ${cluster.id}:`, error.message);
    return {
      name: `Cluster ${cluster.id}`,
      description: "Error generating description",
      keywords: [],
      content_type: "other"
    };
  }
}

async function processAllClusters() {
  console.log('Loading BERTopic results...');
  const data = await loadBertopicResults();
  console.log(`Loaded ${data.length} records`);
  
  console.log('Grouping videos by cluster...');
  const clusters = await groupVideosByCluster(data);
  
  // Filter to only process clusters with at least 10 videos
  const significantClusters = Object.values(clusters)
    .filter(c => c.size >= 10)
    .sort((a, b) => b.size - a.size);
  
  console.log(`Found ${significantClusters.length} clusters with 10+ videos`);
  
  const results = {
    generated_at: new Date().toISOString(),
    total_clusters: Object.keys(clusters).length,
    processed_clusters: significantClusters.length,
    clusters: []
  };
  
  // Process clusters in batches to avoid rate limiting
  const batchSize = 5;
  for (let i = 0; i < significantClusters.length; i += batchSize) {
    const batch = significantClusters.slice(i, i + batchSize);
    
    console.log(`\nProcessing clusters ${i + 1}-${Math.min(i + batchSize, significantClusters.length)}...`);
    
    const batchPromises = batch.map(async (cluster) => {
      const nameData = await generateClusterName(cluster);
      
      return {
        cluster_id: cluster.id,
        size: cluster.size,
        total_views: cluster.totalViews,
        avg_performance: cluster.avgPerformance,
        ...nameData,
        sample_videos: cluster.videos.slice(0, 10).map(v => ({
          title: v.title,
          views: v.view_count,
          performance: v.performance_ratio
        }))
      };
    });
    
    const batchResults = await Promise.all(batchPromises);
    results.clusters.push(...batchResults);
    
    // Log progress
    batchResults.forEach(result => {
      console.log(`  - Cluster ${result.cluster_id}: "${result.name}" (${result.size} videos)`);
    });
    
    // Add a small delay between batches to avoid rate limiting
    if (i + batchSize < significantClusters.length) {
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  
  // Save results
  const outputPath = path.join('exports', `cluster-names-${new Date().toISOString().split('T')[0]}.json`);
  await fs.mkdir('exports', { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify(results, null, 2));
  
  console.log(`\nCluster naming complete! Results saved to: ${outputPath}`);
  
  // Generate summary report
  const summary = results.clusters.map(c => 
    `${c.cluster_id}: ${c.name} (${c.size} videos, ${c.total_views.toLocaleString()} views)`
  ).join('\n');
  
  const summaryPath = path.join('exports', `cluster-names-summary-${new Date().toISOString().split('T')[0]}.txt`);
  await fs.writeFile(summaryPath, summary);
  
  console.log(`Summary saved to: ${summaryPath}`);
  
  return results;
}

// Run the script
processAllClusters()
  .then(() => {
    console.log('\nDone!');
    process.exit(0);
  })
  .catch(error => {
    console.error('Error:', error);
    process.exit(1);
  });

export { processAllClusters, generateClusterName };