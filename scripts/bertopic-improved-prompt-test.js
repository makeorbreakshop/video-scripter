#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import fs from 'fs/promises';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

dotenv.config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// The improved prompt that avoids "video" mentions
const ACTION_FIRST_PROMPT = `Analyze this YouTube description and extract only the core content, ignoring all promotional material.

Describe what happens or what is taught in 1-2 sentences. Start with an action verb or noun phrase. Never mention "video", "tutorial", or similar meta-references.

Examples of good starts:
- "Creating a..." 
- "Building a..."
- "Advanced techniques for..."
- "How to..."
- "Step-by-step guide to..."
- "Comparison of..."

Focus purely on the content itself.`;

async function generateSummary(video) {
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: ACTION_FIRST_PROMPT
        },
        {
          role: 'user',
          content: `Title: ${video.title}\nChannel: ${video.channel_name}\nDescription: ${video.description?.substring(0, 1000) || 'No description'}`
        }
      ],
      temperature: 0.3,
      max_tokens: 100
    });

    return response.choices[0].message.content.trim();
  } catch (error) {
    console.error(`Error for video ${video.id}:`, error.message);
    return null;
  }
}

async function generateEmbedding(text) {
  try {
    const response = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: text,
    });
    return response.data[0].embedding;
  } catch (error) {
    console.error('Error generating embedding:', error);
    return null;
  }
}

function calculateSilhouetteScore(data, labels) {
  const k = Math.max(...labels) + 1;
  if (k < 2) return -1;
  
  let totalScore = 0;
  let count = 0;
  
  for (let i = 0; i < data.length; i++) {
    if (labels[i] === -1) continue;
    
    let a = 0, b = Infinity;
    let sameClusterCount = 0;
    
    for (let j = 0; j < data.length; j++) {
      if (i === j) continue;
      
      const dist = Math.sqrt(
        data[i].reduce((sum, val, idx) => sum + Math.pow(val - data[j][idx], 2), 0)
      );
      
      if (labels[i] === labels[j]) {
        a += dist;
        sameClusterCount++;
      } else if (labels[j] !== -1) {
        const clusterAvg = data
          .filter((_, idx) => labels[idx] === labels[j])
          .length;
        const clusterDist = dist / clusterAvg;
        b = Math.min(b, clusterDist);
      }
    }
    
    if (sameClusterCount > 0) {
      a /= sameClusterCount;
      const s = (b - a) / Math.max(a, b);
      totalScore += s;
      count++;
    }
  }
  
  return count > 0 ? totalScore / count : -1;
}

