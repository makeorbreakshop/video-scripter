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
 * Generate parent categories for clusters
 */
async function generateParentCategories(clusters) {
  // Group clusters by content focus first
  const byFocus = {};
  clusters.forEach(cluster => {
    const focus = cluster.content_focus || 'other';
    if (!byFocus[focus]) {
      byFocus[focus] = [];
    }
    byFocus[focus].push(cluster);
  });
  
  const prompt = `You are an expert at organizing educational YouTube content into a logical hierarchy.

I have ${clusters.length} content clusters that need to be organized into parent categories. Here's a summary:

Content Distribution:
${Object.entries(byFocus).map(([focus, items]) => 
  `- ${focus}: ${items.length} clusters`
).join('\n')}

Top 30 Clusters by Size:
${clusters.slice(0, 30).map((c, i) => 
  `${i + 1}. "${c.name}" (${c.video_count} videos, ${c.primary_format}, focus: ${c.content_focus})`
).join('\n')}

Create a hierarchical taxonomy with:
1. 8-15 broad parent categories that logically group these clusters
2. Each parent should have a clear theme and contain related clusters
3. Categories should be balanced (not one huge category and many tiny ones)
4. Use terms that YouTube creators and viewers would understand

For each parent category, provide:
- A clear, descriptive name (2-4 words)
- A brief description
- The types of clusters it would contain
- Example cluster IDs that belong to it

Format as JSON:
{
  "parent_categories": [
    {
      "id": "unique_id",
      "name": "Category Name",
      "description": "Brief description",
      "content_types": ["type1", "type2"],
      "example_clusters": ["cluster_id1", "cluster_id2"]
    }
  ],
  "taxonomy_type": "skill-based|topic-based|format-based|mixed"
}`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 2000,
      temperature: 0.3,
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ]
    });
    
    const responseText = response.content[0].text;
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    
    throw new Error('Failed to parse JSON response');
  } catch (error) {
    console.error('Error generating parent categories:', error.message);
    throw error;
  }
}

/**
 * Assign clusters to parent categories
 */
async function assignClustersToParents(clusters, parentCategories) {
  const assignments = {};
  const unassigned = [];
  
  // Create a map for quick lookup
  const clusterMap = new Map(clusters.map(c => [c.cluster_id.toString(), c]));
  
  // Process in batches
  const batchSize = 10;
  for (let i = 0; i < clusters.length; i += batchSize) {
    const batch = clusters.slice(i, i + batchSize);
    
    const prompt = `Assign these YouTube content clusters to the most appropriate parent category.

Parent Categories:
${parentCategories.parent_categories.map(p => 
  `- ${p.id}: ${p.name} - ${p.description}`
).join('\n')}

Clusters to assign:
${batch.map((c, idx) => 
  `${idx + 1}. Cluster ${c.cluster_id}: "${c.name}"
   Description: ${c.description}
   Format: ${c.primary_format}, Focus: ${c.content_focus}
   Keywords: ${c.keywords.slice(0, 5).join(', ')}`
).join('\n\n')}

For each cluster, choose the single most appropriate parent category.
Consider the content theme, format, and target audience.

Format as JSON:
{
  "assignments": [
    {
      "cluster_id": "cluster_id",
      "parent_id": "parent_category_id",
      "confidence": 0.95
    }
  ]
}`;

    try {
      const response = await anthropic.messages.create({
        model: 'claude-3-haiku-20240307',
        max_tokens: 1000,
        temperature: 0.2,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ]
      });
      
      const responseText = response.content[0].text;
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      
      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]);
        result.assignments.forEach(assignment => {
          assignments[assignment.cluster_id] = {
            parent_id: assignment.parent_id,
            confidence: assignment.confidence
          };
        });
      }
    } catch (error) {
      console.error(`Error assigning batch ${i / batchSize + 1}:`, error.message);
      // Add to unassigned
      batch.forEach(c => unassigned.push(c.cluster_id));
    }
    
    // Rate limiting
    if (i + batchSize < clusters.length) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  return { assignments, unassigned };
}

/**
 * Build the complete hierarchy
 */
