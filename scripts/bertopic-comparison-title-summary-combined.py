import os
import numpy as np
import pandas as pd
from bertopic import BERTopic
from sklearn.feature_extraction.text import CountVectorizer
from sentence_transformers import SentenceTransformer
import psycopg2
from dotenv import load_dotenv
import json
from datetime import datetime
import matplotlib.pyplot as plt
import seaborn as sns
from umap import UMAP
from hdbscan import HDBSCAN

# Load environment variables
load_dotenv()

# Database connection
def get_db_connection():
    conn_str = os.getenv('DATABASE_URL')
    if not conn_str:
        # Build from Supabase components
        import urllib.parse
        url = os.getenv('NEXT_PUBLIC_SUPABASE_URL')
        if url and 'supabase.co' in url:
            # Extract project ref from Supabase URL
            project_ref = url.split('//')[1].split('.')[0]
            password = urllib.parse.quote(os.getenv('SUPABASE_DB_PASSWORD', 'postgres'))
            conn_str = f"postgresql://postgres:{password}@db.{project_ref}.supabase.co:5432/postgres"
        else:
            # Fallback to individual components
            conn_str = f"postgresql://{os.getenv('DB_USER')}:{os.getenv('DB_PASSWORD')}@{os.getenv('DB_HOST')}:{os.getenv('DB_PORT')}/{os.getenv('DB_NAME')}"
    return psycopg2.connect(conn_str)

def fetch_video_data(limit=None):
    """Fetch videos with both titles and LLM summaries"""
    conn = get_db_connection()
    cur = conn.cursor()
    
    query = """
    SELECT 
        id,
        title,
        llm_summary,
        channel_name,
        view_count,
        published_at,
        duration_seconds
    FROM videos
    WHERE llm_summary IS NOT NULL
    AND llm_summary_embedding_synced = true
    AND title IS NOT NULL
    ORDER BY view_count DESC
    """
    
    if limit:
        query += f" LIMIT {limit}"
    
    cur.execute(query)
    columns = [desc[0] for desc in cur.description]
    results = cur.fetchall()
    
    cur.close()
    conn.close()
    
    df = pd.DataFrame(results, columns=columns)
    print(f"Fetched {len(df)} videos with LLM summaries")
    
    return df

def create_combined_text(df):
    """Create combined title + summary text"""
    # Combine with title having slightly more weight
    combined = []
    for _, row in df.iterrows():
        # Title appears twice to give it more weight in clustering
        text = f"{row['title']} {row['title']} {row['llm_summary']}"
        combined.append(text)
    return combined

def run_bertopic_clustering(texts, name, min_topic_size=30, nr_topics='auto'):
    """Run BERTopic clustering on given texts"""
    print(f"\n{'='*60}")
    print(f"Running BERTopic for: {name}")
    print(f"{'='*60}")
    
    # Use a good sentence transformer model
    sentence_model = SentenceTransformer("all-MiniLM-L6-v2")
    
    # UMAP for dimensionality reduction
    umap_model = UMAP(
        n_neighbors=15,
        n_components=5,
        min_dist=0.0,
        metric='cosine',
        random_state=42
    )
    
    # HDBSCAN for clustering
    hdbscan_model = HDBSCAN(
        min_cluster_size=min_topic_size,
        metric='euclidean',
        cluster_selection_method='eom',
        prediction_data=True
    )
    
    # Vectorizer with good parameters for YouTube content
    vectorizer_model = CountVectorizer(
        ngram_range=(1, 3),
        stop_words="english",
        min_df=5,
        max_df=0.5
    )
    
    # Create BERTopic model
    topic_model = BERTopic(
        embedding_model=sentence_model,
        umap_model=umap_model,
        hdbscan_model=hdbscan_model,
        vectorizer_model=vectorizer_model,
        nr_topics=nr_topics,
        calculate_probabilities=True,
        verbose=True
    )
    
    # Fit the model
    print(f"Fitting BERTopic model on {len(texts)} documents...")
    topics, probs = topic_model.fit_transform(texts)
    
    # Get topic info
    topic_info = topic_model.get_topic_info()
    
    print(f"\nFound {len(topic_info) - 1} topics (excluding outliers)")
    print(f"Outliers (-1 topic): {sum(1 for t in topics if t == -1)}")
    
    return topic_model, topics, probs, topic_info

