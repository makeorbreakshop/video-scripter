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

// Clean description by removing common promotional patterns
function cleanDescription(description) {
  if (!description) return '';
  
  let cleaned = description;
  
  // Remove URLs
  cleaned = cleaned.replace(/https?:\/\/[^\s]+/g, '');
  
  // Remove social media handles
  cleaned = cleaned.replace(/@[\w]+/g, '');
  
  // Remove common promotional phrases
  const promoPatterns = [
    /Subscribe to .+?[\.\!\n]/gi,
    /Follow me on .+?[\.\!\n]/gi,
    /Check out .+?[\.\!\n]/gi,
    /Use code .+?[\.\!\n]/gi,
    /Get \d+% off .+?[\.\!\n]/gi,
    /Link in .+?[\.\!\n]/gi,
    /Available at .+?[\.\!\n]/gi,
    /Shop now .+?[\.\!\n]/gi,
    /Sponsored by .+?[\.\!\n]/gi,
  ];
  
  promoPatterns.forEach(pattern => {
    cleaned = cleaned.replace(pattern, '');
  });
  
  // Remove timestamps
  cleaned = cleaned.replace(/\d{1,2}:\d{2}(?::\d{2})?/g, '');
  
  // Remove multiple spaces and newlines
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  
  // Take first 500 characters
  return cleaned.substring(0, 500);
}

