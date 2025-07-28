import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';
import { readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

/**
 * Generate a name for a cluster using Claude
 */
async function generateClusterName(clusterData) {
  const prompt = `You are an expert at analyzing YouTube educational content and creating meaningful category names.

Analyze this cluster of YouTube videos and generate a descriptive name and metadata.

Cluster Statistics:
- Video count: ${clusterData.video_count}
- Total views: ${clusterData.total_views.toLocaleString()}
- Average views: ${clusterData.avg_views.toLocaleString()}

Top Keywords (by TF-IDF):
${clusterData.keywords.slice(0, 10).join(', ')}

Common Bigrams:
${clusterData.bigrams.slice(0, 5).map(b => `"${b.ngram}" (${b.count}x)`).join(', ')}

Content Patterns:
${Object.entries(clusterData.content_patterns)
  .map(([pattern, percentage]) => `${pattern}: ${percentage}%`)
  .join(', ')}

Sample Video Titles:
${clusterData.sample_titles.map((title, i) => `${i + 1}. ${title}`).join('\n')}

Based on this analysis, generate:
1. A concise, descriptive name (2-5 words) that captures the main theme
2. A brief description (1-2 sentences) explaining what content is in this cluster
3. The primary content format (tutorial, review, project, guide, etc.)
4. 3-5 specific topics or subtopics covered
5. The target audience level (beginner, intermediate, advanced, all)
6. Related search terms someone might use to find this content

Guidelines:
- Make names specific and meaningful, not generic
- Use terminology that YouTube creators and viewers would recognize
- For educational content, indicate the skill or subject area
- For project-based content, indicate what's being created
- Avoid redundant words like "videos" or "content"

Format your response as JSON:
{
  "name": "Concise Cluster Name",
  "description": "Brief description of the cluster content",
  "primary_format": "tutorial|review|project|guide|tips|showcase|vlog|other",
  "subtopics": ["subtopic1", "subtopic2", "subtopic3"],
  "audience_level": "beginner|intermediate|advanced|all",
  "search_terms": ["term1", "term2", "term3"],
  "content_focus": "skill|product|concept|hobby"
}`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1000,
      temperature: 0.3,
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ]
    });
    
    const responseText = response.content[0].text;
    
    // Parse JSON response
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        ...parsed,
        generated_at: new Date().toISOString(),
        model: 'claude-3-5-sonnet-20241022'
      };
    }
    
    throw new Error('Failed to parse JSON response');
  } catch (error) {
    console.error(`Error generating name for cluster ${clusterData.cluster_id}:`, error.message);
    return {
      name: `Cluster ${clusterData.cluster_id}`,
      description: "Unable to generate description",
      primary_format: "other",
      subtopics: [],
      audience_level: "all",
      search_terms: clusterData.keywords.slice(0, 3),
      content_focus: "other",
      error: error.message
    };
  }
}

/**
 * Process clusters in batches
 */
