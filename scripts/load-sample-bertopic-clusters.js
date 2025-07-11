#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const path = require('path');

// Load environment variables
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Sample BERTopic clusters with realistic topic hierarchies
const sampleClusters = [
  // Technology clusters
  {
    cluster_id: 1,
    topic_name: 'React Hooks Tutorial',
    parent_topic: 'Web Development',
    grandparent_topic: 'Technology'
  },
  {
    cluster_id: 2,
    topic_name: 'Python Machine Learning',
    parent_topic: 'Programming',
    grandparent_topic: 'Technology'
  },
  {
    cluster_id: 3,
    topic_name: 'Kubernetes DevOps',
    parent_topic: 'Cloud Computing',
    grandparent_topic: 'Technology'
  },
  {
    cluster_id: 4,
    topic_name: 'TypeScript Best Practices',
    parent_topic: 'Web Development',
    grandparent_topic: 'Technology'
  },
  {
    cluster_id: 5,
    topic_name: 'AI Ethics Discussion',
    parent_topic: 'Artificial Intelligence',
    grandparent_topic: 'Technology'
  },

  // Entertainment clusters
  {
    cluster_id: 10,
    topic_name: 'Minecraft Redstone',
    parent_topic: 'Gaming',
    grandparent_topic: 'Entertainment'
  },
  {
    cluster_id: 11,
    topic_name: 'Movie Reviews Marvel',
    parent_topic: 'Film & TV',
    grandparent_topic: 'Entertainment'
  },
  {
    cluster_id: 12,
    topic_name: 'Music Production Tips',
    parent_topic: 'Music',
    grandparent_topic: 'Entertainment'
  },

  // Education clusters
  {
    cluster_id: 20,
    topic_name: 'Math Calculus Explained',
    parent_topic: 'Mathematics',
    grandparent_topic: 'Education'
  },
  {
    cluster_id: 21,
    topic_name: 'History World War II',
    parent_topic: 'History',
    grandparent_topic: 'Education'
  },
  {
    cluster_id: 22,
    topic_name: 'Science Physics Experiments',
    parent_topic: 'Science',
    grandparent_topic: 'Education'
  },

  // Business clusters
  {
    cluster_id: 30,
    topic_name: 'Startup Funding Guide',
    parent_topic: 'Entrepreneurship',
    grandparent_topic: 'Business'
  },
  {
    cluster_id: 31,
    topic_name: 'Stock Market Analysis',
    parent_topic: 'Finance',
    grandparent_topic: 'Business'
  },
  {
    cluster_id: 32,
    topic_name: 'Digital Marketing SEO',
    parent_topic: 'Marketing',
    grandparent_topic: 'Business'
  },

  // Lifestyle clusters
  {
    cluster_id: 40,
    topic_name: 'Healthy Recipe Ideas',
    parent_topic: 'Cooking',
    grandparent_topic: 'Lifestyle'
  },
  {
    cluster_id: 41,
    topic_name: 'Home Workout Routines',
    parent_topic: 'Fitness',
    grandparent_topic: 'Lifestyle'
  },
  {
    cluster_id: 42,
    topic_name: 'Travel Vlog Japan',
    parent_topic: 'Travel',
    grandparent_topic: 'Lifestyle'
  },

  // News & Politics clusters
  {
    cluster_id: 50,
    topic_name: 'Tech Industry News',
    parent_topic: 'Technology News',
    grandparent_topic: 'News & Politics'
  },
  {
    cluster_id: 51,
    topic_name: 'Political Commentary US',
    parent_topic: 'Politics',
    grandparent_topic: 'News & Politics'
  },
  {
    cluster_id: 52,
    topic_name: 'Climate Change Updates',
    parent_topic: 'Environmental News',
    grandparent_topic: 'News & Politics'
  }
];

// Generate random 512-dimensional embeddings for each cluster
function generateRandomEmbedding(seed) {
  const embedding = new Array(512);
  let random = seed;
  
  for (let i = 0; i < 512; i++) {
    // Simple pseudo-random number generator
    random = (random * 1103515245 + 12345) & 0x7fffffff;
    embedding[i] = (random / 0x7fffffff) * 2 - 1; // Normalize to [-1, 1]
  }
  
  // Normalize the vector
  const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
  return embedding.map(val => val / magnitude);
}

async function loadSampleClusters() {
  console.log('Loading sample BERTopic clusters...');
  
  try {
    // First, check if the table exists
    const { error: checkError } = await supabase
      .from('bertopic_clusters')
      .select('cluster_id')
      .limit(1);
    
    if (checkError && checkError.code === '42P01') {
      console.error('❌ Table bertopic_clusters does not exist. Please run the migration first.');
      return;
    }
    
    // Clear existing data
    const { error: deleteError } = await supabase
      .from('bertopic_clusters')
      .delete()
      .gte('cluster_id', 0);
    
    if (deleteError) {
      console.error('Error clearing existing data:', deleteError);
      return;
    }
    
    // Insert sample clusters with embeddings
    const clustersWithEmbeddings = sampleClusters.map(cluster => ({
      ...cluster,
      centroid_embedding: generateRandomEmbedding(cluster.cluster_id),
      video_count: Math.floor(Math.random() * 1000) + 10, // Random count between 10-1010
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }));
    
    const { data, error } = await supabase
      .from('bertopic_clusters')
      .insert(clustersWithEmbeddings);
    
    if (error) {
      console.error('Error inserting clusters:', error);
      return;
    }
    
    console.log(`✅ Successfully loaded ${sampleClusters.length} sample clusters`);
    
    // Display summary
    const domains = [...new Set(sampleClusters.map(c => c.grandparent_topic))];
    console.log('\nCluster Summary:');
    console.log(`- Total clusters: ${sampleClusters.length}`);
    console.log(`- Domains: ${domains.join(', ')}`);
    
    // Count by domain
    domains.forEach(domain => {
      const count = sampleClusters.filter(c => c.grandparent_topic === domain).length;
      console.log(`  - ${domain}: ${count} clusters`);
    });
    
  } catch (error) {
    console.error('Error loading sample clusters:', error);
  }
}

// Run the script
loadSampleClusters();