async function runComparisonTest() {
  console.log('🔬 Comparing BERTopic Methods: Title vs Title+Description vs LLM Summaries\n');
  
  // Get 200 diverse videos
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
  
  // Get diverse sample
  const selectedVideos = [];
  Object.entries(videosByChannel).forEach(([channel, videos]) => {
    const channelSample = videos.slice(0, 4);
    selectedVideos.push(...channelSample);
  });
  
  const testVideos = selectedVideos
    .sort(() => Math.random() - 0.5)
    .slice(0, 200);
  
  console.log(`📊 Processing ${testVideos.length} videos from ${new Set(testVideos.map(v => v.channel_name)).size} channels\n`);
  
  // Method 1: Title Only
  console.log('METHOD 1: Title Only\n');
  const titleEmbeddings = [];
  
  for (let i = 0; i < testVideos.length; i++) {
    const embedding = await generateEmbedding(testVideos[i].title);
    if (embedding) {
      titleEmbeddings.push(embedding);
    }
    
    if (i % 20 === 0 && i > 0) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  
  console.log(`✅ Generated ${titleEmbeddings.length} title embeddings\n`);
  
  // Method 2: Title + Description
  console.log('METHOD 2: Title + Cleaned Description\n');
  const comboTexts = [];
  const comboEmbeddings = [];
  
  for (let i = 0; i < testVideos.length; i++) {
    const video = testVideos[i];
    const cleanedDesc = cleanDescription(video.description);
    const comboText = `${video.title}. ${cleanedDesc}`;
    comboTexts.push(comboText);
    
    const embedding = await generateEmbedding(comboText);
    if (embedding) {
      comboEmbeddings.push(embedding);
    }
    
    if (i % 20 === 0 && i > 0) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  
  console.log(`✅ Generated ${comboEmbeddings.length} title+description embeddings\n`);
  
  // Method 3: LLM Summaries
  console.log('METHOD 3: LLM Summaries (Improved Prompt)\n');
  const summaries = [];
  const summaryEmbeddings = [];
  
  for (let i = 0; i < testVideos.length; i++) {
    const video = testVideos[i];
    const summary = await generateSummary(video);
    
    if (summary) {
      summaries.push(summary);
      const embedding = await generateEmbedding(summary);
      if (embedding) {
        summaryEmbeddings.push(embedding);
      }
    }
    
    if (i % 20 === 0 && i > 0) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  
  console.log(`✅ Generated ${summaries.length} summaries and embeddings\n`);
  
  // Save all data for Python BERTopic
  await fs.writeFile(
    'bertopic_comparison_data.json',
    JSON.stringify({
      titles: testVideos.map(v => v.title),
      titleEmbeddings: titleEmbeddings,
      comboTexts: comboTexts,
      comboEmbeddings: comboEmbeddings,
      summaries: summaries,
      summaryEmbeddings: summaryEmbeddings,
      metadata: testVideos
    })
  );
  
  // Create Python script for comparison
  const pythonScript = `
import json
import numpy as np
from bertopic import BERTopic
from sklearn.metrics import silhouette_score
import warnings
warnings.filterwarnings('ignore')

# Load data
with open('bertopic_comparison_data.json', 'r') as f:
    data = json.load(f)

def run_bertopic(texts, embeddings, method_name):
    print(f"\\n{'='*60}")
    print(f"🔬 {method_name}")
    print(f"{'='*60}")
    
    # Initialize BERTopic
    topic_model = BERTopic(
        embedding_model=None,  # We're providing pre-computed embeddings
        min_topic_size=3,  # Lower threshold for more granular topics
        n_gram_range=(1, 3),
        calculate_probabilities=True,
        verbose=False
    )
    
    # Fit the model
    topics, probs = topic_model.fit_transform(texts, embeddings)
    
    # Get topic info
    topic_info = topic_model.get_topic_info()
    # Count actual topics (excluding -1 outlier topic)
    n_topics = len([t for t in topic_info['Topic'] if t != -1])
    
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
    
    print(f"\\n📊 Results:")
    print(f"- Number of topics: {n_topics}")
    print(f"- Outliers: {outliers} ({outlier_percentage:.1f}%)")
    print(f"- Silhouette score: {silhouette:.3f}")
    
    # Show top 5 topics
    print(f"\\n🎯 Top Topics:")
    for idx, row in topic_info.iterrows():
        if idx < 5 and row['Topic'] != -1:
            print(f"\\nTopic {row['Topic']} ({row['Count']} items):")
            topic_words = topic_model.get_topic(row['Topic'])[:5]
            words = ', '.join([word for word, _ in topic_words])
            print(f"  Keywords: {words}")
            
            # Get example texts
            topic_docs = [texts[i] for i, t in enumerate(topics) if t == row['Topic']][:2]
            for j, doc in enumerate(topic_docs):
                print(f"  Example {j+1}: {doc[:80]}...")
    
    return {
        'method': method_name,
        'n_topics': n_topics,
        'outlier_percentage': outlier_percentage,
        'silhouette_score': float(silhouette),
        'topic_sizes': topic_info[topic_info['Topic'] != -1]['Count'].tolist()
    }

# Run comparisons
results = []

# Method 1: Titles only
results.append(run_bertopic(
    data['titles'], 
    np.array(data['titleEmbeddings']), 
    "METHOD 1: TITLES ONLY"
))

# Method 2: Title + Description
results.append(run_bertopic(
    data['comboTexts'], 
    np.array(data['comboEmbeddings']), 
    "METHOD 2: TITLE + DESCRIPTION"
))

# Method 3: LLM Summaries
results.append(run_bertopic(
    data['summaries'], 
    np.array(data['summaryEmbeddings']), 
    "METHOD 3: LLM SUMMARIES"
))

# Summary comparison
print(f"\\n\\n{'='*80}")
print("📊 COMPARISON SUMMARY")
print(f"{'='*80}")
print(f"{'Method':<25} {'Topics':<10} {'Outliers':<15} {'Silhouette':<15}")
print(f"{'-'*65}")

for r in results:
    print(f"{r['method'][10:]:<25} {r['n_topics']:<10} {r['outlier_percentage']:.1f}%{'':<10} {r['silhouette_score']:.3f}")

print(f"\\n💡 INSIGHTS:")
print("- More topics = better granularity for categorization")
print("- Lower outliers = better clustering coverage") 
print("- Higher silhouette = better cluster separation")

# Calculate topic diversity (unique topic words)
print(f"\\n🎯 COST-BENEFIT ANALYSIS:")
print(f"\\nTITLE ONLY:")
print(f"  Cost: $0 (already have titles)")
print(f"  Topics: {results[0]['n_topics']}")
print(f"  Quality: {results[0]['silhouette_score']:.3f} silhouette")

print(f"\\nTITLE + DESCRIPTION:")
print(f"  Cost: $0 (already have descriptions)")
print(f"  Topics: {results[1]['n_topics']}")
print(f"  Quality: {results[1]['silhouette_score']:.3f} silhouette")

print(f"\\nLLM SUMMARIES:")
print(f"  Cost: ~$10 for 178K videos (with batch API)")
print(f"  Topics: {results[2]['n_topics']}")
print(f"  Quality: {results[2]['silhouette_score']:.3f} silhouette")

# Save results
with open('bertopic_method_comparison.json', 'w') as f:
    json.dump(results, f, indent=2)

print("\\n✅ Results saved to bertopic_method_comparison.json")
`;

  await fs.writeFile('run_bertopic_comparison.py', pythonScript);
  
  try {
    const { stdout } = await execAsync('python run_bertopic_comparison.py');
    console.log(stdout);
  } catch (error) {
    console.error('Error running BERTopic:', error);
  }
  
  // Clean up
  await fs.unlink('bertopic_comparison_data.json').catch(() => {});
  await fs.unlink('run_bertopic_comparison.py').catch(() => {});
}

runComparisonTest().catch(console.error);