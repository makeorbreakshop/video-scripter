"""
Simple test of HDBSCAN clustering on subset of videos
Uses Supabase client for easier connection
"""

import os
import numpy as np
import hdbscan
from sklearn.metrics import silhouette_score
from collections import Counter
import json
from datetime import datetime
from dotenv import load_dotenv
from supabase import create_client, Client

# Load environment variables
load_dotenv()

# Supabase connection
url = os.getenv('NEXT_PUBLIC_SUPABASE_URL')
key = os.getenv('SUPABASE_SERVICE_ROLE_KEY')

if not url or not key:
    raise ValueError("Missing SUPABASE environment variables")

supabase: Client = create_client(url, key)

def test_clustering(sample_size=5000):
    """Test HDBSCAN clustering on a subset of videos"""
    
    print(f"🧪 Testing HDBSCAN clustering on {sample_size:,} videos...\n")
    
    try:
        # Get sample of videos with embeddings
        print("📊 Loading sample videos...")
        
        # First, get a count
        count_response = supabase.table('videos').select('id', count='exact').limit(1).execute()
        total_videos = count_response.count if count_response.count else 0
        print(f"   Total videos with embeddings: {total_videos:,}")
        
        # Get random sample
        # Note: Supabase doesn't have RANDOM() in the API, so we'll use offset
        import random
        max_offset = max(0, total_videos - sample_size)
        random_offset = random.randint(0, max_offset)
        
        response = supabase.table('videos').select(
            'id,title,channel_id,view_count,title_embedding,topic_level_3'
        ).range(random_offset, random_offset + sample_size - 1).execute()
        
        videos = response.data
        print(f"✅ Loaded {len(videos)} videos")
        
        if len(videos) < 100:
            print("❌ Not enough videos with embeddings to test clustering")
            return
        
        # Extract embeddings
        embeddings = []
        valid_videos = []
        
        for video in videos:
            if video['title_embedding']:
                try:
                    # Parse embedding
                    if isinstance(video['title_embedding'], str):
                        embedding = json.loads(video['title_embedding'])
                    else:
                        embedding = video['title_embedding']
                    
                    if len(embedding) == 512:  # Expected dimension
                        embeddings.append(embedding)
                        valid_videos.append(video)
                except:
                    continue
        
        embeddings_array = np.array(embeddings)
        print(f"✅ Prepared {len(embeddings)} valid embeddings")
        
        # Test with reasonable parameters
        print("\n🔬 Testing HDBSCAN parameters...")
        
        min_cluster_size = max(30, len(embeddings) // 100)  # Adaptive sizing
        print(f"   Using min_cluster_size={min_cluster_size}")
        
        # Run HDBSCAN
        clusterer = hdbscan.HDBSCAN(
            min_cluster_size=min_cluster_size,
            min_samples=5,
            metric='euclidean',
            cluster_selection_method='eom'
        )
        
        cluster_labels = clusterer.fit_predict(embeddings_array)
        
        # Calculate metrics
        n_clusters = len(set(cluster_labels)) - (1 if -1 in cluster_labels else 0)
        n_noise = list(cluster_labels).count(-1)
        noise_ratio = n_noise / len(cluster_labels)
        
        print(f"\n📊 Results:")
        print(f"   Clusters found: {n_clusters}")
        print(f"   Noise points: {n_noise} ({noise_ratio:.1%})")
        
        # Analyze clusters
        print("\n📈 Top 10 Clusters:")
        cluster_sizes = Counter(cluster_labels)
        
        for cluster_id, size in cluster_sizes.most_common(11):
            if cluster_id == -1:
                continue
                
            # Get videos in this cluster
            cluster_videos = [valid_videos[i] for i, label in enumerate(cluster_labels) if label == cluster_id]
            
            # Sample titles
            sample_titles = [v['title'] for v in cluster_videos[:3]]
            
            # Average views
            avg_views = np.mean([v['view_count'] or 0 for v in cluster_videos])
            
            print(f"\n   Cluster {cluster_id}: {size} videos (avg {avg_views:,.0f} views)")
            for title in sample_titles:
                print(f"      - {title[:70]}...")
        
        # Compare with existing topics
        print("\n🔄 Mapping to existing BERT topics:")
        
        # Count how BERT topics distribute across clusters
        bert_distribution = {}
        for i, video in enumerate(valid_videos):
            if video['topic_level_3'] and cluster_labels[i] != -1:
                bert_topic = video['topic_level_3']
                cluster = cluster_labels[i]
                
                if bert_topic not in bert_distribution:
                    bert_distribution[bert_topic] = Counter()
                bert_distribution[bert_topic][cluster] += 1
        
        # Find topics that split
        splits = 0
        merges = 0
        
        for bert_topic, clusters in bert_distribution.items():
            if len(clusters) > 1:
                splits += 1
            
        # Find clusters that merge multiple BERT topics
        cluster_to_bert = {}
        for bert_topic, clusters in bert_distribution.items():
            for cluster, count in clusters.items():
                if cluster not in cluster_to_bert:
                    cluster_to_bert[cluster] = Counter()
                cluster_to_bert[cluster][bert_topic] += count
        
        for cluster, topics in cluster_to_bert.items():
            if len(topics) > 1:
                merges += 1
        
        print(f"   BERT topics that split into multiple clusters: {splits}")
        print(f"   Clusters that merge multiple BERT topics: {merges}")
        
        # Estimate for full dataset
        estimated_clusters = int(n_clusters * (total_videos / sample_size) ** 0.5)
        print(f"\n🔮 Estimated clusters for full dataset: ~{estimated_clusters}")
        
        # Save summary
        summary = {
            'test_date': datetime.now().isoformat(),
            'sample_size': sample_size,
            'total_videos_with_embeddings': total_videos,
            'clusters_found': n_clusters,
            'noise_ratio': noise_ratio,
            'estimated_full_clusters': estimated_clusters,
            'bert_topics_split': splits,
            'clusters_merged': merges
        }
        
        with open('hdbscan_test_summary.json', 'w') as f:
            json.dump(summary, f, indent=2)
        
        print(f"\n✅ Test complete! Summary saved to hdbscan_test_summary.json")
        
        return summary
        
    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    # First install required packages
    print("📦 Installing required packages...")
    os.system("pip install supabase hdbscan scikit-learn numpy python-dotenv")
    
    # Run test
    test_clustering(5000)