"""
Test clustering based on existing topic assignments
This analyzes how HDBSCAN would group videos compared to existing BERT topics
"""

import os
import numpy as np
from collections import Counter
from datetime import datetime
import json
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

def analyze_topic_distribution():
    """Analyze existing topic distribution to understand clustering needs"""
    
    print("🔍 Analyzing existing topic classifications...\n")
    
    try:
        # Get topic distribution at each level
        print("📊 Getting topic distribution...")
        
        # Level 1 distribution - simplified query
        level1_response = supabase.table('videos').select(
            'topic_level_1'
        ).execute()
        
        # Get sample for analysis
        sample_response = supabase.table('videos').select(
            'id,title,topic_level_1,topic_level_2,topic_level_3,view_count,channel_name'
        ).range(0, 9999).execute()
        
        videos = sample_response.data
        print(f"✅ Loaded {len(videos)} sample videos")
        
        # Analyze topic distribution
        level1_counts = Counter([v['topic_level_1'] for v in videos if v['topic_level_1']])
        level2_counts = Counter([v['topic_level_2'] for v in videos if v['topic_level_2']])
        level3_counts = Counter([v['topic_level_3'] for v in videos if v['topic_level_3']])
        
        print(f"\n📈 Topic Distribution:")
        print(f"   Level 1 (Broad): {len(level1_counts)} categories")
        print(f"   Level 2 (Sub): {len(level2_counts)} categories")
        print(f"   Level 3 (Specific): {len(level3_counts)} topics")
        
        # Show top categories
        print("\n🔝 Top Level 1 Categories:")
        for topic, count in level1_counts.most_common(12):
            print(f"   {topic}: {count} videos ({count/len(videos)*100:.1f}%)")
        
        # Analyze Level 3 distribution
        print("\n📊 Level 3 (Specific Topics) Analysis:")
        
        # Size distribution
        topic_sizes = list(level3_counts.values())
        print(f"   Average videos per topic: {np.mean(topic_sizes):.1f}")
        print(f"   Median videos per topic: {np.median(topic_sizes):.1f}")
        print(f"   Smallest topic: {min(topic_sizes)} videos")
        print(f"   Largest topic: {max(topic_sizes)} videos")
        
        # Find topics that might need splitting
        large_topics = [(t, c) for t, c in level3_counts.items() if c > 50]
        print(f"\n🔄 Large topics that might split into multiple clusters:")
        for topic, count in sorted(large_topics, key=lambda x: x[1], reverse=True)[:10]:
            # Get sample videos from this topic
            topic_videos = [v for v in videos if v['topic_level_3'] == topic][:5]
            print(f"\n   Topic {topic}: {count} videos")
            print("   Sample titles:")
            for v in topic_videos[:3]:
                print(f"      - {v['title'][:60]}...")
        
        # Find potentially similar topics
        print("\n🔀 Topics that might merge (based on naming):")
        topic_names = list(level3_counts.keys())
        
        # Simple similarity check based on common words
        merges = []
        for i, topic1 in enumerate(topic_names):
            for topic2 in topic_names[i+1:]:
                if topic1 and topic2:
                    words1 = set(str(topic1).lower().split())
                    words2 = set(str(topic2).lower().split())
                    if len(words1 & words2) >= 2:  # At least 2 common words
                        merges.append((topic1, topic2, level3_counts[topic1], level3_counts[topic2]))
        
        for t1, t2, c1, c2 in merges[:5]:
            print(f"   - Topic {t1} ({c1} videos)")
            print(f"     Topic {t2} ({c2} videos)")
        
        # Estimate optimal cluster count
        print("\n🎯 Clustering Recommendations:")
        
        # Based on topic sizes
        small_topics = len([c for c in topic_sizes if c < 10])
        medium_topics = len([c for c in topic_sizes if 10 <= c < 50])
        large_topics_count = len([c for c in topic_sizes if c >= 50])
        
        print(f"   Current topics needing adjustment:")
        print(f"   - Small topics (<10 videos): {small_topics}")
        print(f"   - Medium topics (10-50 videos): {medium_topics}")
        print(f"   - Large topics (50+ videos): {large_topics_count}")
        
        # Estimate clusters
        estimated_splits = large_topics_count * 3  # Large topics might split into ~3
        estimated_merges = small_topics // 3  # Small topics might merge 3:1
        estimated_clusters = len(level3_counts) + estimated_splits - estimated_merges
        
        print(f"\n   Estimated natural clusters: {estimated_clusters}")
        print(f"   (Current 777 topics → ~{estimated_clusters} natural groups)")
        
        # Performance analysis by topic
        print("\n💰 High-value topics (by average views):")
        topic_performance = {}
        for topic in level3_counts:
            topic_videos = [v for v in videos if v['topic_level_3'] == topic]
            if topic_videos:
                avg_views = np.mean([v['view_count'] or 0 for v in topic_videos])
                topic_performance[topic] = {
                    'avg_views': avg_views,
                    'count': len(topic_videos),
                    'sample': topic_videos[0]['title'] if topic_videos else ''
                }
        
        top_performers = sorted(
            topic_performance.items(), 
            key=lambda x: x[1]['avg_views'], 
            reverse=True
        )[:10]
        
        for topic, perf in top_performers:
            print(f"   Topic {topic}: {perf['avg_views']:,.0f} avg views ({perf['count']} videos)")
            print(f"      Sample: {perf['sample'][:60]}...")
        
        # Save analysis
        summary = {
            'analysis_date': datetime.now().isoformat(),
            'sample_size': len(videos),
            'topic_levels': {
                'level_1': len(level1_counts),
                'level_2': len(level2_counts),
                'level_3': len(level3_counts)
            },
            'level_3_stats': {
                'avg_size': np.mean(topic_sizes),
                'median_size': np.median(topic_sizes),
                'min_size': min(topic_sizes),
                'max_size': max(topic_sizes),
                'small_topics': small_topics,
                'large_topics': large_topics_count
            },
            'estimated_natural_clusters': estimated_clusters,
            'recommendation': f"HDBSCAN would likely find {estimated_clusters} natural clusters, compared to current 777 BERT topics"
        }
        
        with open('topic_clustering_analysis.json', 'w') as f:
            json.dump(summary, f, indent=2)
        
        print(f"\n✅ Analysis complete! Summary saved to topic_clustering_analysis.json")
        
        return summary
        
    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    analyze_topic_distribution()