async function buildHierarchy(level = 3) {
  // Load the most recent cluster names
  const fs = await import('fs');
  const files = fs.readdirSync('exports');
  const nameFiles = files
    .filter(f => f.startsWith(`cluster-names-level${level}-`) && f.endsWith('.json'))
    .sort();
  
  if (nameFiles.length === 0) {
    console.error(`No cluster names file found for level ${level}.`);
    console.error('Please run generate-cluster-names.js first.');
    process.exit(1);
  }
  
  const inputFile = path.join('exports', nameFiles.pop());
  console.log(`Loading cluster names from: ${inputFile}`);
  
  const data = JSON.parse(readFileSync(inputFile, 'utf-8'));
  const clusters = data.clusters;
  
  console.log(`\nBuilding hierarchy for ${clusters.length} clusters...`);
  
  // Step 1: Generate parent categories
  console.log('\nStep 1: Generating parent categories...');
  const parentData = await generateParentCategories(clusters);
  console.log(`Created ${parentData.parent_categories.length} parent categories`);
  
  // Step 2: Assign clusters to parents
  console.log('\nStep 2: Assigning clusters to parent categories...');
  const { assignments, unassigned } = await assignClustersToParents(clusters, parentData);
  console.log(`Assigned ${Object.keys(assignments).length} clusters`);
  if (unassigned.length > 0) {
    console.log(`Warning: ${unassigned.length} clusters could not be assigned`);
  }
  
  // Step 3: Build the complete hierarchy structure
  const hierarchy = {
    generated_at: new Date().toISOString(),
    level: level,
    taxonomy_type: parentData.taxonomy_type,
    parent_categories: parentData.parent_categories.map(parent => {
      const childClusters = clusters.filter(c => 
        assignments[c.cluster_id]?.parent_id === parent.id
      );
      
      return {
        ...parent,
        cluster_count: childClusters.length,
        total_videos: childClusters.reduce((sum, c) => sum + c.video_count, 0),
        clusters: childClusters.map(c => ({
          id: c.cluster_id,
          name: c.name,
          video_count: c.video_count,
          confidence: assignments[c.cluster_id]?.confidence || 0
        })).sort((a, b) => b.video_count - a.video_count)
      };
    }),
    unassigned_clusters: unassigned
  };
  
  // Sort parent categories by total videos
  hierarchy.parent_categories.sort((a, b) => b.total_videos - a.total_videos);
  
  // Save hierarchy
  const timestamp = new Date().toISOString().split('T')[0];
  const outputPath = path.join('exports', `cluster-hierarchy-level${level}-${timestamp}.json`);
  writeFileSync(outputPath, JSON.stringify(hierarchy, null, 2));
  
  console.log(`\nHierarchy generation complete!`);
  console.log(`Results saved to: ${outputPath}`);
  
  // Generate visual hierarchy report
  const report = [
    `Cluster Hierarchy - Level ${level}`,
    `Generated: ${new Date().toISOString()}`,
    `Taxonomy Type: ${hierarchy.taxonomy_type}`,
    '',
    'Parent Categories:',
    ...hierarchy.parent_categories.map((parent, i) => [
      ``,
      `${i + 1}. ${parent.name} (${parent.cluster_count} clusters, ${parent.total_videos.toLocaleString()} videos)`,
      `   ${parent.description}`,
      `   Top clusters:`,
      ...parent.clusters.slice(0, 5).map(c => 
        `   - ${c.name} (${c.video_count} videos)`
      )
    ]).flat(),
    '',
    `Unassigned Clusters: ${unassigned.length}`
  ].join('\n');
  
  const reportPath = path.join('exports', `cluster-hierarchy-report-level${level}-${timestamp}.txt`);
  writeFileSync(reportPath, report);
  
  console.log(`Report saved to: ${reportPath}`);
  
  return hierarchy;
}

// Main execution
async function main() {
  const level = process.argv[2] ? parseInt(process.argv[2]) : 3;
  
  if (![1, 2, 3].includes(level)) {
    console.error('Please specify a valid level (1, 2, or 3)');
    console.log('Usage: node generate-cluster-hierarchy.js [level]');
    process.exit(1);
  }
  
  await buildHierarchy(level);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { generateParentCategories, assignClustersToParents, buildHierarchy };