async function processClusterBatch(clusters, batchSize = 5) {
  const results = [];
  
  for (let i = 0; i < clusters.length; i += batchSize) {
    const batch = clusters.slice(i, i + batchSize);
    
    console.log(`\nProcessing clusters ${i + 1}-${Math.min(i + batchSize, clusters.length)} of ${clusters.length}...`);
    
    const batchPromises = batch.map(async (cluster) => {
      const nameData = await generateClusterName(cluster);
      
      return {
        cluster_id: cluster.cluster_id,
        level: cluster.level,
        video_count: cluster.video_count,
        total_views: cluster.total_views,
        avg_views: cluster.avg_views,
        ...nameData,
        keywords: cluster.keywords,
        top_bigrams: cluster.bigrams.slice(0, 3).map(b => b.ngram),
        content_patterns: cluster.content_patterns
      };
    });
    
    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);
    
    // Log progress
    batchResults.forEach(result => {
      console.log(`  ✓ Cluster ${result.cluster_id}: "${result.name}" (${result.primary_format})`);
    });
    
    // Rate limiting delay
    if (i + batchSize < clusters.length) {
      console.log('  Waiting 2 seconds before next batch...');
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  
  return results;
}

/**
 * Main function to process keyword extraction results
 */
async function main() {
  const level = process.argv[2] ? parseInt(process.argv[2]) : 3;
  const minVideos = process.argv[3] ? parseInt(process.argv[3]) : 10;
  
  // Find the most recent keyword extraction file
  const timestamp = new Date().toISOString().split('T')[0];
  const fs = await import('fs');
  const keywordFiles = ['exports'].map(dir => {
    try {
      const files = fs.readdirSync(dir);
      return files
        .filter(f => f.startsWith(`cluster-keywords-level${level}-`) && f.endsWith('.json'))
        .map(f => path.join(dir, f));
    } catch (e) {
      return [];
    }
  }).flat();
  
  if (keywordFiles.length === 0) {
    console.error(`No keyword extraction file found for level ${level}.`);
    console.error('Please run extract-cluster-keywords.js first.');
    process.exit(1);
  }
  
  const inputFile = keywordFiles.sort().pop();
  console.log(`Loading keyword data from: ${inputFile}`);
  
  const keywordData = JSON.parse(readFileSync(inputFile, 'utf-8'));
  
  // Filter clusters by minimum video count
  const significantClusters = keywordData
    .filter(c => c.video_count >= minVideos)
    .sort((a, b) => b.video_count - a.video_count);
  
  console.log(`Found ${significantClusters.length} clusters with ${minVideos}+ videos`);
  
  if (significantClusters.length === 0) {
    console.log('No clusters meet the minimum video threshold.');
    process.exit(0);
  }
  
  // Process clusters
  const results = await processClusterBatch(significantClusters);
  
  // Organize results by content focus and format
  const organized = {
    generated_at: new Date().toISOString(),
    level: level,
    total_clusters: results.length,
    min_videos_threshold: minVideos,
    by_content_focus: {},
    by_primary_format: {},
    clusters: results
  };
  
  // Group by content focus
  results.forEach(cluster => {
    const focus = cluster.content_focus || 'other';
    if (!organized.by_content_focus[focus]) {
      organized.by_content_focus[focus] = [];
    }
    organized.by_content_focus[focus].push({
      id: cluster.cluster_id,
      name: cluster.name,
      videos: cluster.video_count
    });
  });
  
  // Group by format
  results.forEach(cluster => {
    const format = cluster.primary_format || 'other';
    if (!organized.by_primary_format[format]) {
      organized.by_primary_format[format] = [];
    }
    organized.by_primary_format[format].push({
      id: cluster.cluster_id,
      name: cluster.name,
      videos: cluster.video_count
    });
  });
  
  // Save results
  const outputPath = path.join('exports', `cluster-names-level${level}-${timestamp}.json`);
  writeFileSync(outputPath, JSON.stringify(organized, null, 2));
  
  console.log(`\nCluster naming complete!`);
  console.log(`Results saved to: ${outputPath}`);
  
  // Generate summary report
  const summary = [
    `Cluster Naming Summary - Level ${level}`,
    `Generated: ${new Date().toISOString()}`,
    `Total Clusters: ${results.length}`,
    '',
    'By Content Focus:',
    ...Object.entries(organized.by_content_focus).map(([focus, clusters]) => 
      `  ${focus}: ${clusters.length} clusters`
    ),
    '',
    'By Primary Format:',
    ...Object.entries(organized.by_primary_format).map(([format, clusters]) => 
      `  ${format}: ${clusters.length} clusters`
    ),
    '',
    'Top 20 Clusters by Size:',
    ...results.slice(0, 20).map((c, i) => 
      `  ${i + 1}. [${c.cluster_id}] ${c.name} (${c.video_count} videos, ${c.primary_format})`
    )
  ].join('\n');
  
  const summaryPath = path.join('exports', `cluster-names-summary-level${level}-${timestamp}.txt`);
  writeFileSync(summaryPath, summary);
  
  console.log(`Summary saved to: ${summaryPath}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { generateClusterName, processClusterBatch };