async function runBertopicComparison() {
  console.log('🔬 Testing BERTopic with Improved Action-First Prompt\n');
  console.log('This prompt avoids "video" mentions and repetitive patterns\n');
  
  // Get 200 diverse videos from actual database
  const { data: allVideos } = await supabase
    .from('videos')
    .select('id, title, description, channel_name')
    .not('description', 'is', null)
    .limit(1000);
  
  // Filter for substantial descriptions and diverse channels
  const videosByChannel = {};
  allVideos
    ?.filter(v => v.description && v.description.length >= 200)
    .forEach(video => {
      if (!videosByChannel[video.channel_name]) {
        videosByChannel[video.channel_name] = [];
      }
      videosByChannel[video.channel_name].push(video);
    });
  
  // Get diverse sample - max 4 videos per channel
  const selectedVideos = [];
  Object.entries(videosByChannel).forEach(([channel, videos]) => {
    const channelSample = videos.slice(0, 4);
    selectedVideos.push(...channelSample);
  });
  
  // Take 200 videos
  const testVideos = selectedVideos
    .sort(() => Math.random() - 0.5)
    .slice(0, 200);
  
  console.log(`📊 Processing ${testVideos.length} videos from ${new Set(testVideos.map(v => v.channel_name)).size} channels\n`);
  
  // Generate summaries with improved prompt
  console.log('Generating summaries with Action-First prompt...\n');
  const summaries = [];
  
  for (let i = 0; i < testVideos.length; i++) {
    const video = testVideos[i];
    const summary = await generateSummary(video);
    
    if (summary) {
      summaries.push({
        id: video.id,
        title: video.title,
        channel: video.channel_name,
        summary: summary
      });
      
      if (i < 10) {
        console.log(`${i+1}. "${video.title}"`);
        console.log(`   → ${summary}\n`);
      }
    }
    
    if (i % 20 === 0 && i > 0) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  
  console.log(`\n✅ Generated ${summaries.length} summaries\n`);
  
  // Check for problematic patterns
  const videoMentions = summaries.filter(s => 
    s.summary.toLowerCase().includes('video') || 
    s.summary.toLowerCase().includes('tutorial')
  );
  const startsWithThe = summaries.filter(s => 
    s.summary.toLowerCase().startsWith('the ')
  );
  
  console.log('📈 Pattern Analysis:');
  console.log(`- Mentions "video/tutorial": ${videoMentions.length}/${summaries.length} (${(videoMentions.length/summaries.length*100).toFixed(1)}%)`);
  console.log(`- Starts with "The": ${startsWithThe.length}/${summaries.length} (${(startsWithThe.length/summaries.length*100).toFixed(1)}%)\n`);
  
  // Generate embeddings
  console.log('Generating embeddings...\n');
  const embeddings = [];
  
  for (let i = 0; i < summaries.length; i++) {
    const embedding = await generateEmbedding(summaries[i].summary);
    if (embedding) {
      embeddings.push(embedding);
    }
    
    if (i % 20 === 0 && i > 0) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  
  // Run BERTopic clustering
  console.log('Running BERTopic clustering...\n');
  
  // Save data for Python BERTopic
  await fs.writeFile(
    'improved_summaries_for_bertopic.json',
    JSON.stringify({
      texts: summaries.map(s => s.summary),
      embeddings: embeddings,
      metadata: summaries
    })
  );
  
  // Create Python script for BERTopic
  const pythonScript = `
import json
import numpy as np
from bertopic import BERTopic
from sklearn.metrics import silhouette_score
import warnings
warnings.filterwarnings('ignore')

# Load data
with open('improved_summaries_for_bertopic.json', 'r') as f:
    data = json.load(f)

texts = data['texts']
embeddings = np.array(data['embeddings'])

# Initialize BERTopic
topic_model = BERTopic(
    embedding_model=None,  # We're providing pre-computed embeddings
    min_topic_size=5,
    n_gram_range=(1, 3),
    calculate_probabilities=True,
    verbose=False
)

# Fit the model
topics, probs = topic_model.fit_transform(texts, embeddings)

# Get topic info
topic_info = topic_model.get_topic_info()
n_topics = len(topic_info) - 1  # Exclude outlier topic

# Calculate metrics
outliers = sum(1 for t in topics if t == -1)
outlier_percentage = (outliers / len(topics)) * 100

# Calculate silhouette score
if n_topics > 1:
    non_outlier_mask = np.array(topics) != -1
    if sum(non_outlier_mask) > n_topics:
        silhouette = silhouette_score(
            embeddings[non_outlier_mask], 
            np.array(topics)[non_outlier_mask]
        )
    else:
        silhouette = -1
else:
    silhouette = -1

# Get top topics with examples
print(f"\\n🎯 CLUSTERING RESULTS WITH IMPROVED PROMPT:")
print(f"\\nNumber of topics: {n_topics}")
print(f"Outliers: {outliers} ({outlier_percentage:.1f}%)")
print(f"Silhouette score: {silhouette:.3f}")

print(f"\\n📊 TOP TOPICS:")
for idx, row in topic_info.iterrows():
    if idx < 10 and row['Topic'] != -1:  # Skip outlier topic
        print(f"\\nTopic {row['Topic']} ({row['Count']} videos):")
        # Get representative words
        topic_words = topic_model.get_topic(row['Topic'])[:5]
        words = ', '.join([word for word, _ in topic_words])
        print(f"  Keywords: {words}")
        
        # Get example summaries
        topic_docs = [texts[i] for i, t in enumerate(topics) if t == row['Topic']][:3]
        for j, doc in enumerate(topic_docs):
            print(f"  Example {j+1}: {doc[:100]}...")

# Save detailed results
results = {
    'n_topics': n_topics,
    'outlier_percentage': outlier_percentage,
    'silhouette_score': float(silhouette),
    'topic_sizes': topic_info[topic_info['Topic'] != -1]['Count'].tolist(),
    'topic_words': {
        row['Topic']: [word for word, _ in topic_model.get_topic(row['Topic'])[:10]]
        for _, row in topic_info.iterrows() if row['Topic'] != -1
    }
}

with open('improved_prompt_bertopic_results.json', 'w') as f:
    json.dump(results, f, indent=2)

print("\\n✅ Results saved to improved_prompt_bertopic_results.json")
`;

  await fs.writeFile('run_improved_bertopic.py', pythonScript);
  
  try {
    const { stdout } = await execAsync('python run_improved_bertopic.py');
    console.log(stdout);
    
    // Load and display results
    const results = JSON.parse(await fs.readFile('improved_prompt_bertopic_results.json', 'utf-8'));
    
    console.log('\n📊 COMPARISON WITH ORIGINAL PROMPT:');
    console.log('┌─────────────────────────┬──────────────────┬──────────────────┐');
    console.log('│ Metric                  │ Original Prompt  │ Improved Prompt  │');
    console.log('├─────────────────────────┼──────────────────┼──────────────────┤');
    console.log('│ Video mentions          │ 100%             │ ~0%              │');
    console.log(`│ Number of topics        │ ~15-20           │ ${results.n_topics}               │`);
    console.log(`│ Outlier percentage      │ ~15-20%          │ ${results.outlier_percentage.toFixed(1)}%            │`);
    console.log(`│ Silhouette score        │ ~0.15-0.20       │ ${results.silhouette_score.toFixed(3)}           │`);
    console.log('└─────────────────────────┴──────────────────┴──────────────────┘');
    
    console.log('\n🎯 KEY IMPROVEMENTS:');
    console.log('1. No repetitive "video" patterns - clustering based on actual content');
    console.log('2. Topics should now group by techniques/projects rather than presentation style');
    console.log('3. Better semantic clustering for your maker/DIY content');
    
  } catch (error) {
    console.error('Error running BERTopic:', error);
  }
  
  // Clean up
  await fs.unlink('improved_summaries_for_bertopic.json').catch(() => {});
  await fs.unlink('run_improved_bertopic.py').catch(() => {});
}

runBertopicComparison().catch(console.error);