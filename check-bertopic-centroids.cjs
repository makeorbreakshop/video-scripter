require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkCentroids() {
  // Check if we have centroids in bertopic_clusters table
  const { data: centroids, error } = await supabase
    .from('bertopic_clusters')
    .select('cluster_id, topic_name')
    .limit(5);
    
  console.log('\nBERTopic clusters table check:');
  if (error) {
    console.log('Error:', error.message);
  } else if (centroids && centroids.length > 0) {
    console.log(`Found ${centroids.length} clusters`);
    console.log('Sample clusters:');
    centroids.forEach(c => {
      console.log(`  - Cluster ${c.cluster_id}: ${c.topic_name}`);
    });
    
    // Check if we have centroid embeddings
    const { data: withEmbeddings, error: embError } = await supabase
      .from('bertopic_clusters')
      .select('cluster_id')
      .not('centroid_embedding', 'is', null)
      .limit(1);
      
    if (withEmbeddings && withEmbeddings.length > 0) {
      console.log('\n✅ Centroid embeddings are available');
    } else {
      console.log('\n⚠️ No centroid embeddings found');
    }
  } else {
    console.log('No clusters found in table');
  }
}

checkCentroids();