def analyze_clustering_quality(df, topics, name):
    """Analyze the quality of clustering"""
    print(f"\n📊 Clustering Quality Analysis for {name}:")
    
    # Add topics to dataframe
    df_analysis = df.copy()
    df_analysis['topic'] = topics
    
    # Topic size distribution
    topic_counts = df_analysis['topic'].value_counts().sort_index()
    print(f"\nTopic Size Distribution:")
    print(f"- Number of topics: {len(topic_counts) - 1} (excluding outliers)")
    print(f"- Outliers (topic -1): {topic_counts.get(-1, 0)}")
    print(f"- Largest topic: {topic_counts[topic_counts.index != -1].max()} videos")
    print(f"- Smallest topic: {topic_counts[topic_counts.index != -1].min()} videos")
    print(f"- Median topic size: {topic_counts[topic_counts.index != -1].median():.0f} videos")
    
    # Channel diversity within topics
    print(f"\nChannel Diversity Analysis:")
    channel_diversity = []
    for topic in df_analysis['topic'].unique():
        if topic != -1:
            topic_videos = df_analysis[df_analysis['topic'] == topic]
            unique_channels = topic_videos['channel_name'].nunique()
            total_videos = len(topic_videos)
            diversity_ratio = unique_channels / total_videos
            channel_diversity.append({
                'topic': topic,
                'unique_channels': unique_channels,
                'total_videos': total_videos,
                'diversity_ratio': diversity_ratio
            })
    
    diversity_df = pd.DataFrame(channel_diversity)
    if len(diversity_df) > 0:
        print(f"- Average channels per topic: {diversity_df['unique_channels'].mean():.1f}")
        print(f"- Average diversity ratio: {diversity_df['diversity_ratio'].mean():.3f}")
    else:
        print("- No topics found (all outliers)")
    
    return df_analysis, diversity_df

def compare_clustering_results(results_dict):
    """Compare clustering results across different methods"""
    print("\n" + "="*80)
    print("COMPARATIVE ANALYSIS")
    print("="*80)
    
    comparison = []
    
    for name, (model, topics, probs, topic_info, df_analysis, diversity_df) in results_dict.items():
        stats = {
            'Method': name,
            'Total Topics': len(topic_info) - 1,
            'Outliers': sum(1 for t in topics if t == -1),
            'Outlier %': f"{(sum(1 for t in topics if t == -1) / len(topics) * 100):.1f}%",
            'Avg Topic Size': f"{np.mean([len(df_analysis[df_analysis['topic'] == t]) for t in df_analysis['topic'].unique() if t != -1]):.0f}" if len([t for t in df_analysis['topic'].unique() if t != -1]) > 0 else "0",
            'Avg Channel Diversity': f"{diversity_df['diversity_ratio'].mean():.3f}" if len(diversity_df) > 0 else "N/A"
        }
        comparison.append(stats)
    
    comparison_df = pd.DataFrame(comparison)
    print("\n", comparison_df.to_string(index=False))
    
    return comparison_df

def save_results(results_dict, df):
    """Save clustering results and analysis"""
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    output_dir = f"clustering_comparison_{timestamp}"
    os.makedirs(output_dir, exist_ok=True)
    
    # Save comparison summary
    comparison_data = {
        'timestamp': timestamp,
        'total_videos': len(df),
        'methods': {}
    }
    
    for name, (model, topics, probs, topic_info, df_analysis, diversity_df) in results_dict.items():
        # Save topic assignments
        df_analysis[['id', 'title', 'topic']].to_csv(
            f"{output_dir}/{name.lower().replace(' ', '_')}_topics.csv", 
            index=False
        )
        
        # Save topic info
        topic_info.to_csv(
            f"{output_dir}/{name.lower().replace(' ', '_')}_topic_info.csv",
            index=False
        )
        
        # Get top 10 topics with examples
        top_topics = []
        for topic_id in topic_info['Topic'][:11]:  # Top 10 + outliers
            if topic_id == -1:
                continue
                
            topic_words = model.get_topic(topic_id)
            topic_videos = df_analysis[df_analysis['topic'] == topic_id].head(3)
            
            top_topics.append({
                'topic_id': topic_id,
                'size': len(df_analysis[df_analysis['topic'] == topic_id]),
                'words': [word for word, _ in topic_words[:10]],
                'examples': topic_videos['title'].tolist()
            })
        
        comparison_data['methods'][name] = {
            'total_topics': len(topic_info) - 1,
            'outliers': sum(1 for t in topics if t == -1),
            'outlier_percentage': sum(1 for t in topics if t == -1) / len(topics) * 100,
            'avg_channel_diversity': float(diversity_df['diversity_ratio'].mean()) if len(diversity_df) > 0 else 0.0,
            'top_10_topics': top_topics
        }
    
    # Save comparison data
    with open(f"{output_dir}/comparison_summary.json", 'w') as f:
        json.dump(comparison_data, f, indent=2)
    
    print(f"\n✅ Results saved to {output_dir}/")
    
    return output_dir

