"""
Test HDBSCAN clustering on a subset of videos
This script tests the clustering approach on 10,000 random videos
"""

import os
import numpy as np
import psycopg2
from psycopg2.extras import RealDictCursor
import hdbscan
from sklearn.metrics import silhouette_score
from collections import Counter
import json
from datetime import datetime
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Get Supabase connection details
SUPABASE_URL = os.getenv('NEXT_PUBLIC_SUPABASE_URL')
SUPABASE_KEY = os.getenv('SUPABASE_SERVICE_ROLE_KEY')

if not SUPABASE_URL or not SUPABASE_KEY:
    raise ValueError("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment")

# Extract database connection from Supabase URL
# Supabase URL format: https://[project-id].supabase.co
project_id = SUPABASE_URL.split('//')[1].split('.')[0]
DATABASE_URL = f"postgresql://postgres.{project_id}:{SUPABASE_KEY}@aws-0-us-west-1.pooler.supabase.com:6543/postgres"

def test_clustering_subset(sample_size=10000):
    """Test HDBSCAN clustering on a subset of videos"""
    
    print(f"🧪 Testing HDBSCAN clustering on {sample_size:,} videos...\n")
    
    # Connect to database
    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor(cursor_factory=RealDictCursor)
    
    try:
        # Get random sample of videos with embeddings
        print("📊 Loading sample videos with embeddings...")
        cur.execute("""
            SELECT 
                v.id, 
                v.title, 
                v.channel_id,
                v.view_count,
                v.published_at,
                v.title_embedding,
                v.topic_level_1,
                v.topic_level_2,
                v.topic_level_3
            FROM videos v
            WHERE v.title_embedding IS NOT NULL
            ORDER BY RANDOM()
            LIMIT %s
        """, (sample_size,))
        
        videos = cur.fetchall()
        print(f"✅ Loaded {len(videos)} videos")
        
        # Extract embeddings
        embeddings = []
        video_ids = []
        
        for video in videos:
            if video['title_embedding']:
                # Parse embedding (handle both string and array formats)
                if isinstance(video['title_embedding'], str):
                    embedding = json.loads(video['title_embedding'])
                else:
                    embedding = video['title_embedding']
                
                embeddings.append(embedding)
                video_ids.append(video['id'])
        
        embeddings_array = np.array(embeddings)
        print(f"✅ Prepared {len(embeddings)} embeddings of dimension {embeddings_array.shape[1]}")
        
        # Test different parameter combinations
        print("\n🔬 Testing different HDBSCAN parameters...")
        results = []
        
        for min_cluster_size in [30, 50, 100, 150]:
            for min_samples in [5, 10, 15]:
                print(f"\n  Testing min_cluster_size={min_cluster_size}, min_samples={min_samples}")
                
                # Run HDBSCAN
                clusterer = hdbscan.HDBSCAN(
                    min_cluster_size=min_cluster_size,
                    min_samples=min_samples,
                    metric='euclidean',
                    cluster_selection_method='eom',
                    prediction_data=True
                )
                
                cluster_labels = clusterer.fit_predict(embeddings_array)
                
                # Calculate metrics
                n_clusters = len(set(cluster_labels)) - (1 if -1 in cluster_labels else 0)
                n_noise = list(cluster_labels).count(-1)
                
                # Silhouette score (only if we have clusters)
                if n_clusters > 1 and n_noise < len(cluster_labels) - 1:
                    silhouette = silhouette_score(embeddings_array, cluster_labels)
                else:
                    silhouette = -1
                
                # Cluster sizes
                cluster_sizes = Counter(cluster_labels)
                avg_cluster_size = np.mean([size for label, size in cluster_sizes.items() if label != -1])
                
                result = {
                    'min_cluster_size': min_cluster_size,
                    'min_samples': min_samples,
                    'n_clusters': n_clusters,
                    'n_noise': n_noise,
                    'noise_ratio': n_noise / len(cluster_labels),
                    'silhouette_score': silhouette,
                    'avg_cluster_size': avg_cluster_size,
                    'cluster_sizes': dict(cluster_sizes)
                }
                
                results.append(result)
                
                print(f"    Clusters: {n_clusters}, Noise: {n_noise} ({result['noise_ratio']:.1%}), Silhouette: {silhouette:.3f}")
        
        # Find best parameters
        best_result = max(results, key=lambda x: x['silhouette_score'] if x['n_clusters'] > 10 else -1)
        
        print(f"\n🏆 Best parameters:")
        print(f"   min_cluster_size: {best_result['min_cluster_size']}")
        print(f"   min_samples: {best_result['min_samples']}")
        print(f"   Clusters found: {best_result['n_clusters']}")
        print(f"   Noise ratio: {best_result['noise_ratio']:.1%}")
        
        # Run with best parameters for detailed analysis
        print(f"\n📊 Running detailed analysis with best parameters...")
        clusterer = hdbscan.HDBSCAN(
            min_cluster_size=best_result['min_cluster_size'],
            min_samples=best_result['min_samples'],
            metric='euclidean',
            cluster_selection_method='eom',
            prediction_data=True
        )
        
        cluster_labels = clusterer.fit_predict(embeddings_array)
        
        # Analyze clusters
        print("\n📈 Cluster Analysis:")
        cluster_info = []
        
        for cluster_id in range(max(cluster_labels) + 1):
            if cluster_id == -1:
                continue
                
            cluster_indices = [i for i, label in enumerate(cluster_labels) if label == cluster_id]
            cluster_videos = [videos[i] for i in cluster_indices]
            
            # Get sample titles
            sample_titles = [v['title'] for v in cluster_videos[:5]]
            
            # Get existing topic distribution
            topic_counts = Counter([v['topic_level_3'] for v in cluster_videos if v['topic_level_3']])
            top_topics = topic_counts.most_common(3)
            
            # Calculate average views
            avg_views = np.mean([v['view_count'] or 0 for v in cluster_videos])
            
            cluster_info.append({
                'cluster_id': cluster_id,
                'size': len(cluster_indices),
                'avg_views': avg_views,
                'sample_titles': sample_titles,
                'top_bert_topics': top_topics
            })
        
        # Sort by size
        cluster_info.sort(key=lambda x: x['size'], reverse=True)
        
        # Print top 10 clusters
        print("\n🔝 Top 10 Clusters by Size:")
        for i, cluster in enumerate(cluster_info[:10]):
            print(f"\n  Cluster {cluster['cluster_id']} ({cluster['size']} videos, avg {cluster['avg_views']:,.0f} views)")
            print("  Sample titles:")
            for title in cluster['sample_titles'][:3]:
                print(f"    - {title[:80]}...")
            if cluster['top_bert_topics']:
                print("  Maps to BERT topics:")
                for topic_id, count in cluster['top_bert_topics'][:2]:
                    print(f"    - Topic {topic_id}: {count} videos ({count/cluster['size']*100:.0f}%)")
        
        # Compare with existing BERT topics
        print("\n🔄 Comparison with existing BERT topic classifications:")
        
        # For each BERT topic, see how it splits across HDBSCAN clusters
        bert_to_hdbscan = {}
        for i, video in enumerate(videos):
            if video['topic_level_3'] and cluster_labels[i] != -1:
                bert_topic = video['topic_level_3']
                if bert_topic not in bert_to_hdbscan:
                    bert_to_hdbscan[bert_topic] = Counter()
                bert_to_hdbscan[bert_topic][cluster_labels[i]] += 1
        
        # Find BERT topics that split significantly
        split_topics = []
        for bert_topic, cluster_counts in bert_to_hdbscan.items():
            if len(cluster_counts) > 1:
                total = sum(cluster_counts.values())
                max_cluster = max(cluster_counts.values())
                if max_cluster / total < 0.8:  # Topic splits if less than 80% in one cluster
                    split_topics.append({
                        'bert_topic': bert_topic,
                        'split_into': len(cluster_counts),
                        'distribution': cluster_counts.most_common(3)
                    })
        
        if split_topics:
            print(f"\n  Found {len(split_topics)} BERT topics that split across multiple clusters:")
            for topic in split_topics[:5]:
                print(f"    BERT Topic {topic['bert_topic']} splits into {topic['split_into']} clusters")
        
        # Save test results
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        output_file = f"hdbscan_test_results_{timestamp}.json"
        
        test_summary = {
            'test_date': datetime.now().isoformat(),
            'sample_size': sample_size,
            'best_parameters': best_result,
            'all_results': results,
            'cluster_analysis': cluster_info[:20],  # Top 20 clusters
            'bert_topic_splits': split_topics[:10]  # Top 10 splits
        }
        
        with open(output_file, 'w') as f:
            json.dump(test_summary, f, indent=2)
        
        print(f"\n💾 Test results saved to: {output_file}")
        
        # Estimate full dataset results
        total_videos = cur.execute("SELECT COUNT(*) FROM videos WHERE title_embedding IS NOT NULL")
        total_count = cur.fetchone()['count'] if cur.rowcount > 0 else sample_size
        
        estimated_clusters = best_result['n_clusters'] * (total_count / sample_size) ** 0.5
        print(f"\n🔮 Estimated clusters for full dataset ({total_count:,} videos): ~{int(estimated_clusters)}")
        
        return test_summary
        
    finally:
        cur.close()
        conn.close()

if __name__ == "__main__":
    test_clustering_subset(10000)