import fs from 'fs/promises';
import path from 'path';
import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';
import { parse } from 'csv-parse/sync';

// Load environment variables
dotenv.config();

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

async function testClustering() {
  console.log('Loading BERTopic results...');
  const data = await loadBertopicResults();
  console.log(`Loaded ${data.length} records`);
  
  // Group videos by cluster
  const clusters = {};
  
  for (const row of data) {
    const clusterId = row.cluster;
    
    // Skip noise cluster
    if (clusterId === '-1') continue;
    
    if (!clusters[clusterId]) {
      clusters[clusterId] = {
        id: clusterId,
        videos: new Map(),
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
  
  // Test with just the top 3 clusters
  const topClusters = Object.values(clusters)
    .filter(c => c.size >= 20)
    .sort((a, b) => b.size - a.size)
    .slice(0, 3);
  
  console.log('\nTesting with top 3 clusters:');
  for (const cluster of topClusters) {
    console.log(`\nCluster ${cluster.id}: ${cluster.size} videos, ${cluster.totalViews.toLocaleString()} views`);
    console.log('Top 5 videos:');
    cluster.videos.slice(0, 5).forEach((v, i) => {
      console.log(`  ${i + 1}. ${v.title} (${v.view_count.toLocaleString()} views)`);
    });
    
    const nameData = await generateClusterName(cluster);
    console.log(`Generated name: "${nameData.name}"`);
    console.log(`Description: ${nameData.description}`);
    console.log(`Keywords: ${nameData.keywords.join(', ')}`);
    console.log(`Content type: ${nameData.content_type}`);
  }
}

testClustering()
  .then(() => {
    console.log('\nTest complete!');
    process.exit(0);
  })
  .catch(error => {
    console.error('Error:', error);
    process.exit(1);
  });