def main():
    print("🚀 BERTopic Clustering Comparison: Title vs Summary vs Combined")
    print("="*80)
    
    # Fetch data
    print("\n📥 Fetching video data...")
    # Use a subset for faster testing, remove limit for full analysis
    try:
        df = fetch_video_data(limit=10000)  # Start with 10K for testing
    except Exception as e:
        print(f"❌ Error fetching data: {e}")
        print("Make sure your database credentials are set in .env")
        return
    
    if len(df) == 0:
        print("❌ No videos found with LLM summaries")
        return
    
    # Prepare different text inputs
    print("\n📝 Preparing text data...")
    print(f"   - Total videos: {len(df):,}")
    print(f"   - Unique channels: {df['channel_name'].nunique():,}")
    print(f"   - Date range: {df['published_at'].min()} to {df['published_at'].max()}")
    
    titles = df['title'].tolist()
    summaries = df['llm_summary'].tolist()
    combined = create_combined_text(df)
    
    # Run clustering for each method
    results = {}
    
    # 1. Title-only clustering
    model_title, topics_title, probs_title, info_title = run_bertopic_clustering(
        titles, "Title-Only", min_topic_size=30
    )
    df_analysis_title, diversity_title = analyze_clustering_quality(
        df, topics_title, "Title-Only"
    )
    results['Title-Only'] = (model_title, topics_title, probs_title, info_title, 
                            df_analysis_title, diversity_title)
    
    # 2. Summary-only clustering
    model_summary, topics_summary, probs_summary, info_summary = run_bertopic_clustering(
        summaries, "Summary-Only", min_topic_size=30
    )
    df_analysis_summary, diversity_summary = analyze_clustering_quality(
        df, topics_summary, "Summary-Only"
    )
    results['Summary-Only'] = (model_summary, topics_summary, probs_summary, info_summary,
                              df_analysis_summary, diversity_summary)
    
    # 3. Combined clustering
    model_combined, topics_combined, probs_combined, info_combined = run_bertopic_clustering(
        combined, "Combined Title+Summary", min_topic_size=30
    )
    df_analysis_combined, diversity_combined = analyze_clustering_quality(
        df, topics_combined, "Combined Title+Summary"
    )
    results['Combined Title+Summary'] = (model_combined, topics_combined, probs_combined, 
                                        info_combined, df_analysis_combined, diversity_combined)
    
    # Compare results
    comparison_df = compare_clustering_results(results)
    
    # Save all results
    output_dir = save_results(results, df)
    
    # Print top topics from each method
    print("\n" + "="*80)
    print("TOP 5 TOPICS FROM EACH METHOD")
    print("="*80)
    
    for name, (model, _, _, topic_info, _, _) in results.items():
        print(f"\n🏷️  {name}:")
        for i in range(min(5, len(topic_info) - 1)):  # Top 5 topics
            topic_id = topic_info.iloc[i+1]['Topic']  # Skip -1
            topic_words = model.get_topic(topic_id)
            words = ', '.join([word for word, _ in topic_words[:5]])
            count = topic_info.iloc[i+1]['Count']
            print(f"   Topic {topic_id} ({count} videos): {words}")
    
    print(f"\n✅ Analysis complete! Check {output_dir}/ for detailed results.")
    print("\n💡 Next steps:")
    print("   1. Review the comparison_summary.json for detailed metrics")
    print("   2. Check individual CSV files for topic assignments")
    print("   3. Run with full dataset (remove limit) for production analysis")

if __name__ == "__main__":
    main()